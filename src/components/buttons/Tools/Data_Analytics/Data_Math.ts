// ─── Mathematical Helper Functions ───────────────────────────────────────────

/**
 * Calculate age from date of birth
 * @param dob - ISO date string
 * @returns Age in years or null if invalid
 */
export const getAge = (dob?: string): number | null => {
  if (!dob) return null;
  const d = new Date(dob);
  return isNaN(d.getTime())
    ? null
    : Math.floor((Date.now() - d.getTime()) / (365.25 * 86_400_000));
};

/**
 * Format ISO date to short display format (M/D)
 * @param iso - ISO date string
 * @returns Formatted date string
 */
export const fmtDay = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/**
 * Format YYYY-MM key to short month format (e.g., "Jan'24")
 * @param key - Date key in YYYY-MM format
 * @returns Formatted month string
 */
export const fmtMonth = (key: string): string => {
  const [yr, mo] = key.split('-');
  return `${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+mo - 1]}'${yr.slice(2)}`;
};

/**
 * Calculate exponential decay weight based on recency
 * Used for time-weighted predictions
 * @param isoDate - ISO date string
 * @returns Decay weight (0-1)
 */
export const decayW = (isoDate: string): number =>
  Math.exp(-0.025 * ((Date.now() - new Date(isoDate).getTime()) / 86_400_000));