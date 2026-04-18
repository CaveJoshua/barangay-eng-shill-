import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_fallback_secret';
const ROOT_EMAIL = process.env.ROOT_ADMIN_EMAIL || 'your_admin_email@gmail.com';

// 🛡️ CRITICAL FIX: Environment Check for Cookies
const isProduction = process.env.NODE_ENV === 'production';

const rootOtpStore = new Map();

const verifyPassword = (inputPassword, storedPassword) => {
    if (!inputPassword || !storedPassword) return false;
    return storedPassword.startsWith('$2') 
        ? bcrypt.compareSync(inputPassword, storedPassword) 
        : inputPassword === storedPassword;
};

// ── HELPER: DERIVE SYSTEM ROLE ──
const deriveRoleFromPosition = (position, fallbackRole) => {
    if (!position) return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
    const pos = position.toLowerCase();
    
    // Both Master Gmail and Punong Barangay receive Superadmin access
    if (pos.includes('super admin') || pos.includes('punong')) return 'superadmin';
    if (pos.includes('secretary') || pos.includes('treasurer') || pos.includes('kagawad') || pos.includes('sk')) return 'admin';
    
    return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
};

const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
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
                code: otpCode,
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

                if (storedRoot.code !== otp.trim().toUpperCase()) {
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
                }, JWT_SECRET, { expiresIn: '24h' });

                // 🛡️ APPLYING DYNAMIC COOKIE SECURITY
                res.cookie('auth_token', token, { 
                    httpOnly: true, 
                    secure: isProduction, 
                    sameSite: isProduction ? 'none' : 'lax', 
                    maxAge: 86400000 
                });
                
                return res.status(200).json({
                    message: 'Root Authentication successful',
                    access_token: token,
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
                    account_id, username, password, role, official_id,
                    officials ( full_name, position, term_start, term_end )
                `)
                .eq('username', cleanUsername) 
                .single();

            if (accountError || !accountData) return res.status(401).json({ error: 'Account not found.' });
            if (!verifyPassword(password, accountData.password)) return res.status(401).json({ error: 'Invalid password.' });

            const position = accountData.officials?.position || 'Official';
            const userRole = deriveRoleFromPosition(position, accountData.role);
            const isMasterAccount = position === 'Super Admin';

            const token = jwt.sign({
                aud: 'authenticated', role: 'authenticated',          
                sub: accountData.account_id, username: accountData.username, user_role: userRole
            }, JWT_SECRET, { expiresIn: '24h' });

            logActivity(supabase, accountData.username, 'LOGIN', `${accountData.officials?.full_name} logged in.`).catch(() => {});

            // 🛡️ APPLYING DYNAMIC COOKIE SECURITY
            res.cookie('auth_token', token, { 
                httpOnly: true, 
                secure: isProduction, 
                sameSite: isProduction ? 'none' : 'lax', 
                maxAge: 86400000 
            });

            res.status(200).json({
                message: 'Authentication successful',
                access_token: token, // Sent back so frontend can optionally store it as Bearer
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole, 
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
        // 🛡️ APPLYING DYNAMIC COOKIE SECURITY
        res.clearCookie('auth_token', { 
            httpOnly: true, 
            secure: isProduction, 
            sameSite: isProduction ? 'none' : 'lax' 
        });
        res.status(200).json({ message: 'Logged out securely.' });
    });

    // ==========================================
    // 3. ZERO TRUST KEY ROTATION (REFRESH)
    // ==========================================
    router.post('/auth/refresh', (req, res) => {
        try {
            const token = req.cookies?.auth_token;
            if (!token) return res.status(401).json({ error: 'No token' });

            jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, decoded) => {
                if (err || !decoded) return res.status(403).json({ error: 'Invalid token' });

                const { iat, exp, ...newPayload } = decoded;
                const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '24h' });

                // 🛡️ APPLYING DYNAMIC COOKIE SECURITY
                res.cookie('auth_token', newToken, {
                    httpOnly: true, 
                    secure: isProduction, 
                    sameSite: isProduction ? 'none' : 'lax', 
                    maxAge: 86400000
                });

                res.status(200).json({ message: 'Token rotated', token: newToken });
            });
        } catch (err) {
            res.status(500).json({ error: 'Refresh failed.' });
        }
    });
};