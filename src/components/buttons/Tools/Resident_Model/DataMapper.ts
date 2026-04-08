import { type IResident } from '../../Resident_modal';
import { PGSU } from './location';

/**
 * P.G.S.U. DATA TRANSFORMATION & AUTO-MAPPER ENGINE
 * Purpose: Bridges Supabase (snake_case) and React UI (camelCase).
 * Features: Automatic String Dissection, Self-Healing Location Logic, 
 * and Data Miner Normalization.
 */
export const ResidentMapper = {
  
  /**
   * AUTO-LOADER: DB -> UI
   * Transforms raw database rows into intelligent UI objects.
   */
  toUI(dbRow: any): IResident {
    // 1. Initial Identity Mapping (DB snake_case to UI camelCase)
    const resident: IResident = {
      id: dbRow.record_id || dbRow.id,
      lastName: (dbRow.last_name || '').toUpperCase().trim(),
      firstName: (dbRow.first_name || '').toUpperCase().trim(),
      middleName: (dbRow.middle_name || '').toUpperCase().trim(),
      sex: dbRow.sex || 'Male',
      dob: dbRow.dob || '',
      birthPlace: (dbRow.birth_place || '').toUpperCase().trim(),
      birthCountry: (dbRow.birth_country || 'PHILIPPINES').toUpperCase().trim(),
      birthProvince: (dbRow.birth_province || '').toUpperCase().trim(),
      birthCity: (dbRow.birth_city || '').toUpperCase().trim(),
      nationality: (dbRow.nationality || 'FILIPINO').toUpperCase().trim(),
      religion: (dbRow.religion || 'ROMAN CATHOLIC').toUpperCase().trim(),
      contact_number: dbRow.contact_number || '',
      email: dbRow.email || '',
      currentAddress: (dbRow.current_address || '').toUpperCase().trim(),
      purok: dbRow.purok || '',
      civilStatus: dbRow.civil_status || 'Single',
      education: dbRow.education || 'None',
      employment: (dbRow.employment || '').toUpperCase().trim(),
      employmentStatus: dbRow.employment_status || 'Unemployed',
      occupation: (dbRow.occupation || '').toUpperCase().trim(),
      activityStatus: dbRow.activity_status || 'Active',
      isVoter: dbRow.is_voter || false,
      isPWD: dbRow.is_pwd || false,
      is4Ps: dbRow.is_4ps || false,
      isSoloParent: dbRow.is_solo_parent || false,
      isSeniorCitizen: dbRow.is_senior_citizen || false,
      isIP: dbRow.is_ip || false,
      voterIdNumber: dbRow.voter_id_number || '',
      pwdIdNumber: dbRow.pwd_id_number || '',
      soloParentIdNumber: dbRow.solo_parent_id_number || '',
      seniorIdNumber: dbRow.senior_id_number || '',
      fourPsIdNumber: dbRow.four_ps_id_number || ''
    };

    // 2. AUTO-DISSECTION LOGIC
    // If the individual DB columns for location are empty but the birth_place string exists,
    // the mapper automatically slices the string to populate the UI dropdowns.
    if (resident.birthPlace && (!resident.birthProvince || !resident.birthCity)) {
      const parts = resident.birthPlace.split(',').map(part => part.trim().toUpperCase());
      if (parts.length >= 4) {
        resident.birthCountry = parts[0];
        resident.birthProvince = parts[1];
        resident.birthCity = parts[2];
      }
    }

    // 3. SELF-HEALING ENGINE (The Baguio Fix)
    // Checks if the "Province" slot contains a known City name.
    // If it does, the engine shifts the city into the correct slot and looks up the real Province.
    const correctedProvince = PGSU.findProvinceOfCity(resident.birthProvince);
    if (correctedProvince && resident.birthProvince !== correctedProvince) {
      // Re-align the data chain
      resident.birthCity = resident.birthProvince; // e.g. "BAGUIO"
      resident.birthProvince = correctedProvince; // e.g. "BENGUET"
    }

    return resident;
  },

  /**
   * PREPARATION LAYER: UI -> DB
   * Prepares the UI state for Supabase insertion using strict snake_case naming.
   */
  toDB(ui: IResident) {
    // Standardize all text data to Uppercase for the database miner consistency
    const bProv = (ui.birthProvince || '').toUpperCase().trim();
    const bCity = (ui.birthCity || '').toUpperCase().trim();
    const bCountry = (ui.birthCountry || 'PHILIPPINES').toUpperCase().trim();

    // Construct the legacy birth_place string for older report compatibility
    const combinedPlace = `${bCountry}, ${bProv}, ${bCity}, `;

    return {
      first_name: ui.firstName.toUpperCase().trim(),
      middle_name: ui.middleName.toUpperCase().trim(),
      last_name: ui.lastName.toUpperCase().trim(),
      sex: ui.sex,
      dob: ui.dob,
      birth_country: bCountry,
      birth_province: bProv,
      birth_city: bCity,
      birth_place: combinedPlace,
      nationality: ui.nationality.toUpperCase().trim(),
      religion: ui.religion.toUpperCase().trim(),
      contact_number: ui.contact_number,
      email: ui.email,
      current_address: ui.currentAddress.toUpperCase().trim(),
      purok: ui.purok,
      civil_status: ui.civilStatus,
      education: ui.education,
      employment: ui.employment.toUpperCase().trim(),
      employment_status: ui.employmentStatus,
      occupation: ui.occupation.toUpperCase().trim(),
      is_voter: ui.isVoter,
      is_pwd: ui.isPWD,
      is_4ps: ui.is4Ps,
      is_solo_parent: ui.isSoloParent,
      is_senior_citizen: ui.isSeniorCitizen,
      is_ip: ui.isIP,
      voter_id_number: ui.voterIdNumber || '',
      pwd_id_number: ui.pwdIdNumber || '',
      solo_parent_id_number: ui.soloParentIdNumber || '',
      senior_id_number: ui.seniorIdNumber || '',
      four_ps_id_number: ui.fourPsIdNumber || '',
      activity_status: ui.activityStatus
    };
  }
};