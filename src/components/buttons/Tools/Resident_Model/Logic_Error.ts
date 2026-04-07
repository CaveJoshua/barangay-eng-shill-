import { type IResident } from '../../Resident_modal'; 

/**
 * Logic_error.ts - THE VALIDATION ENGINE (ALL-CAPS EDITION)
 * Exhaustive validation for Identity, Cascading Locations, and Special Classifications.
 */

export const validateResidentForm = (data: IResident): Record<string, string> => {
  const errors: Record<string, string> = {};

  // 1. NAME VALIDATION (Letters, spaces, ñ, and dashes only)
  const nameRegex = /^[A-Z\sÑ-]+$/; 
  
  if (!data.firstName.trim()) {
    errors.firstName = "FIRST NAME IS REQUIRED.";
  } else if (!nameRegex.test(data.firstName)) {
    errors.firstName = "USE ONLY LETTERS (A-Z) AND NO NUMBERS/SYMBOLS.";
  }

  if (!data.lastName.trim()) {
    errors.lastName = "LAST NAME IS REQUIRED.";
  } else if (!nameRegex.test(data.lastName)) {
    errors.lastName = "USE ONLY LETTERS (A-Z) AND NO NUMBERS/SYMBOLS.";
  }

  // Add validation for Middle Name if it is provided
  if (data.middleName.trim() && !nameRegex.test(data.middleName)) {
    errors.middleName = "USE ONLY LETTERS (A-Z) IN MIDDLE NAME.";
  }

  // 2. AGE & SENIOR LOGIC
  if (!data.dob) {
    errors.dob = "DATE OF BIRTH IS REQUIRED.";
  } else {
    const birthDate = new Date(data.dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;

    if (birthDate > today) errors.dob = "BIRTHDAY CANNOT BE IN THE FUTURE.";
    
    // Senior 60+ Check
    if (data.isSeniorCitizen && age < 60) {
      errors.seniorIdNumber = "RESIDENT MUST BE 60+ YEARS OLD FOR SENIOR STATUS.";
    }
  }

  // 3. CASCADING LOCATION VALIDATION
  if (!data.birthCountry.trim()) {
    errors.birthCountry = "COUNTRY OF BIRTH IS REQUIRED.";
  }

  // If Philippines is selected, Province, City, and Barangay become mandatory
  if (data.birthCountry === "PHILIPPINES") {
    if (!data.birthProvince.trim()) {
      errors.birthProvince = "PROVINCE IS REQUIRED.";
    }
    if (!data.birthCity.trim()) {
      errors.birthCity = "CITY/MUNICIPALITY IS REQUIRED.";
    }
    if (!data.birthBarangay.trim()) {
      errors.birthBarangay = "BARANGAY IS REQUIRED.";
    }
  }

  // 4. CONTACT & EMAIL
    const phoneRegex = /^09\d{9}$/;

if (!data.contact_number || data.contact_number.trim() === "" || data.contact_number === "09") {
  // Trigger if empty or just the default "09" prefix
  errors.contact_number = "CONTACT NUMBER IS REQUIRED.";
} else if (!phoneRegex.test(data.contact_number)) {
  // Trigger if it doesn't match exactly 09 + 9 digits (Total 11)
  errors.contact_number = "INVALID FORMAT: MUST BE EXACTLY 11 DIGITS (E.G. 09123456789).";
}

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (data.email && !emailRegex.test(data.email)) {
    errors.email = "INVALID EMAIL ADDRESS.";
  }

  // 5. RESIDENCE VALIDATION
  if (!data.currentAddress.trim()) {
    errors.currentAddress = "CURRENT ADDRESS IS REQUIRED.";
  }
  if (!data.purok.trim()) {
    errors.purok = "PUROK SELECTION IS REQUIRED.";
  }

  // 6. SOCIO-ECONOMIC VALIDATION
  // Require occupation if status is not Unemployed or Student
  const employmentStatusUpper = data.employmentStatus.toUpperCase();
  if (
    employmentStatusUpper !== "UNEMPLOYED" && 
    employmentStatusUpper !== "STUDENT" && 
    !data.occupation.trim()
  ) {
    errors.occupation = "PLEASE SPECIFY OCCUPATION FOR EMPLOYED STATUS.";
  }

  // 7. CONDITIONAL ID CHECKS
  if (data.isPWD && !data.pwdIdNumber?.trim()) errors.pwdIdNumber = "PWD ID IS REQUIRED.";
  if (data.is4Ps && !data.fourPsIdNumber?.trim()) errors.fourPsIdNumber = "4PS ID IS REQUIRED.";
  if (data.isSoloParent && !data.soloParentIdNumber?.trim()) errors.soloParentIdNumber = "SOLO PARENT ID IS REQUIRED.";
  if (data.isSeniorCitizen && !data.seniorIdNumber?.trim()) errors.seniorIdNumber = "SENIOR ID IS REQUIRED.";

  return errors;
};