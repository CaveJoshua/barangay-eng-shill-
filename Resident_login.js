import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import crypto  from 'crypto';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// ---------------------------------------------------------------------------
// 🛡️ SECURITY CONFIG & STARTUP GUARD
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('[FATAL] JWT_SECRET is not set in environment variables.');
}

const ACCESS_TOKEN_TTL     = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Days
const MAX_USERNAME_LEN     = 64;
const MAX_PASSWORD_LEN     = 72;

// Pre-computed hash to prevent timing attacks for unknown users
const DUMMY_HASH = await bcrypt.hash('__timing_equalization_dummy__', 12);

// ---------------------------------------------------------------------------
// ⏳ ANTI-BRUTE FORCE LIMITER (Replaced custom map with rate-limiter-flexible)
// ---------------------------------------------------------------------------
// Allows 5 failed attempts per 15 minutes. 
// If exceeded, blocks the IP for 60 seconds.
const loginLimiter = new RateLimiterMemory({
    points: 5,           // Maximum 5 failed attempts
    duration: 60 * 15,   // Track failures over a 15-minute window
    blockDuration: 60,   // If points consumed, block for 60 seconds
});

// ---------------------------------------------------------------------------
// 🔑 TOKEN & AUDIT HELPERS
// ---------------------------------------------------------------------------
const generateOpaqueRefreshToken = () => {
    const rawToken  = crypto.randomBytes(48).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
};

const signAccessToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: ACCESS_TOKEN_TTL,
        issuer: 'barangay-api',
    });
};

const logAudit = async (supabase, username, ip, userAgent, status, failReason = null) => {
    if (!supabase) return;
    try {
        await supabase.from('audit_logs').insert([{
            actor:  username || 'UNKNOWN_IP',
            action: status === 'SUCCESS' ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
            details: JSON.stringify({ ip_address: ip, user_agent: userAgent, status, reason: failReason }),
        }]);
    } catch (e) {
        console.error('⚠️  [AUDIT FAILED]:', e.message);
    }
};

// ---------------------------------------------------------------------------
// 🚪 ROUTER EXPORT
// ---------------------------------------------------------------------------
export const ResidentsLoginRouter = (router, supabase) => {

    // ── POST /residents/login ────────────────────────────────────────────
    router.post('/residents/login', async (req, res) => {
        const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'UNKNOWN';
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const { username, password } = req.body;

        try {
            // 🛡️ CHECK 1: Is this IP already blocked?
            const rlRes = await loginLimiter.get(clientIp);
            if (rlRes !== null && rlRes.consumedPoints >= 5) {
                const retrySecs = Math.round(rlRes.msBeforeNext / 1000) || 60;
                return res.status(429).json({ error: `Security lockout active. Wait ${retrySecs}s.` });
            }

            // --- HELPER: Handles failed attempts ---
            const handleFailure = async (reason, sendStatus = 401) => {
                await logAudit(supabase, username, clientIp, userAgent, 'FAILED', reason);
                try {
                    await loginLimiter.consume(clientIp, 1);
                    return res.status(sendStatus).json({ error: 'Invalid username or password.' });
                } catch (rejRes) {
                    // If this specific failure tipped them over the edge (5th strike)
                    return res.status(429).json({ error: 'Too many login attempts. Locked out for 60 seconds.' });
                }
            };

            // A. Input Validation
            if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
                return res.status(400).json({ error: 'Username and password are required.' });
            }

            if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
                return await handleFailure('INVALID_CREDENTIAL_LENGTH', 400);
            }

            const cleanUsername = username.trim();

            // B. Safe Account Fetch (Case-Insensitive)
            const { data: accountData, error: accountError } = await supabase
                .from('residents_account')
                .select('resident_id, username, password, requires_reset')
                .ilike('username', cleanUsername)
                .maybeSingle();

            // C. Timing-Safe User-Not-Found Path
            if (accountError || !accountData) {
                await bcrypt.compare(password, DUMMY_HASH); // Prevent timing attack
                return await handleFailure('USER_NOT_FOUND');
            }

            // D. Async Password Verification
            const isValid = await bcrypt.compare(password, accountData.password);
            
            if (!isValid) {
                return await handleFailure('BAD_PASSWORD');
            }

            // 🛡️ THE FIX: Select '*' to grab email, purok, etc.
            const { data: profileData } = await supabase
                .from('residents_records')
                .select('*') 
                .eq('record_id', accountData.resident_id)
                .maybeSingle();

            const fName = profileData?.first_name || '';
            const lName = profileData?.last_name  || '';
            const safeFullName = `${fName} ${lName}`.trim().toUpperCase() || 'UNKNOWN RESIDENT';

            // F. Issue Tokens
            const accessToken = signAccessToken({ 
                sub: accountData.resident_id, 
                role: 'resident',
                username: accountData.username 
            });
            
            const { rawToken, tokenHash } = generateOpaqueRefreshToken();
            const familyId = crypto.randomUUID();
            const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

            await supabase.from('refresh_tokens').insert([{
                resident_id: accountData.resident_id,
                token_hash: tokenHash,
                family_id: familyId,
                user_agent: userAgent,
                ip_address: clientIp,
                expires_at: expiresAt,
                revoked: false,
            }]);

            // G. Set Secure Cookie
            res.cookie('refresh_token', rawToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                path: '/api/auth',
                maxAge: REFRESH_TOKEN_TTL_MS,
            });

            // H. Success - Wipe the penalty slate clean!
            await loginLimiter.delete(clientIp);
            await logAudit(supabase, cleanUsername, clientIp, userAgent, 'SUCCESS');

            return res.status(200).json({
                message: 'Login successful',
                access_token: accessToken,
                user: { 
                    record_id: accountData.resident_id, 
                    username: accountData.username, 
                    full_name: safeFullName, 
                    role: 'resident' 
                },
                profile: {
                    ...profileData, 
                    record_id: accountData.resident_id,
                    first_name: fName.toUpperCase(),
                    last_name: lName.toUpperCase(),
                    formattedName: safeFullName,
                    is_first_login: accountData.requires_reset,
                },
                requires_reset: accountData.requires_reset
            });

        } catch (err) {
            console.error('💥 [LOGIN CRASH]', err.message);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // ── POST /auth/refresh ───────────────────────────────────────────────
    router.post('/auth/refresh', async (req, res) => {
        const rawToken  = req.cookies?.refresh_token;
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const clientIp  = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'UNKNOWN';

        if (!rawToken) return res.status(401).json({ error: 'No refresh token provided.' });

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        try {
            const { data: tokenRecord, error } = await supabase
                .from('refresh_tokens')
                .select('*')
                .eq('token_hash', tokenHash)
                .maybeSingle();

            if (error || !tokenRecord) return res.status(401).json({ error: 'Invalid or expired session.' });

            // Reuse Detection
            if (tokenRecord.revoked) {
                console.error(`[SECURITY] Refresh token reuse detected! IP: ${clientIp}`);
                await supabase.from('refresh_tokens')
                    .update({ revoked: true, revoked_at: new Date().toISOString() })
                    .eq('family_id', tokenRecord.family_id);

                res.clearCookie('refresh_token', { path: '/api/auth' });
                return res.status(401).json({ error: 'Session invalidated due to suspicious activity. Please log in again.' });
            }

            // Expiry Check
            if (new Date(tokenRecord.expires_at) < new Date()) {
                return res.status(401).json({ error: 'Session expired. Please log in again.' });
            }

            // Rotate Tokens
            const { rawToken: newRawToken, tokenHash: newTokenHash } = generateOpaqueRefreshToken();
            const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

            await supabase.from('refresh_tokens')
                .update({ revoked: true, revoked_at: new Date().toISOString(), replaced_by: newTokenHash })
                .eq('id', tokenRecord.id);

            await supabase.from('refresh_tokens').insert([{
                resident_id: tokenRecord.resident_id,
                token_hash:  newTokenHash,
                family_id:   tokenRecord.family_id,
                user_agent:  userAgent,
                ip_address:  clientIp,
                expires_at:  newExpiresAt,
                revoked:     false,
            }]);

            const accessToken = signAccessToken({ sub: tokenRecord.resident_id, role: 'resident' });

            res.cookie('refresh_token', newRawToken, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                path: '/api/auth',
                maxAge: REFRESH_TOKEN_TTL_MS,
            });

            return res.status(200).json({ access_token: accessToken });

        } catch (err) {
            console.error('❌ [REFRESH CRASH]', err.message);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // ── POST /auth/logout ────────────────────────────────────────────────
    router.post('/auth/logout', async (req, res) => {
        const rawToken = req.cookies?.refresh_token;

        if (rawToken) {
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            try {
                await supabase.from('refresh_tokens')
                    .update({ revoked: true, revoked_at: new Date().toISOString() })
                    .eq('token_hash', tokenHash);
            } catch (err) {
                console.error('[LOGOUT] Token revoke failed (non-fatal):', err.message);
            }
        }

        res.clearCookie('refresh_token', { path: '/api/auth' });
        return res.status(200).json({ message: 'Logged out successfully.' });
    });
};