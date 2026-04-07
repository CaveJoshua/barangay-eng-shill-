import bcrypt from 'bcryptjs';
import { sendAutoMail } from './Mailer.js'; 

// --- OTP Memory Storage ---
const otpStore = new Map();

// 🛡️ SECURITY HELPER 1: Hash Passwords
const hashPassword = (plain) => {
    if (!plain) return null;
    return bcrypt.hashSync(plain, 10);
};

// 🛡️ SECURITY HELPER 2: Generate Alphanumeric Code (No confusing characters)
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export const AccountManagementRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 🧠 SMART LOOKUP HELPER
    // =========================================================
    const findUserEmail = async (identifier) => {
        const { data: account } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .single();

        if (account) {
            const { data: record } = await supabase
                .from('residents_records')
                .select('email, first_name')
                .eq('record_id', account.resident_id)
                .single();
            return record ? { email: record.email, firstName: record.first_name, accountId: account.resident_id } : null;
        }

        const { data: recordByEmail } = await supabase
            .from('residents_records')
            .select('record_id, email, first_name')
            .eq('email', identifier)
            .single();

        if (recordByEmail) {
            return { email: recordByEmail.email, firstName: recordByEmail.first_name, accountId: recordByEmail.record_id };
        }
        return null;
    };

    // =========================================================
    // 1. GENERATE & SEND SECURE OTP (With Anti-Spam Cooldown)
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { email } = req.body; 
            if (!email) return res.status(400).json({ error: 'Identification required.' });
            const identifier = email.toLowerCase().trim();

            const userData = await findUserEmail(identifier);
            if (!userData || !userData.email) {
                return res.status(200).json({ success: true, message: 'If account exists, code sent.' });
            }

            const targetEmail = userData.email.toLowerCase();

            // 🛡️ ANTI-SPAM: Check if they requested a code too recently (60-second cooldown)
            const existingCode = otpStore.get(targetEmail);
            if (existingCode && Date.now() < existingCode.cooldownLimit) {
                console.log(`⏳ [ANTI-SPAM] Blocked rapid request from ${targetEmail}`);
                return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
            }

            // Generate Unique Secure Code
            const otpCode = generateSecureCode(6);
            
            // Save to memory with 5-min expiration, 3 attempts, and a 60-sec cooldown
            otpStore.set(targetEmail, { 
                code: otpCode, 
                expires: Date.now() + 300000,
                attempts: 0,
                cooldownLimit: Date.now() + 60000 
            });

            const emailMessage = `
                Hello <b>${userData.firstName || 'Resident'}</b>,<br><br>
                A password reset was requested for your account.<br><br>
                Your 5-Minute Security Code is:<br>
                <h1 style="color: #27ae60; letter-spacing: 6px; font-family: monospace; background: #f4f4f4; padding: 15px; border-radius: 8px; display: inline-block;">${otpCode}</h1><br>
                <p><i>Note: This code is case-sensitive.</i></p>
                If you did not request this, please secure your account immediately.
            `;

            const isSent = await sendAutoMail(userData.email, "Password Reset Request", "ACCOUNT RECOVERY", emailMessage);

            if (isSent) {
                console.log(`✅ [OTP SYSTEM] Secure code sent to ${targetEmail}`);
                return res.status(200).json({ success: true, message: 'Security code dispatched.' });
            } else {
                return res.status(500).json({ error: 'Failed to dispatch email.' });
            }

        } catch (err) {
            console.error("❌ [OTP SYSTEM ERROR]:", err.message);
            res.status(500).json({ error: 'System error.' });
        }
    });

    // =========================================================
    // 2. VERIFY OTP (Standard - with Anti-Brute Force)
    // =========================================================
    router.post('/accounts/verify-otp', async (req, res) => {
        try {
            const { email, otp } = req.body;
            const identifier = email?.toLowerCase().trim();
            
            const userData = await findUserEmail(identifier);
            if (!userData) return res.status(400).json({ error: 'Invalid verification target.' });
            
            const targetEmail = userData.email.toLowerCase();
            const stored = otpStore.get(targetEmail);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetEmail);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            // 🛡️ ANTI-BRUTE FORCE: Check attempts
            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetEmail); // BURN TOKEN
                    console.log(`🚨 [SECURITY] Brute force stopped for ${targetEmail}`);
                    return res.status(429).json({ error: 'Too many failed attempts. Code destroyed. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            otpStore.delete(targetEmail);
            res.status(200).json({ success: true, message: 'Identity verified.' });
        } catch (err) {
            res.status(500).json({ error: 'Verification failed.' });
        }
    });

    // =========================================================
    // 3. CORE: PASSWORD RESET (For Logged-in Users / Admins)
    // =========================================================
    router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
        try {
            const { password } = req.body;
            const { accountId } = req.params;

            const { data, error } = await supabase
                .from('residents_account')
                .update({ password: hashPassword(password) })
                .or(`account_id.eq.${accountId},resident_id.eq.${accountId}`)
                .select();

            if (error) throw error;
            
            if (!data || data.length === 0) {
                const { data: offData, error: offError } = await supabase
                    .from('officials_accounts')
                    .update({ password: hashPassword(password) })
                    .eq('account_id', accountId)
                    .select();
                
                if (offError || !offData || offData.length === 0) {
                    return res.status(404).json({ error: 'Account not found.' });
                }
            }
            res.json({ success: true, message: 'Password updated successfully.' });
        } catch (err) {
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });

    // =========================================================
    // 4. PUBLIC: RESET PASSWORD VIA OTP (With Anti-Brute Force)
    // =========================================================
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { email, otp, newPassword } = req.body;
            const identifier = email?.toLowerCase().trim();
            
            const userData = await findUserEmail(identifier);
            if (!userData || !userData.email) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetEmail = userData.email.toLowerCase();
            const stored = otpStore.get(targetEmail);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetEmail);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            // 🛡️ ANTI-BRUTE FORCE: Check attempts
            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetEmail); // BURN TOKEN
                    console.log(`🚨 [SECURITY] Brute force stopped on Public Reset for ${targetEmail}`);
                    return res.status(429).json({ error: 'Too many failed attempts. Code destroyed. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            // OTP is valid, Update Password
            const { error: updateError } = await supabase
                .from('residents_account')
                .update({ password: hashPassword(newPassword) })
                .eq('resident_id', userData.accountId);

            if (updateError) throw updateError;

            otpStore.delete(targetEmail);
            console.log(`✅ [PUBLIC RESET] Password successfully updated for ${targetEmail}`);

            res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (err) {
            console.error("Public Reset Error:", err.message);
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });

};