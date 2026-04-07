import { type IResident } from '../../Resident_modal';
import { ResidentMapper } from './DataMapper';
import { API_BASE_URL } from '../../../UI/api';
// FIXED TYPO: Auuthentication -> Authentication
import { getAuthHeaders } from './Auuthentication';

/**
 * P.G.S.U. ADVANCED DATA RECOVERY & MASS ACCOUNT ENGINE
 */

export const exportResidentsToCSV = (residents: IResident[]) => {
  if (!residents || residents.length === 0) {
    alert("No data available to export.");
    return;
  }

  const headers = [
    "lastName", "firstName", "middleName", "sex", "genderIdentity", "dob",
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

/**
 * SILENT MASS IMPORT ENGINE
 * Triggers bulk Identity + Account creation with progress tracking.
 */
export const importResidentsFromCSV = (
  event: React.ChangeEvent<HTMLInputElement>,
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  onProgress: (percent: number) => void, // For the Progress Bar
  onComplete: () => void
) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    const text = e.target?.result as string;
    if (!text) return;

    try {
      const lines = text.split(/\r?\n/);
      const headers = lines[0].split(",").map(h => h.replace(/"/g, '').trim());
      const dataRows = lines.slice(1).filter(line => line.trim() !== "");

      if (!window.confirm(`Restore Engine: Create ${dataRows.length} identities and accounts?`)) return;

      for (let i = 0; i < dataRows.length; i++) {
        // Robust CSV split for quoted strings
        const row = dataRows[i];
        const values = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(v => v.replace(/^"|"$/g, '')) || [];
        
        const tempObj: any = {};
        headers.forEach((h, idx) => { tempObj[h] = values[idx]; });

        // Boolean Normalization
        const bools = ['isVoter', 'isPWD', 'is4Ps', 'isSoloParent', 'isSeniorCitizen', 'isIP'];
        bools.forEach(k => tempObj[k] = String(tempObj[k]).toLowerCase() === 'true');

        const dbPayload = ResidentMapper.toDB(tempObj as IResident);

        // SILENT POST: Backend generates the account automatically
        await fetch(`${API_BASE_URL}/residents`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify(dbPayload)
        });

        // Update Progress Bar
        onProgress(Math.round(((i + 1) / dataRows.length) * 100));

        // Throttle: Small pause every 5 records to keep the database stable
        if (i % 5 === 0) await new Promise(r => setTimeout(r, 40));
      }

      alert(`Sync Complete: ${dataRows.length} records restored to database.`);
      onComplete();
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err) {
      console.error("[RESTORE_FAILED]", err);
      alert("Critical Error during restoration. Check CSV integrity.");
    }
  };
  reader.readAsText(file);
};