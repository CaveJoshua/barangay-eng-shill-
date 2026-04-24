import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import crypto  from 'crypto';

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
// ⏳ TIERED RATE LIMITER (Prevents Brute Force Attacks)
// ---------------------------------------------------------------------------
const loginBuckets = new Map();
const BUCKET_TIERS = [
    { maxAttempts: 5, penaltyMs: 1  * 60 * 1000 },  // Tier 0: 1 min lockout
    { maxAttempts: 3, penaltyMs: 15 * 60 * 1000 },  // Tier 1: 15 min lockout
];

const tieredRateLimiter = (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'UNKNOWN';
    const now = Date.now();

    if (!loginBuckets.has(ip)) {
        loginBuckets.set(ip, { attempts: 0, tier: 0, lockoutUntil: 0 });
    }

    const bucket = loginBuckets.get(ip);

    if (now < bucket.lockoutUntil) {
        const remaining = Math.ceil((bucket.lockoutUntil - now) / 1000);
        return res.status(429).json({ error: `Security lockout active. Wait ${remaining}s.` });
    }

    req.clientIp = ip;
    req.punishIp = () => {
        bucket.attempts++;
        const rules = BUCKET_TIERS[Math.min(bucket.tier, BUCKET_TIERS.length - 1)];
        if (bucket.attempts >= rules.maxAttempts) {
            bucket.lockoutUntil = now + rules.penaltyMs;
            bucket.attempts = 0;
            bucket.tier = Math.min(bucket.tier + 1, BUCKET_TIERS.length - 1);
        }
    };
    req.clearLoginBucket = () => loginBuckets.delete(ip);
    next();
};

// ---------------------------------------------------------------------------
// 🔑 TOKEN HELPERS
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
    router.post('/residents/login', tieredRateLimiter, async (req, res) => {
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const { username, password } = req.body;

        // A. Input Validation
        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
            req.punishIp();
            return res.status(400).json({ error: 'Invalid credentials.' });
        }

        const cleanUsername = username.trim();

        try {
            // B. Safe Account Fetch (Case-Insensitive)
            const { data: accountData, error: accountError } = await supabase
                .from('residents_account')
                .select('resident_id, username, password, requires_reset')
                .ilike('username', cleanUsername)
                .maybeSingle();

            // C. Timing-Safe User-Not-Found Path
            if (accountError || !accountData) {
                await bcrypt.compare(password, DUMMY_HASH); 
                req.punishIp();
                await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'FAILED', 'USER_NOT_FOUND');
                return res.status(401).json({ error: 'Invalid username or password.' });
            }

            // D. Async Password Verification
            const isValid = await bcrypt.compare(password, accountData.password);
            
            if (!isValid) {
                req.punishIp();
                await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'FAILED', 'BAD_PASSWORD');
                return res.status(401).json({ error: 'Invalid username or password.' });
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
                ip_address: req.clientIp,
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

            // H. Success
            req.clearLoginBucket();
            await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'SUCCESS');

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
                    ...profileData, // 🛡️ Spreads ALL database columns (including email) to the frontend
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
        const clientIp  = req.ip || 'UNKNOWN';

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