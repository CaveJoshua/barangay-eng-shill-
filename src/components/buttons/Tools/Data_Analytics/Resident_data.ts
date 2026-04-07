// ─── Resident Data Types & Processing ────────────────────────────────────────

import { getAge } from './Data_Math';

/**
 * Resident record interface
 */
export interface Resident {
  record_id: string;
  sex?: string;
  dob?: string;
  purok?: string;
  is_voter?: boolean;
  is_pwd?: boolean;
  is_4ps?: boolean;
  is_solo_parent?: boolean;
  is_senior_citizen?: boolean;
}

/**
 * Calculate sex distribution from residents
 * @param residents - Array of resident records
 * @returns Sex distribution object
 */
export const calculateSexDistribution = (residents: Resident[]) => {
  let male = 0, female = 0, otherSex = 0;
  
  residents.forEach(r => {
    const s = (r.sex || '').toUpperCase();
    if (s.startsWith('M')) male++;
    else if (s.startsWith('F')) female++;
    else otherSex++;
  });

  return { male, female, otherSex };
};

/**
 * Calculate age group distribution
 * @param residents - Array of resident records
 * @returns Age group counts
 */
export const calculateAgeDistribution = (residents: Resident[]) => {
  const ages: Record<string, number> = {
    '0–17': 0,
    '18–35': 0,
    '36–59': 0,
    '60+': 0,
  };
  
  residents.forEach(r => {
    const a = getAge(r.dob);
    if (a === null) return;
    if (a <= 17) ages['0–17']++;
    else if (a <= 35) ages['18–35']++;
    else if (a <= 59) ages['36–59']++;
    else ages['60+']++;
  });

  return ages;
};

/**
 * Calculate special category counts (PWD, 4Ps, etc.)
 * @param residents - Array of resident records
 * @returns Special categories object
 */
export const calculateSpecialCategories = (residents: Resident[]) => {
  return {
    Voter: residents.filter(r => r.is_voter).length,
    PWD: residents.filter(r => r.is_pwd).length,
    '4Ps Member': residents.filter(r => r.is_4ps).length,
    'Solo Parent': residents.filter(r => r.is_solo_parent).length,
    'Senior Citizen': residents.filter(r => r.is_senior_citizen).length,
  };
};

/**
 * Create a map of residents by record_id for quick lookup
 * @param residents - Array of resident records
 * @returns Map of record_id to Resident
 */
export const createResidentMap = (residents: Resident[]): Map<string, Resident> => {
  const resMap = new Map<string, Resident>();
  residents.forEach(r => resMap.set(r.record_id, r));
  return resMap;
};