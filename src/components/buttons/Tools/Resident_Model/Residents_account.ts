// 1. IMPORT MASTER CONTROL & IDENTITY INTERFACE
import { RESIDENTS_API, getAuthHeaders } from '../../../UI/api'; 
import { type IResident } from '../../Resident_modal';

/**
 * 2. The Identity Engine
 * Decouples the UI from the Database communication.
 * Now using centralized RESIDENTS_API and getAuthHeaders.
 */
export const handleResidentSubmit = async (formData: IResident) => {
  try {
    // A. STRICT DATABASE MAPPING (Snake_Case Alignment)
    // Mapping frontend CamelCase to SQL Schema. 
    // NOTE: genderIdentity has been removed per your instructions, boss.
    const dbPayload: Record<string, any> = {
      first_name: formData.firstName,
      last_name: formData.lastName,
      middle_name: formData.middleName,
      sex: formData.sex,
      dob: formData.dob,
      birth_place: formData.birthPlace,
      nationality: formData.nationality,
      religion: formData.religion,
      contact_number: formData.contact_number,
      email: formData.email,
      current_address: formData.currentAddress,
      purok: formData.purok,
      civil_status: formData.civilStatus, // Normalized to snake_case for DB consistency
      education: formData.education,
      employment: formData.employment,
      employment_status: formData.employmentStatus, 
      occupation: formData.occupation,
      activity_status: formData.activityStatus,
      is_voter: formData.isVoter,
      is_pwd: formData.isPWD,
      is_4ps: formData.is4Ps,
      is_solo_parent: formData.isSoloParent,
      is_senior_citizen: formData.isSeniorCitizen,
      is_ip: formData.isIP,
      voter_id_number: formData.voterIdNumber,
      pwd_id_number: formData.pwdIdNumber,
      solo_parent_id_number: formData.soloParentIdNumber,
      senior_id_number: formData.seniorIdNumber,
      four_ps_id_number: formData.fourPsIdNumber
    };

    // B. Data Cleaning
    // Removes any undefined or empty fields to prevent PostgreSQL syntax errors.
    Object.keys(dbPayload).forEach(key => {
      if (dbPayload[key] === undefined || dbPayload[key] === '') delete dbPayload[key];
    });

    const method = formData.id ? 'PUT' : 'POST';
    const url = formData.id ? `${RESIDENTS_API}/${formData.id}` : RESIDENTS_API;

    // C. THE FETCH HANDSHAKE
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(), 
      body: JSON.stringify(dbPayload)
    });

    // D. CRITICAL: Handle non-JSON responses (Prevents the "Unexpected token <" crash)
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      console.error("Server Error Response:", text);
      throw new Error("Server configuration mismatch. The engine is knocking on the wrong door (Non-JSON response).");
    }

    const result = await res.json();

    // E. STATUS CHECKS
    if (res.status === 403) throw new Error("Access Denied: Check permissions.");
    if (res.status === 401) throw new Error("Session expired. Re-login required.");
    if (!res.ok) throw new Error(result.error || 'Identity Sync Failed');

    // F. ACCOUNT CREATION FEEDBACK
    if (method === 'POST' && result.account) {
      handleAccountCreationFeedback(formData, result.account);
    } else {
      console.log(formData.id ? 'Identity Updated.' : 'Identity Established.');
    }

    return result; 

  } catch (err: any) {
    alert(`Precision Error: ${err.message}`);
    return null;
  }
};

/**
 * 3. Account Identity Formatter
 * Formats the auto-generated credentials for the resident.
 */
const handleAccountCreationFeedback = (formData: IResident, account: any) => {
  const cleanFName = formData.firstName.toLowerCase().replace(/\s/g, '');
  const generatedPassword = `${cleanFName}123456`;
  
  // ENFORCING DOMAIN FORMAT: residents.eng-hill.brg.ph
  const rawUsername = account.username.split('@')[0];
  const displayUsername = `${rawUsername}@residents.eng-hill.brg.ph`;

  alert(`
    RESIDENT IDENTITY ESTABLISHED!
    
    SYSTEM ACCESS GRANTED:
    -----------------------------------
    Username: ${displayUsername}
    Password: ${generatedPassword} 
    -----------------------------------
    Scope: Identity-Linked Account ( residents.eng-hill.brg.ph )
    
    Please provide these credentials to the resident for portal access.
  `);
};