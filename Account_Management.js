import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendAutoMail } from './Mailer.js';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// 🕸️ GraphQL (J-CVE-101203 — public recovery migrated off native REST fetch)
import { buildSchema, NoSchemaIntrospectionCustomRule } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';

// =========================================================
// 🛡️ RATE LIMITERS (Tiered Token Bucket)
// =========================================================

// TIER 1: Burst Limiter (Max 3 requests per 60 seconds)
const burstLimiter = new RateLimiterMemory({
    points: 3,
    duration: 60,
    blockDuration: 60,
});

// TIER 2: Daily Limiter (Max 10 requests per 24 hours)
const dailyLimiter = new RateLimiterMemory({
    points: 10,
    duration: 60 * 60 * 24,
    blockDuration: 60 * 60 * 24,
});

// --- OTP Memory Storage (For the Codes) ---
const otpStore = new Map();

// 🛡️ SECURITY HELPER 1: Hash Passwords
const hashPassword = (plain) => {
    if (!plain) return null;
    return bcrypt.hashSync(plain, 10);
};

// Cryptographically secure OTP code generation (no Math.random)
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[crypto.randomInt(0, chars.length)];
    }
    return result;
};

// Hashes an OTP code with SHA-256 before storing it in memory
const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

// =========================================================
// 🚨 RECOVERY ERROR — carries an HTTP-equivalent status so the
// GraphQL resolvers can surface human-readable messages while the
// (legacy) callers keep their exact wording for the frontend.
// =========================================================
class OtpError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'OtpError';
        this.status = status;
    }
}

// =========================================================
// 🕸️ PUBLIC RECOVERY SCHEMA (no PII fields are ever returned)
// =========================================================
const authSchema = buildSchema(`
  type StandardResponse {
    success: Boolean!
    message: String
  }

  type Query {
    # graphql-http requires at least one Query field; used as a liveness probe.
    _health: String
  }

  type Mutation {
    requestOtp(identifier: String!, useFallback: Boolean): StandardResponse!
    verifyOtp(identifier: String!, otp: String!): StandardResponse!
    publicReset(identifier: String!, otp: String!, newPassword: String!): StandardResponse!
  }
`);

export const AccountManagementRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 🧠 SMART LOOKUP HELPER (The Ultimate "Who is Who" Search)
    // =========================================================
    const findUserEmail = async (identifier) => {

        // --- 1. CHECK RESIDENTS ---
        const { data: resAuth } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (resAuth) {
            const { data: resProfile } = await supabase
                .from('residents_records')
                .select('email, first_name')
                .eq('record_id', resAuth.resident_id)
                .maybeSingle();
            return resProfile ? { email: resProfile.email, firstName: resProfile.first_name, accountId: resAuth.resident_id, role: 'resident' } : null;
        }

        const { data: resProfileByEmail } = await supabase
            .from('residents_records')
            .select('record_id, email, first_name')
            .eq('email', identifier)
            .maybeSingle();

        if (resProfileByEmail) {
            return { email: resProfileByEmail.email, firstName: resProfileByEmail.first_name, accountId: resProfileByEmail.record_id, role: 'resident' };
        }

        // --- 2. CHECK OFFICIALS / ADMINS ---
        const { data: offAuth } = await supabase
            .from('officials_accounts')
            .select('account_id, official_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (offAuth) {
            const { data: offProfile } = await supabase
                .from('officials')
                .select('email, full_name')
                .eq('id', offAuth.official_id)
                .maybeSingle();
            return offProfile ? { email: offProfile.email, firstName: offProfile.full_name, accountId: offAuth.account_id, role: 'official' } : null;
        }

        const { data: offProfileByEmail } = await supabase
            .from('officials')
            .select('id, email, full_name')
            .eq('email', identifier)
            .maybeSingle();

        if (offProfileByEmail) {
            const { data: offAuthByEmail } = await supabase
                .from('officials_accounts')
                .select('account_id')
                .eq('official_id', offProfileByEmail.id)
                .maybeSingle();
            if (offAuthByEmail) {
                return { email: offProfileByEmail.email, firstName: offProfileByEmail.full_name, accountId: offAuthByEmail.account_id, role: 'official' };
            }
        }

        // --- 3. NOT FOUND ---
        return null;
    };

    // =========================================================
    // 🔐 CORE RECOVERY LOGIC
    // Shared by the GraphQL endpoint below. Each function throws an
    // OtpError on failure (message text is preserved verbatim so the
    // existing frontend lockout/anti-bruteforce parsing keeps working).
    // =========================================================

    // 1. GENERATE & SEND SECURE OTP
    const executeRequestOtp = async ({ identifier, useFallback = false, clientIp = 'unknown' }) => {
        const identifierNorm = identifier?.toLowerCase().trim();
        if (!identifierNorm) throw new OtpError('Identification required.', 400);

        const limitKey = `${clientIp}_${identifierNorm}`;
        try {
            await dailyLimiter.consume(limitKey, 1);
            await burstLimiter.consume(limitKey, 1);
        } catch (rejRes) {
            const secsToWait = Math.round(rejRes.msBeforeNext / 1000) || 60;
            throw new OtpError(`Too many requests. Please wait ${secsToWait} seconds.`, 429);
        }

        const userData = await findUserEmail(identifierNorm);

        // Only fail if the user flat out does not exist in the DB
        if (!userData) throw new OtpError('Account not found. Please check your details.', 404);

        // Dynamic mapping. If no email exists, attach the OTP to the Account ID instead.
        const targetMapKey = (userData.email || userData.accountId).toLowerCase();
        let destinationEmail = userData.email?.toLowerCase();

        // 🛡️ ZERO-TRUST FALLBACK LOGIC
        if (useFallback) {
            const { data: hallData } = await supabase
                .from('officials')
                .select('email')
                .eq('position', 'Barangay Hall')
                .limit(1)
                .maybeSingle();

            if (hallData && hallData.email) {
                destinationEmail = hallData.email.toLowerCase();
            } else if (process.env.ROOT_EMAIL) {
                // Ultimate Lifeline if the DB record is corrupted/missing an email
                destinationEmail = process.env.ROOT_EMAIL.toLowerCase();
            } else {
                throw new OtpError('System Error: Master Email is not configured.', 500);
            }
        } else if (!destinationEmail) {
            // If they have no email and didn't select fallback, block them gracefully
            throw new OtpError('No personal email registered. Please use the Barangay Hall Master Email (Fallback) option.', 400);
        }

        const otpCode = generateSecureCode(6);

        // Store only the hash — plaintext code is sent via email and never persisted
        otpStore.set(targetMapKey, {
            codeHash: hashOtp(otpCode),
            expires: Date.now() + 300000, // 5 minutes
            attempts: 0
        });

        // 📩 DYNAMIC EMAIL TEMPLATES
        let emailMessage = '';
        let subjectLine = '';

        if (useFallback) {
            subjectLine = "URGENT: Fallback Account Recovery Request";
            emailMessage = `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                    <h2 style="color: #d97706; margin-top: 0;">Emergency Password Reset Request</h2>
                    <p>A user has requested an emergency password reset using the Master Fallback system.</p>
                    <p><b>Target User:</b> ${userData.firstName} (${identifierNorm})</p>
                    <p><b>Account Role:</b> ${userData.role.toUpperCase()}</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                    <p>Their 5-Minute Security Code is:</p>
                    <h1 style="background: #fef3c7; padding: 15px; text-align: center; letter-spacing: 6px; color: #b45309; border-radius: 8px;">${otpCode}</h1>
                    <p style="color: #64748b; font-size: 12px;">Only share this code after physically verifying the identity of the requester.</p>
                </div>
            `;
        } else {
            subjectLine = "Password Reset Request";
            emailMessage = `
                Hello <b>${userData.firstName}</b>,<br><br>
                A password reset was requested for your account.<br><br>
                Your 5-Minute Security Code is:<br>
                <h1 style="color: #27ae60; letter-spacing: 6px; font-family: monospace; background: #f4f4f4; padding: 15px; border-radius: 8px; display: inline-block;">${otpCode}</h1><br>
                <p><i>Note: This code is case-sensitive.</i></p>
                If you did not request this, please secure your account immediately.
            `;
        }

        const isSent = await sendAutoMail(destinationEmail, subjectLine, "ACCOUNT RECOVERY", emailMessage);
        if (!isSent) throw new OtpError('Failed to dispatch email.', 500);

        return { success: true, message: 'Security code dispatched.' };
    };

    // 2. VERIFY OTP (does NOT consume the code — publicReset still needs it)
    const executeVerifyOtp = async ({ identifier, otp }) => {
        const identifierNorm = identifier?.toLowerCase().trim();

        const userData = await findUserEmail(identifierNorm);
        if (!userData) throw new OtpError('Invalid verification target.', 400);

        const targetMapKey = (userData.email || userData.accountId).toLowerCase();
        const stored = otpStore.get(targetMapKey);

        if (!stored) throw new OtpError('No active code found. Please request a new one.', 400);
        if (Date.now() > stored.expires) {
            otpStore.delete(targetMapKey);
            throw new OtpError('Code has expired. Please request a new one.', 400);
        }

        if (hashOtp((otp || '').trim()) !== stored.codeHash) {
            stored.attempts += 1;
            if (stored.attempts >= 3) {
                otpStore.delete(targetMapKey);
                throw new OtpError('Too many failed attempts. Code destroyed. Request a new one.', 429);
            }
            throw new OtpError(`Invalid code. ${3 - stored.attempts} attempts remaining.`, 400);
        }

        // Mark verified so publicReset can consume it; do NOT delete yet.
        stored.verified = true;
        return { success: true, message: 'Identity verified.' };
    };

    // 3. PUBLIC PASSWORD RESET VIA OTP (Login Page — no session)
    const executePublicReset = async ({ identifier, otp, newPassword }) => {
        const identifierNorm = identifier?.toLowerCase().trim();

        // 🛡️ Server-side strength floor (frontend also enforces this).
        if (!newPassword || newPassword.length < 8) {
            throw new OtpError('Password must be at least 8 characters.', 400);
        }

        const userData = await findUserEmail(identifierNorm);
        if (!userData) throw new OtpError('Account could not be verified.', 400);

        const targetMapKey = (userData.email || userData.accountId).toLowerCase();
        const stored = otpStore.get(targetMapKey);

        if (!stored) throw new OtpError('No active code found. Please request a new one.', 400);
        if (Date.now() > stored.expires) {
            otpStore.delete(targetMapKey);
            throw new OtpError('Code has expired. Please request a new one.', 400);
        }

        if (hashOtp((otp || '').trim()) !== stored.codeHash) {
            stored.attempts += 1;
            if (stored.attempts >= 3) {
                otpStore.delete(targetMapKey);
                throw new OtpError('Too many failed attempts. Request a new one.', 429);
            }
            throw new OtpError(`Invalid code. ${3 - stored.attempts} attempts remaining.`, 400);
        }

        if (userData.role === 'official') {
            const { error: updateError } = await supabase
                .from('officials_accounts')
                .update({ password: hashPassword(newPassword) })
                .eq('account_id', userData.accountId);
            if (updateError) throw new OtpError('Database synchronization failed.', 500);
        } else {
            const { error: updateError } = await supabase
                .from('residents_account')
                .update({ password: hashPassword(newPassword) })
                .eq('resident_id', userData.accountId);

            if (updateError) throw new OtpError('Database synchronization failed.', 500);

            try {
                await supabase.from('residents_account')
                    .update({ requires_reset: false })
                    .eq('resident_id', userData.accountId);
            } catch (ignoreErr) { /* non-fatal flag update */ }
        }

        otpStore.delete(targetMapKey);
        return { success: true, message: 'Password reset successful.' };
    };

    // =========================================================
    // 🕸️ PUBLIC GRAPHQL RECOVERY ENDPOINT  (J-CVE-101203)
    // Replaces the legacy native-REST routes /accounts/request-otp,
    // /accounts/verify-otp and /accounts/public-reset.
    // Intentionally PUBLIC (locked-out users must reach it) but
    // protected by the tiered rate-limiter + introspection disabled.
    // =========================================================
    const authResolvers = {
        _health: () => 'OK',
        requestOtp: ({ identifier, useFallback }, context) =>
            executeRequestOtp({
                identifier,
                useFallback,
                clientIp: context?.req?.headers?.['x-forwarded-for'] || context?.req?.socket?.remoteAddress || 'unknown',
            }),
        verifyOtp: ({ identifier, otp }) => executeVerifyOtp({ identifier, otp }),
        publicReset: ({ identifier, otp, newPassword }) => executePublicReset({ identifier, otp, newPassword }),
    };

    router.all('/graphql/auth', (req, res) =>
        createHandler({
            schema: authSchema,
            rootValue: authResolvers,
            context: () => ({ req, supabase }),
            validationRules: [NoSchemaIntrospectionCustomRule],
        })(req, res)
    );

    // =========================================================
    // 🔁 AUTHENTICATED RESET (Admin dashboard / first-time reset)
    // Kept as REST — it relies on an active session (Bearer/cookie)
    // and is still used by the resident & admin dashboards.
    // =========================================================
    router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
            const loggedInUserId = req.user?.account_id || req.user?.sub;
            const targetId = req.params.accountId;

            const adminRoles = ['superadmin', 'punongbarangay', 'barangaysecretary', 'barangayhall'];
            const isAdmin = adminRoles.includes(userRole);
            const isSelf = String(loggedInUserId) === String(targetId);

            if (!isAdmin && !isSelf) {
                return res.status(403).json({ error: 'Access Denied. You lack permissions.' });
            }

            const { password, otp } = req.body;
            if (!password) return res.status(400).json({ error: 'New password is required.' });

            // 🛡️ ENFORCE OTP
            if (isAdmin && !isSelf) {
                if (!otp) return res.status(400).json({ error: 'Security verification code is required.' });

                let targetMapKey = null;

                // Resident path: account_id → residents_account.resident_id → residents_records.email
                const { data: resAccRow } = await supabase
                    .from('residents_account')
                    .select('resident_id')
                    .eq('account_id', targetId)
                    .maybeSingle();

                if (resAccRow?.resident_id) {
                    const { data: resRecord } = await supabase
                        .from('residents_records')
                        .select('email')
                        .eq('record_id', resAccRow.resident_id)
                        .maybeSingle();
                    targetMapKey = resRecord?.email || resAccRow.resident_id;
                } else {
                    // Official path: account_id → officials_accounts.official_id → officials.email
                    const { data: offAuth } = await supabase
                        .from('officials_accounts')
                        .select('official_id')
                        .eq('account_id', targetId)
                        .maybeSingle();
                    if (offAuth) {
                        const { data: offData } = await supabase
                            .from('officials')
                            .select('email')
                            .eq('id', offAuth.official_id)
                            .maybeSingle();
                        targetMapKey = offData?.email ? offData.email : targetId;
                    }
                }

                if (!targetMapKey) return res.status(404).json({ error: 'Target account corrupted.' });

                const mapKey = String(targetMapKey).toLowerCase();
                const stored = otpStore.get(mapKey);
                if (!stored) return res.status(400).json({ error: 'No active verification code found.' });
                if (Date.now() > stored.expires) {
                    otpStore.delete(mapKey);
                    return res.status(400).json({ error: 'Verification code expired.' });
                }
                if (hashOtp(otp.trim()) !== stored.codeHash) {
                    stored.attempts += 1;
                    if (stored.attempts >= 3) otpStore.delete(mapKey);
                    return res.status(401).json({ error: 'Invalid verification code.' });
                }
                otpStore.delete(mapKey);
            }

            const securePass = hashPassword(password);

            const { data: resData } = await supabase
                .from('residents_account')
                .update({ password: securePass, requires_reset: false })
                .or(`account_id.eq.${targetId},resident_id.eq.${targetId}`)
                .select();

            if (resData && resData.length > 0) {
                return res.json({ success: true, message: 'Password updated successfully.' });
            }

            if (isAdmin || isSelf) {
                const { data: offData } = await supabase
                    .from('officials_accounts')
                    .update({ password: securePass })
                    .eq('account_id', targetId)
                    .select();

                if (offData && offData.length > 0) {
                    return res.json({ success: true, message: 'Official password updated successfully.' });
                }
            }

            return res.status(404).json({ error: 'Account not found.' });

        } catch (err) {
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });
};
