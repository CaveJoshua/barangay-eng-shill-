// Shared between Official_Resetpassword_modal.tsx and AccountManagement.tsx —
// both render a live password-requirement checklist and strength label. Kept
// as one module so the two stay in sync with each other and with
// server/lib/PasswordPolicy.js (the actual source of truth enforced server-side).

export interface PasswordCheck {
  label: string;
  met: boolean;
}

// Mirrors server/lib/PasswordPolicy.js's escapeRegex — firstName/username are
// account data, not guaranteed "clean" text, and must not be interpolated
// into a RegExp unescaped.
export const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Mirrors validateNewPassword's rules that are actually computable
// client-side (no access here to the account's current password hash or its
// exact username, so "differs from current password" and "not your
// username" stay server-only checks).
export const getPasswordChecks = (password: string, firstName: string): PasswordCheck[] => {
  const lower = password.toLowerCase();
  const cleanFirst = firstName.trim().toLowerCase();
  const classCount = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(password)).length;
  const escapedFirst = escapeRegex(cleanFirst);

  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'At least 3 of: lowercase, UPPERCASE, numbers, symbols', met: classCount >= 3 },
    { label: 'Not your own name', met: !(cleanFirst && lower === cleanFirst) },
    {
      label: 'Not your name followed by numbers (e.g. felizardo123456)',
      met: !(cleanFirst && new RegExp(`^${escapedFirst}\\d{4,6}$`).test(lower)),
    },
  ];
};

export type PasswordStrength = 'Weak' | 'Fair' | 'Strong';

// A password that fails any checklist rule is always "Weak" — it'll be
// server-rejected regardless of length/variety, so strength only becomes
// meaningful once every rule passes.
export const getPasswordStrength = (password: string, checks: PasswordCheck[]): PasswordStrength => {
  if (password.length === 0 || !checks.every(c => c.met)) return 'Weak';

  const classCount = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(re => re.test(password)).length;
  if (password.length >= 12 && classCount === 4) return 'Strong';
  return 'Fair';
};

export const strengthColor = (strength: PasswordStrength): string =>
  strength === 'Strong' ? '#16a34a' : strength === 'Fair' ? '#d97706' : '#dc2626';
