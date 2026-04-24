import { type IResident } from '../../Resident_modal'; 
// Import the PGSU Engine (Adjust the path to match where you saved location.ts)
import { PGSU } from './location'; 

/**
 * Logic_Error.ts - THE VALIDATION ENGINE (STRICT PAYLOAD EDITION)
 * Exhaustive validation enforcing zero-tolerance for symbols/numbers in text fields,
 * precise calendar math, and surgical cascading locations.
 */

export const validateResidentForm = (data: IResident): Record<string, string> => {
  const errors: Record<string, string> = {};

  // =========================================================================
  // 1. STRICT ALPHABETICAL VALIDATION (Letters, spaces, and ñ/Ñ ONLY)
  // =========================================================================
  const alphaOnlyRegex = /^[A-Za-z\sñÑ]+$/; 

  if (!data.firstName?.trim()) {
    errors.firstName = "FIRST NAME IS REQUIRED.";
  } else if (!alphaOnlyRegex.test(data.firstName)) {
    errors.firstName = "USE ONLY LETTERS (A-Z). NO NUMBERS OR SYMBOLS ALLOWED.";
  }

  if (!data.lastName?.trim()) {
    errors.lastName = "LAST NAME IS REQUIRED.";
  } else if (!alphaOnlyRegex.test(data.lastName)) {
    errors.lastName = "USE ONLY LETTERS (A-Z). NO NUMBERS OR SYMBOLS ALLOWED.";
  }

  if (data.middleName?.trim() && !alphaOnlyRegex.test(data.middleName)) {
    errors.middleName = "USE ONLY LETTERS (A-Z). NO NUMBERS OR SYMBOLS ALLOWED.";
  }

  // =========================================================================
  // 2. RELIGION VALIDATION (Strictly characters only for custom entries)
  // =========================================================================
  if (data.religion?.trim() && !alphaOnlyRegex.test(data.religion)) {
    errors.religion = "RELIGION MUST CONTAIN ONLY LETTERS. NO NUMBERS/SYMBOLS.";
  }

  // =========================================================================
  // 3. THE SMART DATE ENGINE (Strict numerical parsing & Calendar Math)
  // =========================================================================
  if (!data.dob) {
    errors.dob = "DATE OF BIRTH IS REQUIRED.";
  } else {
    // Enforce strict numerical format, blocking letters entirely
    const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/;
    const match = data.dob.match(dateRegex);

    if (!match) {
      errors.dob = "INVALID FORMAT. USE YYYY-MM-DD (LETTERS/SYMBOLS ARE NOT ALLOWED).";
    } else {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);

      // A. Year bounds check
      if (year < 1900 || year > 2100) {
        errors.dob = "YEAR IS OUT OF ACCEPTABLE RANGE.";
      }
      
      // B. Month bounds check
      else if (month < 1 || month > 12) {
        errors.dob = "MONTH MUST BE BETWEEN 01 AND 12.";
      }
      
      // C. Smart Day check (Calculates exact days in that specific month/year, handling leap years)
      else {
        const daysInSelectedMonth = new Date(year, month, 0).getDate();
        if (day < 1 || day > daysInSelectedMonth) {
          errors.dob = `INVALID DAY. MONTH ${month} ONLY HAS ${daysInSelectedMonth} DAYS.`;
        } else {
          // D. Logic & Age checks (Only runs if the date is mathematically valid)
          const birthDate = new Date(year, month - 1, day);
          const today = new Date();
          
          if (birthDate > today) {
            errors.dob = "BIRTHDAY CANNOT BE IN THE FUTURE.";
          } else {
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;

            // Senior 60+ Check
            if (data.isSeniorCitizen && age < 60) {
              errors.seniorIdNumber = "RESIDENT MUST BE 60+ YEARS OLD FOR SENIOR STATUS.";
            }
          }
        }
      }
    }
  }

  // =========================================================================
  // 4. SURGICAL CASCADING LOCATION VALIDATION (Powered by PGSU)
  // =========================================================================
  if (!data.birthCountry?.trim()) {
    errors.birthCountry = "COUNTRY OF BIRTH IS REQUIRED.";
  }

  if (data.birthCountry?.toUpperCase() === "PHILIPPINES") {
    const prov = data.birthProvince?.trim() || "";
    const city = data.birthCity?.trim() || "";

    if (!prov) {
      errors.birthProvince = "PROVINCE IS REQUIRED.";
    } else if (!alphaOnlyRegex.test(prov)) {
      errors.birthProvince = "PROVINCE MUST CONTAIN ONLY LETTERS.";
    }

    if (!city) {
      errors.birthCity = "CITY/MUNICIPALITY IS REQUIRED.";
    } else if (!alphaOnlyRegex.test(city)) {
      errors.birthCity = "CITY MUST CONTAIN ONLY LETTERS.";
    }

    // The Surgical Validation: Check if City belongs to Province using PGSU
    if (prov && city && alphaOnlyRegex.test(prov) && alphaOnlyRegex.test(city)) {
      if (!PGSU.isValidCity(prov.toUpperCase(), city.toUpperCase())) {
         errors.birthCity = `THE CITY '${city.toUpperCase()}' DOES NOT BELONG TO PROVINCE '${prov.toUpperCase()}'.`;
      }
    }
  }

  // =========================================================================
  // 5. CONTACT & EMAIL
  // =========================================================================
  // Strictly enforce an 11-digit number starting with 09
  const phoneRegex = /^09\d{9}$/;
  if (!data.contact_number || data.contact_number.trim() === "" || data.contact_number === "09") {
    // Optional: If contact number is truly optional, you can remove this first block.
    // Assuming it is required based on your previous logic.
    errors.contact_number = "CONTACT NUMBER IS REQUIRED.";
  } else if (!phoneRegex.test(data.contact_number)) {
    errors.contact_number = "INVALID FORMAT: MUST BE EXACTLY 11 NUMBERS STARTING WITH 09.";
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (data.email && !emailRegex.test(data.email)) {
    errors.email = "INVALID EMAIL ADDRESS.";
  }

  // =========================================================================
  // 6. RESIDENCE VALIDATION
  // =========================================================================
  if (!data.currentAddress?.trim()) errors.currentAddress = "CURRENT ADDRESS IS REQUIRED.";
  if (!data.purok?.trim()) errors.purok = "PUROK SELECTION IS REQUIRED.";

  // =========================================================================
  // 7. SOCIO-ECONOMIC VALIDATION
  // =========================================================================
  const employmentStatusUpper = data.employmentStatus?.toUpperCase() || "";
  if (
    employmentStatusUpper !== "UNEMPLOYED" && 
    employmentStatusUpper !== "STUDENT" && 
    !data.occupation?.trim()
  ) {
    errors.occupation = "PLEASE SPECIFY OCCUPATION FOR EMPLOYED STATUS.";
  }

  // =========================================================================
  // 8. CONDITIONAL ID CHECKS
  // =========================================================================
  if (data.isPWD && !data.pwdIdNumber?.trim()) errors.pwdIdNumber = "PWD ID IS REQUIRED.";
  if (data.is4Ps && !data.fourPsIdNumber?.trim()) errors.fourPsIdNumber = "4PS ID IS REQUIRED.";
  if (data.isSoloParent && !data.soloParentIdNumber?.trim()) errors.soloParentIdNumber = "SOLO PARENT ID IS REQUIRED.";
  if (data.isSeniorCitizen && !data.seniorIdNumber?.trim()) errors.seniorIdNumber = "SENIOR ID IS REQUIRED.";

  return errors;
};