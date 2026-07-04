import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import nodemailer from 'nodemailer'; // 🛡️ INTEGRATED: Nodemailer fallback for emergency paths
import { logActivity } from '../lib/Auditlog.js';
import { sendAutoMail } from '../lib/Mailer.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) throw new Error('[FATAL] SUPABASE_JWT_SECRET is not set.');

const ROOT_EMAIL = process.env.ROOT_EMAIL;
if (!ROOT_EMAIL) throw new Error('[FATAL] ROOT_EMAIL is not set in environment.');

const isProduction = process.env.NODE_ENV === 'production';

// 🍪 Cross-site cookie SameSite configuration (Cloudflare deployment adjustment).
const getSameSite = (req) =>
    (req?.secure === true
        || String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
        || isProduction)
        ? 'none' : 'lax';

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
        console.error('[SECURITY] Unhashed password detected in officials_accounts. Force-reset required.');
        return false;
    }
    return bcrypt.compare(inputPassword, storedPassword);
};

// ── 🛡️ ROLE DERIVATION ENGINE ──
const deriveRoleFromPosition = (position, fallbackRole, username = '') => {
    const cleanUser = String(username).toLowerCase().replace(/\s+/g, '');
    if (cleanUser === 'barangayhall') return 'barangayhall';

    if (!position) return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
    const pos = position.toLowerCase();
    
    if (pos.includes('super admin') || pos.includes('punong')) return 'superadmin';
    if (pos.includes('secretary') || pos.includes('treasurer') || pos.includes('kagawad') || pos.includes('sk')) return 'admin';
    if (pos.includes('barangay hall')) return 'barangayhall';

    return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
};

// ── 🔒 STATUS GATE ──
// Any status other than "Active" (Suspended / Resigned) revokes admin access
// immediately. This is what lets the Punong Barangay flip an official's
// Status and have the system enforce it on the very next session refresh.
// A missing status is treated as Active.
const isAccessRevoked = (official) =>
    String(official?.status || 'Active').trim().toLowerCase() !== 'active';

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
                codeHash: hashOtp(otpCode),
                trace_id: traceId,
                expires: Date.now() + 300000, // 5 mins
                cooldown: Date.now() + 60000, // 1 min
                attempts: 0
            });

            const emailMessage = `
                An emergency Ghost Admin login attempt was initiated on your system.<br><br>
                Your Security Code is: <br><br>
                <span style="font-size: 24px; font-weight: bold; color: #d97706; background: #f1f5f9; padding: 10px; letter-spacing: 4px;">${otpCode}</span><br><br>
                Trace ID: <small>${traceId}</small><br><br>
                <i>System Note: Root Admin accounts bypass traditional operational ledgers.</i>
            `;

            let isSent = false;

            // 📩 Attempt 1: Primary Mailer (Resend Engine)
            try {
                isSent = await sendAutoMail(ROOT_EMAIL, "URGENT: Root Access Code", "SECURITY SYSTEM", emailMessage);
            } catch (resendErr) {
                console.warn("[MAILER] Resend API execution failed during root token request. Pivoting to SMTP fallback...", resendErr.message);
            }

            // 🔁 Attempt 2: Secondary Mailer (Nodemailer SMTP Fallback)
            if (!isSent) {
                if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
                    try {
                        const transporter = nodemailer.createTransport({
                            host: process.env.SMTP_HOST,
                            port: process.env.SMTP_PORT || 587,
                            secure: process.env.SMTP_PORT == 464,
                            auth: {
                                user: process.env.SMTP_USER,
                                pass: process.env.SMTP_PASS,
                            },
                        });

                        const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@engineer-hill.gov.ph";

                        await transporter.sendMail({
                            from: `"Barangay Engineer's Hill Security" <${smtpFrom}>`,
                            to: ROOT_EMAIL,
                            subject: "URGENT: Root Access Code",
                            html: `
                                <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                                    <h2 style="color: #e67e22; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">SECURITY SYSTEM</h2>
                                    <p style="font-size: 16px; color: #34495e; line-height: 1.6;">${emailMessage}</p>
                                </div>
                            `
                        });

                        isSent = true;
                        console.log(`[MAILER] Fallback SMTP route successfully delivered the root token.`);
                    } catch (smtpErr) {
                        console.error("[MAILER ERROR] Root SMTP fallback execution failed:", smtpErr.message);
                    }
                } else {
                    console.warn("[MAILER WARNING] Root SMTP fallback skipped: Environmental parameters missing.");
                }
            }

            if (!isSent) {
                return res.status(500).json({ error: 'Failed to dispatch security code via primary and fallback interfaces.' });
            }

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

                res.cookie('auth_token', token, { 
                    httpOnly: true, 
                    secure: true, 
                    sameSite: getSameSite(req), 
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
                    officials ( full_name, position, status )
                `)
                .eq('username', cleanUsername)
                .single();

            if (accountError || !accountData) return res.status(401).json({ error: 'Account not found.' });
            if (!(await verifyPassword(password, accountData.password))) return res.status(401).json({ error: 'Invalid password.' });

            const position = accountData.officials?.position || 'Official';
            const derivedRole = deriveRoleFromPosition(position, accountData.role, accountData.username);

            // 🔒 STATUS GATE: a non-Active official can still authenticate, but their
            // role is downgraded to 'restricted' — which is in no authorizeRoles()
            // allowlist, so every protected admin route returns 403. The frontend
            // shows a lock screen.
            const restricted = isAccessRevoked(accountData.officials);
            const userRole = restricted ? 'restricted' : derivedRole;

            const token = jwt.sign({
                aud: 'authenticated', role: 'authenticated',
                sub: accountData.account_id, username: accountData.username, user_role: userRole
            }, JWT_SECRET, { expiresIn: '1h' });

            logActivity(supabase, accountData.username, 'LOGIN', `${accountData.officials?.full_name} logged in.`, req).catch(() => {});

            res.cookie('auth_token', token, { 
                httpOnly: true, 
                secure: true, 
                sameSite: getSameSite(req), 
                maxAge: 86400000 
            });

            res.status(200).json({
                message: 'Authentication successful',
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole,
                term_status: restricted ? 'restricted' : 'active',
                theme_preference: accountData.theme_preference || 'light',
                profile: {
                    record_id: accountData.official_id,
                    profileName: accountData.officials?.full_name,
                    position: position,
                    role: userRole,
                    term_status: restricted ? 'restricted' : 'active',
                    // Distinguishes WHY access is restricted (Suspended/Resigned) so
                    // the lock screen can explain which one applies.
                    official_status: accountData.officials?.status || 'Active',
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
        res.clearCookie('auth_token', { 
            httpOnly: true, 
            secure: true, 
            sameSite: getSameSite(req) 
        });
        res.status(200).json({ message: 'Logged out securely.' });
    });

    // ==========================================
    // 3. ADMIN SESSION REFRESH
    // ==========================================
    router.post('/auth/admin/refresh', (req, res) => {
        try {
            const token = req.cookies?.auth_token;
            if (!token) return res.status(401).json({ error: 'No admin session found.' });

            jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, async (err, decoded) => {
                if (err || !decoded) return res.status(403).json({ error: 'Invalid or tampered token.' });

                // The access token lives 1h, but the auth_token cookie lives 24h
                // (maxAge below). A silent refresh should succeed for as long as the
                // cookie is valid — otherwise a short idle past the 1h mark logs the
                // user out. Align the grace window with the cookie's 24h lifetime so
                // active sessions slide forward instead of being kicked out.
                const expiredAt = decoded.exp * 1000;
                const GRACE_MS = 24 * 60 * 60 * 1000; // 24h — matches the cookie maxAge
                if (Date.now() > expiredAt + GRACE_MS) {
                    res.clearCookie('auth_token', { httpOnly: true, secure: true, sameSite: getSameSite(req) });
                    return res.status(401).json({ error: 'Session expired. Please log in again.' });
                }

                const { iat, exp, ...newPayload } = decoded;
                let termStatus = 'active';
                let officialStatus;

                // 🔒 Re-evaluate status against current DB state on every refresh so a
                // mid-session Suspend/Resign downgrades to 'restricted' (and restoring
                // Active restores the proper role). Skip the system root, no record.
                if (decoded.sub && decoded.sub !== 'SYSTEM-ROOT-0000') {
                    try {
                        const { data: acct } = await supabase
                            .from('officials_accounts')
                            .select('role, username, officials ( position, status )')
                            .eq('account_id', decoded.sub)
                            .single();

                        if (acct) {
                            const position = acct.officials?.position || 'Official';
                            const derivedRole = deriveRoleFromPosition(position, acct.role, acct.username);
                            const restricted = isAccessRevoked(acct.officials);
                            newPayload.user_role = restricted ? 'restricted' : derivedRole;
                            termStatus = restricted ? 'restricted' : 'active';
                            // Mid-session status change (e.g. Punong Barangay suspends this
                            // official) needs to reach the lock screen's copy too.
                            officialStatus = acct.officials?.status || 'Active';
                        }
                    } catch {
                        // On lookup failure, keep the existing token role unchanged.
                    }
                }

                const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '1h' });

                res.cookie('auth_token', newToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: getSameSite(req),
                    maxAge: 86400000
                });

                res.status(200).json({ message: 'Session refreshed.', role: newPayload.user_role, term_status: termStatus, official_status: officialStatus });
            });
        } catch (err) {
            res.status(500).json({ error: 'Refresh failed.' });
        }
    });
};
