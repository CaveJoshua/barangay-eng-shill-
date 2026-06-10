import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendAutoMail } from './Mailer.js';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// =========================================================
// 🛡️ RATE LIMITERS (Tiered Token Bucket)
// =========================================================

const burstLimiter = new RateLimiterMemory({ points: 3, duration: 60, blockDuration: 60 });
const dailyLimiter = new RateLimiterMemory({ points: 10, duration: 60 * 60 * 24, blockDuration: 60 * 60 * 24 });

const otpStore = new Map();

// 🛡️ SECURITY HELPERS
const hashPassword = (plain) => plain ? bcrypt.hashSync(plain, 10) : null;

const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[crypto.randomInt(0, chars.length)];
    }
    return result;
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

export const AccountManagementRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 🧠 SMART LOOKUP HELPER 
    // =========================================================
    const findUserEmail = async (identifier) => {
        // --- 1. CHECK RESIDENTS ---
        const { data: resAuth } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (resAuth) {
            const { data: resProfile } = await supabase.from('residents_records').select('email, first_name').eq('record_id', resAuth.resident_id).maybeSingle();
            return resProfile ? { email: resProfile.email, firstName: resProfile.first_name, accountId: resAuth.resident_id, role: 'resident' } : null;
        }

        const { data: resProfileByEmail } = await supabase.from('residents_records').select('record_id, email, first_name').eq('email', identifier).maybeSingle();
        if (resProfileByEmail) return { email: resProfileByEmail.email, firstName: resProfileByEmail.first_name, accountId: resProfileByEmail.record_id, role: 'resident' };

        // --- 2. CHECK OFFICIALS / ADMINS ---
        const { data: offAuth } = await supabase.from('officials_accounts').select('account_id, official_id, username').eq('username', identifier).maybeSingle();
        if (offAuth) {
            const { data: offProfile } = await supabase.from('officials').select('email, full_name').eq('id', offAuth.official_id).maybeSingle();
            return offProfile ? { email: offProfile.email, firstName: offProfile.full_name, accountId: offAuth.account_id, role: 'official' } : null;
        }

        const { data: offProfileByEmail } = await supabase.from('officials').select('id, email, full_name').eq('email', identifier).maybeSingle();
        if (offProfileByEmail) {
            const { data: offAuthByEmail } = await supabase.from('officials_accounts').select('account_id').eq('official_id', offProfileByEmail.id).maybeSingle();
            if (offAuthByEmail) return { email: offProfileByEmail.email, firstName: offProfileByEmail.full_name, accountId: offAuthByEmail.account_id, role: 'official' };
        }

        return null;
    };


    // =========================================================
    // 1. PUBLIC ENDPOINT: Request OTP
    // POST /api/accounts/request-otp
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { identifier, useFallback = false } = req.body;
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const identifierNorm = identifier?.toLowerCase().trim();
            
            if (!identifierNorm) return res.status(400).json({ error: 'Identification required.' });

            const limitKey = `${clientIp}_${identifierNorm}`;
            try {
                await dailyLimiter.consume(limitKey, 1);
                await burstLimiter.consume(limitKey, 1);
            } catch (rejRes) {
                const secsToWait = Math.round(rejRes.msBeforeNext / 1000) || 60;
                return res.status(429).json({ error: `Too many requests. Please wait ${secsToWait} seconds.` });
            }

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(404).json({ error: 'Account not found. Please check your details.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            let destinationEmail = userData.email?.toLowerCase();

            if (useFallback) {
                const { data: hallData } = await supabase.from('officials').select('email').eq('position', 'Barangay Hall').limit(1).maybeSingle();
                if (hallData && hallData.email) destinationEmail = hallData.email.toLowerCase();
                else if (process.env.ROOT_EMAIL) destinationEmail = process.env.ROOT_EMAIL.toLowerCase();
                else return res.status(500).json({ error: 'System Error: Master Email is not configured.' });
            } else if (!destinationEmail) {
                return res.status(400).json({ error: 'No personal email registered. Please use the Fallback option.' });
            }

            const otpCode = generateSecureCode(6);
            otpStore.set(targetMapKey, { codeHash: hashOtp(otpCode), expires: Date.now() + 300000, attempts: 0 });

            let subjectLine = useFallback ? "URGENT: Fallback Account Recovery Request" : "Password Reset Request";
            let emailMessage = useFallback 
                ? `Emergency reset requested for ${userData.firstName}. Code: ${otpCode}` 
                : `Hello ${userData.firstName}, your reset code is: ${otpCode}`;

            const isSent = await sendAutoMail(destinationEmail, subjectLine, "ACCOUNT RECOVERY", emailMessage);
            if (!isSent) return res.status(500).json({ error: 'Failed to dispatch email.' });

            return res.status(200).json({ success: true, message: 'Security code dispatched.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 2. PUBLIC ENDPOINT: Verify OTP
    // POST /api/accounts/verify-otp
    // =========================================================
    router.post('/accounts/verify-otp', async (req, res) => {
        try {
            const { identifier, otp } = req.body;
            const identifierNorm = identifier?.toLowerCase().trim();

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(400).json({ error: 'Invalid verification target.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored) return res.status(400).json({ error: 'No active code found.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetMapKey);
                return res.status(400).json({ error: 'Code has expired.' });
            }

            if (hashOtp((otp || '').trim()) !== stored.codeHash) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetMapKey);
                    return res.status(429).json({ error: 'Too many failed attempts.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            stored.verified = true;
            return res.status(200).json({ success: true, message: 'Identity verified.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 3. PUBLIC ENDPOINT: Public Reset
    // POST /api/accounts/public-reset
    // =========================================================
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { identifier, otp, newPassword } = req.body;
            const identifierNorm = identifier?.toLowerCase().trim();

            if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored || !stored.verified) return res.status(400).json({ error: 'OTP not verified or expired.' });

            if (userData.role === 'official') {
                const { error } = await supabase.from('officials_accounts').update({ password: hashPassword(newPassword) }).eq('account_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
            } else {
                const { error } = await supabase.from('residents_account').update({ password: hashPassword(newPassword) }).eq('resident_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
                await supabase.from('residents_account').update({ requires_reset: false }).eq('resident_id', userData.accountId);
            }

            otpStore.delete(targetMapKey);
            return res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 4. AUTHENTICATED RESET (Admin Dashboard / First-time reset)
    // PATCH /api/accounts/reset/:accountId
    // =========================================================
    // (This remains exactly the same as your previous code)
    router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
         // ... (Keep the exact code you already had here for this route)
    });
};