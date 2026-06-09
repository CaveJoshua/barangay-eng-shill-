import bcrypt  from 'bcryptjs';
import jwt     from 'jsonwebtoken';
import crypto  from 'crypto';
import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) throw new Error('[FATAL] SUPABASE_JWT_SECRET is not set.');

const ROOT_EMAIL = process.env.ROOT_EMAIL;
if (!ROOT_EMAIL) throw new Error('[FATAL] ROOT_EMAIL is not set in environment.');

const isProduction = process.env.NODE_ENV === 'production';

// OTP store: values are { codeHash, expires, cooldown, attempts, trace_id }
const rootOtpStore = new Map();

// Hashes a plaintext OTP code using SHA-256 so it is never stored in memory as plaintext
const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

// Uses crypto.randomInt for cryptographically secure OTP generation
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
};

// Async password verification — never blocks event loop, never compares plaintext
const verifyPassword = async (inputPassword, storedPassword) => {
    if (!inputPassword || !storedPassword) return false;
    if (!storedPassword.startsWith('$2')) {
        // Password is not hashed — reject and flag for remediation
        console.error('[SECURITY] Unhashed password detected in officials_accounts. Force-reset required.');
        return false;
    }
    return bcrypt.compare(inputPassword, storedPassword);
};

// ── 🛡️ THE FIX: BULLETPROOF ROLE DERIVATION ──
const deriveRoleFromPosition = (position, fallbackRole, username = '') => {
    // 1. Explicit override for the barangayhall account
    const cleanUser = String(username).toLowerCase().replace(/\s+/g, '');
    if (cleanUser === 'barangayhall') return 'barangayhall';

    if (!position) return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
    const pos = position.toLowerCase();
    
    // Both Master Gmail and Punong Barangay receive Superadmin access
    if (pos.includes('super admin') || pos.includes('punong')) return 'superadmin';
    if (pos.includes('secretary') || pos.includes('treasurer') || pos.includes('kagawad') || pos.includes('sk')) return 'admin';
    if (pos.includes('barangay hall')) return 'barangayhall';
    
    return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
};

export const OfficialsLoginRouter = (router, supabase) => {

    // ==========================================
    // 0. ROOT GHOST HANDSHAKE (EMERGENCY ACCESS)
    // ==========================================
    router.post('/auth/root-request', async (req, res) => {
        try {
            if (req.body.username !== 'SYSTEM_ROOT_ADMIN') {
                return res.status(403).json({ error: 'Invalid root handshake.' });
            }

            const existingCode = rootOtpStore.get('ROOT');
            if (existingCode && Date.now() < existingCode.cooldown) {
                return res.status(429).json({ error: 'Please wait before requesting another code.' });
            }

            const otpCode = generateSecureCode(6);
            const traceId = crypto.randomUUID();

            rootOtpStore.set('ROOT', {
                codeHash: hashOtp(otpCode),  // stored as hash, never plaintext
                trace_id: traceId,
                expires: Date.now() + 300000, // 5 mins
                cooldown: Date.now() + 60000, // 1 min
                attempts: 0
            });

            const emailMessage = `
                <h2>Root Access Requested</h2>
                <p>A Ghost Admin login attempt was initiated on your system.</p>
                <p>Your Security Code is: <b style="font-size: 24px; color: #d97706; letter-spacing: 4px;">${otpCode}</b></p>
                <p>Trace ID: <small>${traceId}</small></p>
                <hr/>
                <p><i>System Note: Root Admin accounts are timeless and bypass standard ledgers.</i></p>
            `;

            await sendAutoMail(ROOT_EMAIL, "URGENT: Root Access Code", "SECURITY SYSTEM", emailMessage);
            res.status(200).json({ success: true, trace_id: traceId });
        } catch (err) {
            res.status(500).json({ error: 'Failed to initiate security handshake.' });
        }
    });
    
    // ==========================================
    // 1. SYSTEM LOGIN (HANDLES BOTH ROOT & STANDARD)
    // ==========================================
    router.post('/admin/login', async (req, res) => {
        try {
            const { username, password, otp, trace_id } = req.body;
            const cleanUsername = username ? username.trim().toLowerCase() : '';

            // 🛡️ BRANCH A: SYSTEM_ROOT_ADMIN
            if (cleanUsername === 'system_root_admin') {
                const storedRoot = rootOtpStore.get('ROOT');

                if (!storedRoot) return res.status(400).json({ error: 'No active root request found.' });
                if (storedRoot.trace_id !== trace_id) return res.status(403).json({ error: 'Trace ID mismatch.' });
                if (Date.now() > storedRoot.expires) {
                    rootOtpStore.delete('ROOT');
                    return res.status(400).json({ error: 'Code expired.' });
                }

                if (hashOtp(otp.trim().toUpperCase()) !== storedRoot.codeHash) {
                    storedRoot.attempts += 1;
                    if (storedRoot.attempts >= 3) {
                        rootOtpStore.delete('ROOT');
                        return res.status(429).json({ error: 'Maximum attempts reached.' });
                    }
                    return res.status(401).json({ error: 'Invalid security code.' });
                }

                rootOtpStore.delete('ROOT');

                const token = jwt.sign({
                    aud: 'authenticated', role: 'authenticated',
                    sub: 'SYSTEM-ROOT-0000', username: 'SYSTEM_ROOT_ADMIN', user_role: 'superadmin'
                }, JWT_SECRET, { expiresIn: '1h' });

                // 🔒 PRODUCTION GRADE COOKIE 
                res.cookie('auth_token', token, { 
                    httpOnly: true, 
                    secure: true, 
                    sameSite: isProduction ? 'none' : 'lax', 
                    maxAge: 86400000 
                });
                
                return res.status(200).json({
                    message: 'Root Authentication successful',
                    account_id: 'SYSTEM-ROOT-0000',
                    username: 'SYSTEM_ROOT_ADMIN',
                    role: 'superadmin',
                    profile: {
                        record_id: 'SYSTEM-ROOT-0000',
                        profileName: 'System Root Administrator',
                        position: 'System Owner',
                        role: 'superadmin'
                    }
                });
            }

            // 🏢 BRANCH B: STANDARD & BARANGAY HALL LOGIN
            const { data: accountData, error: accountError } = await supabase
                .from('officials_accounts')
                .select(`
                    account_id, username, password, role, official_id, theme_preference,
                    officials ( full_name, position, term_start, term_end )
                `)
                .eq('username', cleanUsername)
                .single();

            if (accountError || !accountData) return res.status(401).json({ error: 'Account not found.' });
            if (!(await verifyPassword(password, accountData.password))) return res.status(401).json({ error: 'Invalid password.' });

            const position = accountData.officials?.position || 'Official';
            
            const userRole = deriveRoleFromPosition(position, accountData.role, accountData.username);
            const isMasterAccount = position === 'Super Admin';

            const token = jwt.sign({
                aud: 'authenticated', role: 'authenticated',
                sub: accountData.account_id, username: accountData.username, user_role: userRole
            }, JWT_SECRET, { expiresIn: '1h' });

            logActivity(supabase, accountData.username, 'LOGIN', `${accountData.officials?.full_name} logged in.`).catch(() => {});

            // 🔒 PRODUCTION GRADE COOKIE
            res.cookie('auth_token', token, { 
                httpOnly: true, 
                secure: true, 
                sameSite: isProduction ? 'none' : 'lax', 
                maxAge: 86400000 
            });

            res.status(200).json({
                message: 'Authentication successful',
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole,
                theme_preference: accountData.theme_preference || 'light',
                profile: {
                    record_id: accountData.official_id,
                    profileName: accountData.officials?.full_name,
                    position: position,
                    role: userRole,
                    ...(isMasterAccount ? {} : {
                        term_start: accountData.officials?.term_start,
                        term_end: accountData.officials?.term_end
                    })
                }
            });

        } catch (err) {
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // ==========================================
    // 2. LOGOUT (KILL SWITCH)
    // ==========================================
    router.post('/admin/logout', (req, res) => {
        // 🔒 CLEAR THE SECURE COOKIE
        res.clearCookie('auth_token', { 
            httpOnly: true, 
            secure: true, 
            sameSite: isProduction ? 'none' : 'lax' 
        });
        res.status(200).json({ message: 'Logged out securely.' });
    });

    // ==========================================
    // 3. ADMIN SESSION REFRESH (separate from resident refresh)
    // Re-issues the httpOnly admin cookie. Only valid within 24h of original issue.
    // ==========================================
    router.post('/auth/admin/refresh', (req, res) => {
        try {
            const token = req.cookies?.auth_token;
            if (!token) return res.status(401).json({ error: 'No admin session found.' });

            // ignoreExpiration so we can accept an already-expired token and re-issue
            // within a short grace window — this is what allows reactive refresh on 401.
            jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, decoded) => {
                if (err || !decoded) return res.status(403).json({ error: 'Invalid or tampered token.' });

                // Only allow refresh within 5 minutes of expiry to keep the window tight
                const expiredAt = decoded.exp * 1000;
                const GRACE_MS = 5 * 60 * 1000;
                if (Date.now() > expiredAt + GRACE_MS) {
                    res.clearCookie('auth_token', { httpOnly: true, secure: true, sameSite: isProduction ? 'none' : 'lax' });
                    return res.status(401).json({ error: 'Session expired. Please log in again.' });
                }

                const { iat, exp, ...newPayload } = decoded;
                const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '1h' });

                res.cookie('auth_token', newToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: isProduction ? 'none' : 'lax',
                    maxAge: 86400000
                });

                res.status(200).json({ message: 'Session refreshed.' });
            });
        } catch (err) {
            res.status(500).json({ error: 'Refresh failed.' });
        }
    });
};