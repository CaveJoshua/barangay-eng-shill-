import { type IResident } from '../../Resident_modal';
import { ResidentMapper } from './DataMapper';
import { API_BASE_URL } from '../../../UI/api';
import { getAuthHeaders, verifyActionSecurity } from './Authentication';

/**
 * P.G.S.U. DATA RECOVERY ENGINE
 * Updated: Replaced regex with strict CSV parser, patched silent HTTP failures, 
 * and added credentials to fix the 401 Unauthorized cookie rejection.
 */

export const exportResidentsToCSV = (residents: IResident[]) => {
  if (!residents || residents.length === 0) {
    alert("No data available to export.");
    return;
  }

  const headers = [
    "lastName", "firstName", "middleName", "sex", "dob",
    "birthCountry", "birthProvince", "birthCity", "birthBarangay", "birthPlace",
    "nationality", "religion", "contact_number", "email", "currentAddress", "purok",
    "civilStatus", "education", "employment", "employmentStatus", "occupation",
    "isVoter", "isPWD", "is4Ps", "isSoloParent", "isSeniorCitizen", "isIP",
    "voterIdNumber", "pwdIdNumber", "soloParentIdNumber", "seniorIdNumber", "fourPsIdNumber",
    "activityStatus"
  ];

  const rows = residents.map(res => {
    return headers.map(header => {
      const value = (res as any)[header] ?? "";
      const stringValue = String(value).replace(/"/g, '""');
      return `"${stringValue}"`;
    }).join(",");
  });

  const csvContent = "\uFEFF" + headers.join(",") + "\n" + rows.join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `data_base_backup_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
};

const parseCSVRow = (row: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '"' && row[i + 1] === '"') { 
      current += '"'; 
      i++; 
    } else if (row[i] === '"') { 
      inQuotes = !inQuotes; 
    } else if (row[i] === ',' && !inQuotes) { 
      values.push(current); 
      current = ''; 
    } else { 
      current += row[i]; 
    }
  }
  values.push(current);
  return values;
};

export const importResidentsFromCSV = async (
  event: React.ChangeEvent<HTMLInputElement>,
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  onProgress: (percent: number) => void,
  onComplete: () => void
) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const isAuthorized = await verifyActionSecurity();
  if (!isAuthorized) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target?.result as string;
    if (!text) return;

    try {
      const lines = text.split(/\r?\n/);
      const headers = lines[0].split(",").map(h => h.replace(/"/g, '').trim());
      const dataRows = lines.slice(1).filter(line => line.trim() !== "");

      let failedRows = 0;

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        
        // Use proper CSV parsing to prevent breaking on internal commas
        const values = parseCSVRow(row);
        
        const tempObj: any = {};
        headers.forEach((h, idx) => { tempObj[h] = values[idx]?.trim() || ""; });

        // Force Boolean conversion before mapping
        const boolKeys = ['isVoter', 'isPWD', 'is4Ps', 'isSoloParent', 'isSeniorCitizen', 'isIP'];
        boolKeys.forEach(k => {
            tempObj[k] = String(tempObj[k]).toLowerCase() === 'true';
        });

        // Use your original Mapper
        const dbPayload = ResidentMapper.toDB(tempObj as IResident);

        const authHeaders = getAuthHeaders();
        
        const response = await fetch(`${API_BASE_URL}/residents`, {
          method: 'POST',
          headers: authHeaders,
          credentials: 'include', // 🛡️ CRITICAL FIX: Ensures the auth cookie travels with the request
          body: JSON.stringify(dbPayload)
        });

        // Strict HTTP Error Checking
        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          console.error(`[ROW ${i + 2}] Import Failed: HTTP ${response.status}`, errBody);
          
          if (response.status === 401) {
              console.error("Critical: 401 Unauthorized. Token rejected by backend.");
              alert("Your session expired. Please log out and log back in before trying again.");
              break; 
          }
          
          failedRows++;
          continue; // Skip to next row instead of silently halting
        }

        onProgress(Math.round(((i + 1) / dataRows.length) * 100));
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 30));
      }

      onComplete();
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (failedRows > 0) {
        console.warn(`${failedRows} rows failed to import. Check console for details.`);
        alert(`Import complete, but ${failedRows} records failed to save. Check developer console.`);
      }

    } catch (err) {
      console.error("[RESTORE_FAILED]", err);
      alert("Error during restoration. Check console.");
    }
  };
  reader.readAsText(file);
};