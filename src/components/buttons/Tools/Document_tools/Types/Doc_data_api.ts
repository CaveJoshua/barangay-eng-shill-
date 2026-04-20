import { useState, useEffect } from 'react';
import { ApiService } from '../../../../UI/api'; 

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
  
  // STRICTLY DYNAMIC: No hardcoded names. 
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

        // FETCH STRICTLY BY POSITION
        if (officialsData !== null) {
          const safeOfficialsList = Array.isArray(officialsData) ? officialsData : (officialsData.officials || []);
          
          const activeCaptain = safeOfficialsList.find((o: IOfficial) => 
            (o.position.toLowerCase().includes('captain') || o.position.toLowerCase().includes('punong')) && 
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
          console.error("API Fetch Error:", err);
        }
      }
    };

    fetchData();
    return () => valve.abort();
  }, [initialResidentName, initialResidentId]);

  return { residents, captainName, kagawadName, autoFilledAddress };
};

export const saveDocumentRecord = async (payload: any) => {
  const result = await ApiService.saveDocumentRecord(payload);
  if (!result.success) throw new Error(result.error || 'Database save failed');
  return result.data;
};