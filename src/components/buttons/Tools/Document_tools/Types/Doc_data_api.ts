import { useState, useEffect } from 'react';
// Import the Mastermind Service
import { ApiService } from '../../../../UI/api'; 

// --- INTERFACES ---
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

/**
 * Hook to handle API interactions with RBAC Handshake.
 */
export const useDocumentDataAPI = (initialResidentName: string, initialResidentId?: string) => {
  const [residents, setResidents] = useState<IResident[]>([]);
  const [captainName, setCaptainName] = useState('AMADO M. FELIZARDO');
  const [autoFilledAddress, setAutoFilledAddress] = useState('');

  useEffect(() => {
    // The "Valve" to prevent memory leaks if the modal closes mid-fetch
    const valve = new AbortController();

    const fetchData = async () => {
      try {
        // Use the Universal Handshake to fetch both simultaneously
        const [residentList, officialsData] = await Promise.all([
          ApiService.getResidents(valve.signal),
          ApiService.getOfficials(valve.signal)
        ]);

        // 1. PROCESS RESIDENTS (If Handshake wasn't rejected)
        if (residentList !== null) {
          const safeResidentList = Array.isArray(residentList) ? residentList : (residentList.residents || []);
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
              if (matched.current_address && matched.current_address.toLowerCase() !== 'n/a') addrParts.push(matched.current_address);
              if (matched.purok) addrParts.push(matched.purok);
              setAutoFilledAddress(addrParts.join(', '));
            }
          }
        }

        // 2. PROCESS OFFICIALS (If Handshake wasn't rejected)
        if (officialsData !== null) {
          const safeOfficialsList = Array.isArray(officialsData) ? officialsData : (officialsData.officials || []);
          
          // Looks for the Punong Barangay / Captain
          const activeCaptain = safeOfficialsList.find((o: IOfficial) => 
            (o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')) && 
            o.status === 'Active'
          );
          
          if (activeCaptain) {
            setCaptainName(activeCaptain.full_name.toUpperCase());
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error("API Fetch Error:", err);
        }
      }
    };

    fetchData();

    return () => valve.abort();
  }, [initialResidentName, initialResidentId]);

  return { residents, captainName, autoFilledAddress };
};

/**
 * Save document record using the Mastermind Trigger
 */
export const saveDocumentRecord = async (payload: any) => {
  // We don't need customHeaders anymore, ApiService handles it.
  
  // Use the universal triggerAction we mapped in api.ts
  const result = await ApiService.saveDocumentRecord(payload);

  if (!result.success) {
    // If the trigger failed (e.g. 403 Denied), throw the error so the UI can catch it
    throw new Error(result.error || 'Database save failed');
  }
  
  return result.data;
};