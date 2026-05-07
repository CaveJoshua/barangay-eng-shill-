import { type IResident } from '../../Resident_modal';

/**
 * P.G.S.U. DATA TRANSFORMATION — STRICT MODE (V14.6)
 * Resolved TypeScript interface errors (Removed unregistered birthBarangay and unused PGSU).
 */
export const ResidentMapper = {
  
  /**
   * AUTO-LOADER: DB -> UI
   */
  toUI(dbRow: any): IResident {
    return {
      id: dbRow.record_id || dbRow.id,
      lastName: (dbRow.lastName || dbRow.last_name || '').toUpperCase().trim(),
      firstName: (dbRow.firstName || dbRow.first_name || '').toUpperCase().trim(),
      middleName: (dbRow.middleName || dbRow.middle_name || '').toUpperCase().trim(),
      sex: dbRow.sex || 'Male',
      dob: dbRow.dob || '',
      birthCountry: (dbRow.birthCountry || dbRow.birth_country || 'PHILIPPINES').toUpperCase().trim(),
      birthProvince: (dbRow.birthProvince || dbRow.birth_province || '').toUpperCase().trim(),
      birthCity: (dbRow.birthCity || dbRow.birth_city || '').toUpperCase().trim(),
      birthPlace: (dbRow.birthPlace || dbRow.birth_place || '').toUpperCase().trim(),
      nationality: (dbRow.nationality || 'FILIPINO').toUpperCase().trim(),
      religion: (dbRow.religion || 'ROMAN CATHOLIC').toUpperCase().trim(),
      contact_number: dbRow.contact_number || dbRow.contactNumber || '',
      email: dbRow.email || '',
      currentAddress: (dbRow.currentAddress || dbRow.current_address || '').toUpperCase().trim(),
      purok: dbRow.purok || '',
      civilStatus: dbRow.civilStatus || dbRow.civil_status || 'Single',
      education: dbRow.education || 'None',
      employment: (dbRow.employment || '').toUpperCase().trim(),
      employmentStatus: dbRow.employmentStatus || dbRow.employment_status || 'Unemployed',
      occupation: (dbRow.occupation || '').toUpperCase().trim(),
      isVoter: !!(dbRow.isVoter || dbRow.is_voter),
      isPWD: !!(dbRow.isPWD || dbRow.is_pwd),
      is4Ps: !!(dbRow.is4Ps || dbRow.is_4ps),
      isSoloParent: !!(dbRow.isSoloParent || dbRow.is_solo_parent),
      isSeniorCitizen: !!(dbRow.isSeniorCitizen || dbRow.is_senior_citizen),
      
      voterIdNumber: dbRow.voterIdNumber || dbRow.voter_id_number || '',
      pwdIdNumber: dbRow.pwdIdNumber || dbRow.pwd_id_number || '',
      soloParentIdNumber: dbRow.soloParentIdNumber || dbRow.solo_parent_id_number || '',
      seniorIdNumber: dbRow.seniorIdNumber || dbRow.senior_id_number || '',
      fourPsIdNumber: dbRow.fourPsIdNumber || dbRow.four_ps_id_number || '',
      activityStatus: dbRow.activityStatus || dbRow.activity_status || 'Active'
    };
  },

  /**
   * PREPARATION LAYER: UI -> DB
   */
  toDB(ui: IResident) {
    // Helper to ensure empty strings are null (Postgres friendly)
    const clean = (val: any) => (val === undefined || val === null || val === '') ? null : String(val).trim();

    // Standardize Booleans (Postgres strict)
    const bool = (val: any) => {
        if (typeof val === 'boolean') return val;
        return String(val).toLowerCase() === 'true';
    };

    return {
      lastName: clean(ui.lastName?.toUpperCase()),
      firstName: clean(ui.firstName?.toUpperCase()),
      middleName: clean(ui.middleName?.toUpperCase()),
      sex: ui.sex || 'Male',
      dob: clean(ui.dob), 
      birthCountry: clean(ui.birthCountry?.toUpperCase()) || 'PHILIPPINES',
      birthProvince: clean(ui.birthProvince?.toUpperCase()),
      birthCity: clean(ui.birthCity?.toUpperCase()),
      birthPlace: clean(ui.birthPlace?.toUpperCase()),
      nationality: clean(ui.nationality?.toUpperCase()) || 'FILIPINO',
      religion: clean(ui.religion?.toUpperCase()) || 'ROMAN CATHOLIC',
      contact_number: clean(ui.contact_number),
      email: clean(ui.email),
      currentAddress: clean(ui.currentAddress?.toUpperCase()),
      purok: clean(ui.purok),
      civilStatus: ui.civilStatus || 'Single',
      education: ui.education || 'None',
      employment: clean(ui.employment?.toUpperCase()),
      employmentStatus: ui.employmentStatus || 'Unemployed',
      occupation: clean(ui.occupation?.toUpperCase()),
      isVoter: bool(ui.isVoter),
      isPWD: bool(ui.isPWD),
      is4Ps: bool(ui.is4Ps),
      isSoloParent: bool(ui.isSoloParent),
      isSeniorCitizen: bool(ui.isSeniorCitizen),
      
      voterIdNumber: clean(ui.voterIdNumber),
      pwdIdNumber: clean(ui.pwdIdNumber),
      soloParentIdNumber: clean(ui.soloParentIdNumber),
      seniorIdNumber: clean(ui.seniorIdNumber),
      fourPsIdNumber: clean(ui.fourPsIdNumber),
      activityStatus: ui.activityStatus || 'Active'
    };
  }
};