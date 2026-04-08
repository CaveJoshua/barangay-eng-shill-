import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_fallback_secret';
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your_refresh_secret_here';

// ============================================================================
// 🛡️ 1. TIERED BUCKET RATE LIMITER (In-Memory IP Tracking)
// ============================================================================
const loginBuckets = new Map();

const getBucketRules = (tier) => {
    switch(tier) {
        case 0: return { maxAttempts: 4, penaltyMs: 1 * 60 * 1000 }; // 4 attempts -> 1 min block
        case 1: return { maxAttempts: 3, penaltyMs: 2 * 60 * 1000 }; // 3 attempts -> 2 min block
        default: return { maxAttempts: 2, penaltyMs: 5 * 60 * 1000 }; // 2 attempts -> 5 min block
    }
};

const tieredRateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!loginBuckets.has(ip)) {
        loginBuckets.set(ip, { attempts: 0, tier: 0, lockoutUntil: 0 });
    }

    const bucket = loginBuckets.get(ip);

    // Check if user is currently locked out
    if (now < bucket.lockoutUntil) {
        const remainingSecs = Math.ceil((bucket.lockoutUntil - now) / 1000);
        return res.status(429).json({ 
            error: `Security lockout active. Please wait ${remainingSecs} seconds.` 
        });
    }

    // Attach tracking and punishment methods to the request object
    req.clientIp = ip;
    
    req.punishIp = () => {
        bucket.attempts += 1;
        const rules = getBucketRules(bucket.tier);
        if (bucket.attempts >= rules.maxAttempts) {
            bucket.lockoutUntil = Date.now() + rules.penaltyMs;
            bucket.attempts = 0; 
            bucket.tier += 1;    
        }
    };

    req.clearLoginBucket = () => {
        loginBuckets.delete(ip);
    };

    next();
};

export const ResidentsLoginRouter = (router, supabase) => {
    
    // ============================================================================
    // 🕵️ 2. AUDIT LOG HELPER (Direct DB Injection)
    // ============================================================================
    const logAudit = async (username, ip, userAgent, status, failReason = null) => {
        try {
            const auditDetails = JSON.stringify({
                ip_address: ip,
                user_agent: userAgent,
                status: status,
                reason: failReason
            });

            await supabase.from('audit_logs').insert([{
                actor: username || 'UNKNOWN_IP',
                action: status === 'SUCCESS' ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
                details: auditDetails
            }]);
        } catch (e) {
            console.error("⚠️ [AUDIT FAILED]:", e.message);
        }
    };

    // ============================================================================
    // 🔐 3. ENTERPRISE LOGIN ROUTE
    // ============================================================================
    router.post('/residents/login', tieredRateLimiter, async (req, res) => {
        const userAgent = req.headers['user-agent'] || 'Unknown Device';
        const { username, password } = req.body;
        const cleanUsername = username ? username.trim().toLowerCase() : '';

        try {
            // A. SAFE FETCH: Grab the account
            const { data: accountData, error: accountError } = await supabase
                .from('residents_account')
                .select('*')
                .eq('username', cleanUsername)
                .maybeSingle();

            // Generic error prevents attackers from knowing if the username exists
            if (accountError || !accountData) {
                req.punishIp();
                await logAudit(cleanUsername, req.clientIp, userAgent, 'FAILED', 'USER_NOT_FOUND');
                return res.status(401).json({ error: 'Invalid username or password.' });
            }

            // B. Verify Password
            const isValid = bcrypt.compareSync(password, accountData.password);
            if (!isValid) {
                req.punishIp();
                await logAudit(cleanUsername, req.clientIp, userAgent, 'FAILED', 'BAD_PASSWORD');
                return res.status(401).json({ error: 'Invalid username or password.' });
            }

            // C. SAFE FETCH: Grab the profile details
            const { data: profileData } = await supabase
                .from('residents_records')
                .select('first_name, last_name')
                .eq('record_id', accountData.resident_id)
                .maybeSingle();

            const fName = profileData?.first_name || '';
            const lName = profileData?.last_name || '';
            let safeFullName = `${fName} ${lName}`.trim().toUpperCase();
            if (!safeFullName || safeFullName.includes('UNDEFINED')) {
                safeFullName = 'UNKNOWN RESIDENT';
            }

            // D. THE TOKEN SPLIT (Access + Refresh)
            // Access Token (15 minutes) - Used by frontend for Bearer Auth
            const accessToken = jwt.sign({
                aud: 'authenticated',
                role: 'authenticated',
                sub: accountData.resident_id,
                record_id: accountData.resident_id,
                username: accountData.username,
                user_role: 'resident',
                first_name: fName.toUpperCase(),
                last_name: lName.toUpperCase(),
                full_name: safeFullName
            }, JWT_SECRET, { expiresIn: '15m' });

            // Refresh Token (7 Days) - Locked in HttpOnly cookie to get new Access Tokens
            const refreshToken = jwt.sign({
                sub: accountData.resident_id,
                session_version: accountData.session_version || 1 
            }, REFRESH_SECRET, { expiresIn: '7d' });

            res.cookie('refresh_token', refreshToken, {
                httpOnly: true,
                secure: true,       // Must be true for production/Cloudflare
                sameSite: 'none',   // Required for cross-domain cookies
                maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
            });

            // E. SUCCESS: Wipe penalty and log activity
            req.clearLoginBucket();
            await logAudit(cleanUsername, req.clientIp, userAgent, 'SUCCESS');

            // F. Send Response
            res.status(200).json({
                message: 'Login successful',
                access_token: accessToken, // Frontend must catch this and use it for API calls
                user: {
                    record_id: accountData.resident_id,
                    username: accountData.username,
                    full_name: safeFullName,
                    first_name: fName.toUpperCase(),
                    last_name: lName.toUpperCase(),
                    role: 'resident'
                },
                profile: {
                    record_id: accountData.resident_id,
                    first_name: fName.toUpperCase(),
                    last_name: lName.toUpperCase(),
                    formattedName: safeFullName,
                    is_first_login: accountData.requires_reset
                },
                requires_reset: accountData.requires_reset
            });

        } catch (err) {
            console.error("❌ [LOGIN CRASH]", err.message);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });
};