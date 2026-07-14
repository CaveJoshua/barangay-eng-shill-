import bcrypt from 'bcryptjs';

// Rejects a proposed NEW password before it's hashed and stored. Runs at
// every password-set path (self-service reset, admin-assisted reset,
// first-login forced reset) so the rule can't be bypassed via a different
// route. `context` identifies the account the password is being set FOR, so
// the "still the generated shape" check can be evaluated against THEIR OWN
// name/username rather than a generic pattern.
//
// Returns null when the password is acceptable, or a user-facing error
// string identifying exactly what's wrong.
export const validateNewPassword = async (newPassword, { currentHash = null, firstName = '', username = '' } = {}) => {
    const pass = String(newPassword || '');

    if (pass.length < 8) {
        return 'Password must be at least 8 characters.';
    }

    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
    const classCount = classes.filter(re => re.test(pass)).length;
    if (classCount < 3) {
        return 'Password must contain at least 3 of: lowercase letters, uppercase letters, numbers, symbols.';
    }

    const cleanFirst = String(firstName || '').trim().toLowerCase();
    const cleanUser = String(username || '').split('@')[0].trim().toLowerCase();
    const lowerPass = pass.toLowerCase();

    if ((cleanFirst && lowerPass === cleanFirst) || (cleanUser && lowerPass === cleanUser)) {
        return 'Password must not be your own name or username.';
    }

    // "Still the generated shape" — name (or username) immediately followed by
    // trailing digits, e.g. felizardo123456 or beh001123456. Catches a
    // "reset" that only tweaks the digits and keeps the guessable structure.
    if (cleanFirst && new RegExp(`^${cleanFirst}\\d{4,6}$`).test(lowerPass)) {
        return 'Password is too predictable — do not use your name followed by numbers.';
    }
    if (cleanUser && new RegExp(`^${cleanUser}\\d{4,6}$`).test(lowerPass)) {
        return 'Password is too predictable — do not use your username followed by numbers.';
    }

    if (currentHash) {
        const unchanged = await bcrypt.compare(pass, currentHash);
        if (unchanged) {
            return 'New password must be different from your current password.';
        }
    }

    return null;
};
