import { useState, useEffect } from 'react';
import { ApiService, API_BASE_URL } from '../../../../UI/api';

export interface IResident {
  record_id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  current_address?: string;
  purok?: string;
}

export interface IOfficial {
  id: string;
  full_name: string;
  position: string;
  status: string;
}

export const useDocumentDataAPI = (initialResidentName: string, initialResidentId?: string) => {
  const [residents, setResidents] = useState<IResident[]>([]);
  const [captainName, setCaptainName] = useState('');
  const [kagawadName, setKagawadName] = useState('');
  const [autoFilledAddress, setAutoFilledAddress] = useState('');

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
            }
          }
        }

        if (officialsData !== null) {
          const safeOfficialsList = Array.isArray(officialsData)
            ? officialsData
            : (officialsData.officials || []);

          const activeCaptain = safeOfficialsList.find((o: IOfficial) =>
            (o.position.toLowerCase().includes('captain') ||
              o.position.toLowerCase().includes('punong')) &&
            o.status === 'Active'
          );
          if (activeCaptain) setCaptainName(activeCaptain.full_name.toUpperCase());

          const activeKagawad = safeOfficialsList.find((o: IOfficial) =>
            o.position.toLowerCase().includes('kagawad') &&
            o.status === 'Active'
          );
          if (activeKagawad) setKagawadName(activeKagawad.full_name.toUpperCase());
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

  return { residents, captainName, kagawadName, autoFilledAddress };
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