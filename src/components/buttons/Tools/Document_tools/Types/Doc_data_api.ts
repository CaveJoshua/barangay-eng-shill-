import { useState, useEffect } from 'react';
import { ApiService, API_BASE_URL } from '../../../../UI/api';

export interface IResident {
  record_id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  current_address?: string;
  purok?: string;
  dob?: string; // date of birth — same field the admin Resident view uses for age
}

// 🎂 Compute a whole-number age from a date of birth. Mirrors the exact logic the
// admin Resident table uses (Resident.tsx) so ages are consistent app-wide.
export const calculateAge = (dob?: string): string => {
  if (!dob) return '';
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age >= 0 ? String(age) : '';
};

export interface IOfficial {
  id: string;
  full_name: string;
  position: string;
  status: string;
  created_at?: string;
  signature_url?: string; // e-signature on file, if any (Cloudinary URL)
}

// An official's signature is eligible for documents while they're Active.
export const isOfficialActive = (o: { status?: string }): boolean =>
  (o.status || '').toLowerCase() === 'active';

export const useDocumentDataAPI = (initialResidentName: string, initialResidentId?: string) => {
  const [residents, setResidents] = useState<IResident[]>([]);
  const [captainName, setCaptainName] = useState('');
  const [kagawadName, setKagawadName] = useState('');
  const [captainSignatureUrl, setCaptainSignatureUrl] = useState('');
  const [kagawadSignatureUrl, setKagawadSignatureUrl] = useState('');
  const [autoFilledAddress, setAutoFilledAddress] = useState('');
  const [autoFilledAge, setAutoFilledAge] = useState('');

  useEffect(() => {
    const valve = new AbortController();

    const fetchData = async () => {
      try {
        const [residentList, officialsData] = await Promise.all([
          ApiService.getResidents(valve.signal),
          ApiService.getOfficials(valve.signal)
        ]);

        if (residentList !== null) {
          const safeResidentList = Array.isArray(residentList)
            ? residentList
            : (residentList.residents || []);
          setResidents(safeResidentList);

          if ((initialResidentName || initialResidentId) && safeResidentList.length > 0) {
            const matched = safeResidentList.find((r: IResident) => {
              if (initialResidentId && r.record_id === initialResidentId) return true;
              const fName = r.first_name || '';
              const lName = r.last_name || '';
              const dbFullName = `${fName} ${lName}`.trim().toLowerCase();
              const searchName = (initialResidentName || '').trim().toLowerCase();
              return dbFullName.includes(searchName);
            });

            if (matched) {
              const addrParts = [];
              if (matched.current_address && matched.current_address.toLowerCase() !== 'n/a') {
                addrParts.push(matched.current_address);
              }
              if (matched.purok) addrParts.push(matched.purok);
              setAutoFilledAddress(addrParts.join(', '));
              // 🎂 Same concept as the address: derive age from the matched record.
              setAutoFilledAge(calculateAge(matched.dob));
            }
          }
        }

        if (officialsData !== null) {
          const safeOfficialsList = Array.isArray(officialsData)
            ? officialsData
            : (officialsData.officials || []);

          // WITH CONTINUITY: prefer an Active official for the position; if
          // none is currently Active, fall back to the most recently
          // registered one so the document keeps a name until a replacement
          // is registered — at which point step 1 picks them.
          const pickOfficial = (matches: IOfficial[]): IOfficial | null => {
            if (matches.length === 0) return null;
            const active = matches.find(isOfficialActive);
            if (active) return active;
            return matches
              .slice()
              .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0];
          };

          const captain = pickOfficial(
            safeOfficialsList.filter((o: IOfficial) =>
              o.position.toLowerCase().includes('captain') ||
              o.position.toLowerCase().includes('punong')
            )
          );
          if (captain) {
            setCaptainName(captain.full_name.toUpperCase());
            setCaptainSignatureUrl(captain.signature_url || '');
          }

          const kagawad = pickOfficial(
            safeOfficialsList.filter((o: IOfficial) =>
              o.position.toLowerCase().includes('kagawad')
            )
          );
          if (kagawad) {
            setKagawadName(kagawad.full_name.toUpperCase());
            setKagawadSignatureUrl(kagawad.signature_url || '');
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('API Fetch Error:', err);
        }
      }
    };

    fetchData();
    return () => valve.abort();
  }, [initialResidentName, initialResidentId]);

  return { residents, captainName, kagawadName, captainSignatureUrl, kagawadSignatureUrl, autoFilledAddress, autoFilledAge };
};

export const saveDocumentRecord = async (payload: any): Promise<any> => {
  const result = await ApiService.saveDocumentRecord(payload);
  if (!result.success) throw new Error(result.error || 'Database save failed');
  return result.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// FINALIZE: updateDocumentStatus (Now passes Price to the Backend)
// ─────────────────────────────────────────────────────────────────────────────
export const updateDocumentStatus = async (
  id: number | string,
  status: string,
  rejection_reason?: string,
  price?: number 
): Promise<void> => {
  
  // 1. Grab the auth token passed by Login_modal
  const rawToken = localStorage.getItem('auth_token') || localStorage.getItem('token') || '';

  // 2. 🛡️ ZERO-TRUST SYNC: 
  const isRealToken = rawToken && rawToken !== 'ZERO_TRUST_COOKIE_SET';

  // 3. Build Payload
  const payload: Record<string, any> = { status };
  
  if (rejection_reason) {
      payload.rejection_reason = rejection_reason;
  }
  
  // 🎯 THE FIX: Attach the price to the payload so it updates the SQL 'price' column
  if (price !== undefined) {
      payload.price = price;
  }

  const response = await fetch(`${API_BASE_URL}/documents/${id}/status`, {
    method: 'PATCH',
    credentials: 'include', 
    headers: {
      'Content-Type': 'application/json',
      ...(isRealToken ? { Authorization: `Bearer ${rawToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Session invalid or secure cookie missing.`);
  }
};