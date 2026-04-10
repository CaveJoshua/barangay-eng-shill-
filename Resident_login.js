/**
 * ============================================================
 *  ResidentsLogin.js — Auth Router  [HARDENED v2.0]
 * ============================================================
 *  AUDIT FIXES APPLIED:
 *  [CRITICAL] bcrypt.compareSync → bcrypt.compare (async)
 *             Sync version blocks event loop — confirmed DoS vector.
 *  [CRITICAL] Refresh token is now OPAQUE (crypto.randomBytes, not a JWT)
 *             Stored as SHA-256 hash in Supabase refresh_tokens table.
 *             Old JWT refresh tokens could not be revoked; opaque tokens can.
 *  [CRITICAL] jwt.sign now explicitly pins algorithm: 'HS256'
 *             Prevents algorithm confusion / alg:none attacks.
 *  [CRITICAL] Startup guard: throws on missing JWT secrets (no weak fallback)
 *  [HIGH]     Input length validation (max 72 chars for username/password)
 *             bcrypt silently ignores chars beyond byte 72 — an attacker
 *             could submit a 100KB password to stall CPU.
 *  [HIGH]     JWT payload minimized: only sub, role, session_id, exp
 *             No PII (names, email) in the JWT — reduces blast radius of leak
 *  [HIGH]     Refresh token rotation with reuse detection:
 *             If a rotated token is presented again → revoke entire family
 *  [HIGH]     Refresh cookie path restricted to /api/auth to limit exposure
 *  [MEDIUM]   loginBuckets Map documented as single-instance only
 *  [MEDIUM]   Timing-safe constant for user-not-found path
 *             (performs a dummy bcrypt hash to equalize response time)
 * ============================================================
 *
 *  REQUIRED Supabase table (run once):
 *  ─────────────────────────────────────────────────────────
 *  CREATE TABLE public.refresh_tokens (
 *    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
 *    resident_id  UUID        NOT NULL,
 *    token_hash   TEXT        NOT NULL UNIQUE,
 *    family_id    UUID        NOT NULL,
 *    user_agent   TEXT,
 *    ip_address   TEXT,
 *    expires_at   TIMESTAMPTZ NOT NULL,
 *    revoked      BOOLEAN     DEFAULT false,
 *    revoked_at   TIMESTAMPTZ,
 *    replaced_by  TEXT,
 *    created_at   TIMESTAMPTZ DEFAULT NOW()
 *  );
 *  CREATE INDEX ON public.refresh_tokens (token_hash);
 *  CREATE INDEX ON public.refresh_tokens (family_id);
 *  ─────────────────────────────────────────────────────────
 * ============================================================
 */

import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import crypto  from 'crypto';

// ---------------------------------------------------------------------------
// STARTUP GUARD — fail loudly if secrets are missing
// A weak fallback secret means anyone can forge tokens in a misconfigured env.
// ---------------------------------------------------------------------------
const JWT_SECRET     = process.env.SUPABASE_JWT_SECRET;
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET; // Used only as a signing marker; opaque tokens don't strictly need this but we keep it for the access token signing path

if (!JWT_SECRET) {
    throw new Error(
        '[FATAL] SUPABASE_JWT_SECRET is not set. ' +
        'Refusing to start with an unsigned token environment.'
    );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ACCESS_TOKEN_TTL         = '15m';
const REFRESH_TOKEN_TTL_DAYS   = 7;
const REFRESH_TOKEN_TTL_MS     = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// Input length limits — bcrypt ignores chars beyond byte 72.
// A 500-char password is not more secure; it just wastes CPU.
const MAX_USERNAME_LEN = 64;
const MAX_PASSWORD_LEN = 72;  // bcrypt's actual limit

// A pre-computed hash of a dummy password.
// Used in the user-not-found path to equalize response time and prevent
// timing-based username enumeration attacks.
const DUMMY_HASH = await bcrypt.hash('__timing_equalization_dummy__', 12);

// ---------------------------------------------------------------------------
// Tiered in-memory rate limiter
// NOTE: This is single-instance only. For multi-pod deployments,
// replace with a Redis-backed solution (e.g. ioredis + sliding window).
// ---------------------------------------------------------------------------
const loginBuckets = new Map();

const BUCKET_TIERS = [
    { maxAttempts: 4, penaltyMs: 1  * 60 * 1000 },  // tier 0 → 1 min
    { maxAttempts: 3, penaltyMs: 5  * 60 * 1000 },  // tier 1 → 5 min
    { maxAttempts: 2, penaltyMs: 30 * 60 * 1000 },  // tier 2 → 30 min
];

const tieredRateLimiter = (req, res, next) => {
    const ip  = req.ip || req.socket?.remoteAddress || 'UNKNOWN';
    const now = Date.now();

    if (!loginBuckets.has(ip)) {
        loginBuckets.set(ip, { attempts: 0, tier: 0, lockoutUntil: 0 });
    }

    const bucket = loginBuckets.get(ip);

    if (now < bucket.lockoutUntil) {
        const remainingSecs = Math.ceil((bucket.lockoutUntil - now) / 1000);
        return res.status(429).json({
            error: `Security lockout active. Please wait ${remainingSecs} seconds.`,
        });
    }

    req.clientIp = ip;

    req.punishIp = () => {
        bucket.attempts++;
        const tier  = Math.min(bucket.tier, BUCKET_TIERS.length - 1);
        const rules = BUCKET_TIERS[tier];
        if (bucket.attempts >= rules.maxAttempts) {
            bucket.lockoutUntil = Date.now() + rules.penaltyMs;
            bucket.attempts = 0;
            bucket.tier    = Math.min(bucket.tier + 1, BUCKET_TIERS.length - 1);
        }
    };

    req.clearLoginBucket = () => loginBuckets.delete(ip);

    next();
};

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random opaque refresh token.
 * Returns both the raw token (sent to client) and its SHA-256 hash (stored in DB).
 */
const generateOpaqueRefreshToken = () => {
    const rawToken  = crypto.randomBytes(48).toString('base64url'); // 64-char URL-safe string
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    return { rawToken, tokenHash };
};

/**
 * Build a minimal access token — only essential claims, no PII.
 * The frontend can call /api/auth/me if it needs profile data.
 */
const signAccessToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',    // Explicitly pinned — prevents alg:none / RS256 confusion
        expiresIn: ACCESS_TOKEN_TTL,
        issuer:    'barangay-api',
        audience:  'authenticated',
    });
};

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------
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
// Router factory
// ---------------------------------------------------------------------------
export const ResidentsLoginRouter = (router, supabase) => {

    // ── POST /residents/login ────────────────────────────────────────────
    router.post('/residents/login', tieredRateLimiter, async (req, res) => {
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const { username, password } = req.body;

        // ── A. INPUT VALIDATION ──────────────────────────────────────────
        if (!username || !password ||
            typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Username and password are required.' });
        }

        // Length guard — prevents bcrypt 72-byte truncation abuse and long-input DoS
        if (username.length > MAX_USERNAME_LEN || password.length > MAX_PASSWORD_LEN) {
            req.punishIp();
            return res.status(400).json({ error: 'Invalid credentials.' });
        }

        const cleanUsername = username.trim().toLowerCase();

        try {
            // ── B. SAFE ACCOUNT FETCH ────────────────────────────────────
            const { data: accountData, error: accountError } = await supabase
                .from('residents_account')
                .select('resident_id, username, password, requires_reset, session_version')
                .eq('username', cleanUsername)
                .maybeSingle();

            // ── C. TIMING-SAFE USER-NOT-FOUND PATH ───────────────────────
            // Always run a bcrypt compare even if user doesn't exist.
            // This equalizes response time and prevents username enumeration.
            if (accountError || !accountData) {
                await bcrypt.compare(password, DUMMY_HASH); // equalize timing
                req.punishIp();
                await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'FAILED', 'USER_NOT_FOUND');
                return res.status(401).json({ error: 'Invalid username or password.' });
            }

            // ── D. ASYNC PASSWORD VERIFICATION ───────────────────────────
            // FIX: was bcrypt.compareSync — blocks event loop under load.
            const isValid = await bcrypt.compare(password, accountData.password);
            if (!isValid) {
                req.punishIp();
                await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'FAILED', 'BAD_PASSWORD');
                return res.status(401).json({ error: 'Invalid username or password.' });
            }

            // ── E. PROFILE FETCH ─────────────────────────────────────────
            const { data: profileData } = await supabase
                .from('residents_records')
                .select('first_name, last_name')
                .eq('record_id', accountData.resident_id)
                .maybeSingle();

            const fName = profileData?.first_name || '';
            const lName = profileData?.last_name  || '';
            const safeFullName = `${fName} ${lName}`.trim().toUpperCase() || 'UNKNOWN RESIDENT';

            // ── F. MINIMAL ACCESS TOKEN (no PII in payload) ───────────────
            // FIX: Original included full_name, first_name, last_name, username.
            // A leaked or decoded JWT exposed all user PII. Minimized to sub + role.
            const sessionId = crypto.randomUUID(); // Unique per login session

            const accessToken = signAccessToken({
                sub:        accountData.resident_id,
                role:       'resident',
                session_id: sessionId,
                // No names, no username — call /api/auth/me for profile data
            });

            // ── G. OPAQUE REFRESH TOKEN with ROTATION SUPPORT ────────────
            // FIX: Original used a JWT as refresh token — could not be revoked.
            // New approach: random opaque token, stored hashed in DB.
            const { rawToken, tokenHash } = generateOpaqueRefreshToken();
            const familyId  = crypto.randomUUID(); // Token family for reuse detection
            const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

            const { error: tokenInsertError } = await supabase
                .from('refresh_tokens')
                .insert([{
                    resident_id: accountData.resident_id,
                    token_hash:  tokenHash,
                    family_id:   familyId,
                    user_agent:  userAgent,
                    ip_address:  req.clientIp,
                    expires_at:  expiresAt,
                    revoked:     false,
                }]);

            if (tokenInsertError) {
                console.error('❌ [REFRESH TOKEN STORE FAILED]', tokenInsertError.message);
                return res.status(500).json({ error: 'Session creation failed. Please try again.' });
            }

            // FIX: Cookie path restricted to /api/auth — was sent on every request
            res.cookie('refresh_token', rawToken, {
                httpOnly: true,
                secure:   true,
                sameSite: 'none',   // Required for cross-domain (Cloudflare)
                path:     '/api/auth', // Only sent to the auth routes
                maxAge:   REFRESH_TOKEN_TTL_MS,
            });

            // ── H. SUCCESS ───────────────────────────────────────────────
            req.clearLoginBucket();
            await logAudit(supabase, cleanUsername, req.clientIp, userAgent, 'SUCCESS');

            return res.status(200).json({
                message:      'Login successful',
                access_token: accessToken,
                user: {
                    record_id:  accountData.resident_id,
                    username:   accountData.username,
                    full_name:  safeFullName,
                    first_name: fName.toUpperCase(),
                    last_name:  lName.toUpperCase(),
                    role:       'resident',
                },
                profile: {
                    record_id:      accountData.resident_id,
                    first_name:     fName.toUpperCase(),
                    last_name:      lName.toUpperCase(),
                    formattedName:  safeFullName,
                    is_first_login: accountData.requires_reset,
                },
                requires_reset: accountData.requires_reset,
            });

        } catch (err) {
            console.error('❌ [LOGIN CRASH]', err.message);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // ── POST /auth/refresh — Token Rotation Endpoint ─────────────────────
    // This is the endpoint the frontend calls with the HttpOnly cookie.
    // Issues a new access token AND rotates the refresh token.
    router.post('/auth/refresh', async (req, res) => {
        const rawToken  = req.cookies?.refresh_token;
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const clientIp  = req.ip || 'UNKNOWN';

        if (!rawToken) {
            return res.status(401).json({ error: 'No refresh token provided.' });
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        try {
            // Look up the token record
            const { data: tokenRecord, error } = await supabase
                .from('refresh_tokens')
                .select('*')
                .eq('token_hash', tokenHash)
                .maybeSingle();

            if (error || !tokenRecord) {
                return res.status(401).json({ error: 'Invalid or expired session.' });
            }

            // ── REUSE DETECTION ─────────────────────────────────────────
            // If a token is presented after being rotated (revoked), someone
            // may have stolen a previous token. Revoke the entire family.
            if (tokenRecord.revoked) {
                console.error(
                    `[SECURITY] Refresh token reuse detected! Family: ${tokenRecord.family_id} | IP: ${clientIp}`
                );
                await supabase
                    .from('refresh_tokens')
                    .update({ revoked: true, revoked_at: new Date().toISOString() })
                    .eq('family_id', tokenRecord.family_id);

                res.clearCookie('refresh_token', { path: '/api/auth' });
                return res.status(401).json({
                    error: 'Session invalidated due to suspicious activity. Please log in again.',
                });
            }

            // ── EXPIRY CHECK ─────────────────────────────────────────────
            if (new Date(tokenRecord.expires_at) < new Date()) {
                return res.status(401).json({ error: 'Session expired. Please log in again.' });
            }

            // ── ROTATE: Revoke old token, issue new one ───────────────────
            const { rawToken: newRawToken, tokenHash: newTokenHash } = generateOpaqueRefreshToken();
            const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();

            // Mark old token as revoked
            await supabase
                .from('refresh_tokens')
                .update({
                    revoked:     true,
                    revoked_at:  new Date().toISOString(),
                    replaced_by: newTokenHash,
                })
                .eq('id', tokenRecord.id);

            // Insert new rotated token (same family)
            await supabase.from('refresh_tokens').insert([{
                resident_id: tokenRecord.resident_id,
                token_hash:  newTokenHash,
                family_id:   tokenRecord.family_id, // Same family for lineage tracking
                user_agent:  userAgent,
                ip_address:  clientIp,
                expires_at:  newExpiresAt,
                revoked:     false,
            }]);

            // Issue new access token
            const sessionId  = crypto.randomUUID();
            const accessToken = signAccessToken({
                sub:        tokenRecord.resident_id,
                role:       'resident',
                session_id: sessionId,
            });

            // Set rotated cookie
            res.cookie('refresh_token', newRawToken, {
                httpOnly: true,
                secure:   true,
                sameSite: 'none',
                path:     '/api/auth',
                maxAge:   REFRESH_TOKEN_TTL_MS,
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
                await supabase
                    .from('refresh_tokens')
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