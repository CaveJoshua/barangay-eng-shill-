// Adjust this import path to point to your new Mastermind api.ts file
import { 
  getAuthHeaders, 
  RESIDENTS_API, 
  OFFICIALS_API, 
  BLOTTER_API 
} from '../../UI/api'; 

// --- FETCH RESIDENTS (VIA CENTRAL API) ---
export const fetchResidentsAPI = async () => {
  const res = await fetch(RESIDENTS_API, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch residents');
  return await res.json();
};

// --- FETCH OFFICIALS (VIA CENTRAL API) ---
export const fetchOfficialsAPI = async () => {
  const res = await fetch(OFFICIALS_API, {
    headers: getAuthHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch officials');
  return await res.json();
};

// --- SAVE / UPDATE BLOTTER (VIA CENTRAL API) ---
export const saveBlotterAPI = async (id: string | null, submissionData: any) => {
  // Dynamically build the URL using the base BLOTTER_API
  const url = id ? `${BLOTTER_API}/${id}` : BLOTTER_API;
  const method = id ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: getAuthHeaders(),
    body: JSON.stringify(submissionData),
  });

  if (res.status === 403) throw new Error("Access Denied: Insufficient permissions.");
  if (res.status === 401) throw new Error("Session expired. Please log in again.");
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Server Error');
  }
  
  return await res.json();
};