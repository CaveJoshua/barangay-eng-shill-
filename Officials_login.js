import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto'; // Needed for Trace ID generation
import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js'; // Ensure your mailer is imported

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_fallback_secret';
const ROOT_EMAIL = process.env.ROOT_ADMIN_EMAIL || 'your_admin_email@gmail.com'; // ⚠️ Set this in your .env

// --- IN-MEMORY OTP STORE FOR ROOT ACCESS ---
const rootOtpStore = new Map();

const verifyPassword = (inputPassword, storedPassword) => {
    if (!inputPassword || !storedPassword) return false;
    if (storedPassword.startsWith('$2')) {
        return bcrypt.compareSync(inputPassword, storedPassword);
    }
    return inputPassword === storedPassword;
};

// --- HELPER: Derive System Role from Official Position ---
const deriveRoleFromPosition = (position, fallbackRole) => {
    if (!position) return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
    
    const pos = position.toLowerCase();
    if (pos.includes('punong') || pos.includes('captain') || pos.includes('chairman')) {
        return 'superadmin';
    }
    if (pos.includes('secretary') || pos.includes('treasurer')) {
        return 'admin';
    }
    if (pos.includes('kagawad') || pos.includes('sk')) {
        return 'admin'; 
    }
    
    return fallbackRole ? fallbackRole.toLowerCase().trim() : 'staff';
};

// --- HELPER: Generate Secure OTP ---
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Uppercase + Numbers (No confusing chars like I, O, 1, 0)
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export const OfficialsLoginRouter = (router, supabase) => {

    // ==========================================
    // 0. THE GHOST HANDSHAKE (ROOT REQUEST)
    // ==========================================
    router.post('/auth/root-request', async (req, res) => {
        try {
            const { username } = req.body;
            
            if (username !== 'SYSTEM_ROOT_ADMIN') {
                return res.status(403).json({ error: 'Invalid root handshake.' });
            }

            // Anti-Spam Check
            const existingCode = rootOtpStore.get('ROOT');
            if (existingCode && Date.now() < existingCode.cooldown) {
                return res.status(429).json({ error: 'Please wait before requesting another code.' });
            }

            const otpCode = generateSecureCode(6);
            const traceId = crypto.randomUUID();

            // Store OTP with 5-minute expiry and 1-minute cooldown
            rootOtpStore.set('ROOT', {
                code: otpCode,
                trace_id: traceId,
                expires: Date.now() + 300000, // 5 mins
                cooldown: Date.now() + 60000, // 1 min
                attempts: 0
            });

            // Send Email
            const emailMessage = `
                <h2>Root Access Requested</h2>
                <p>A Ghost Admin login attempt was initiated on your system.</p>
                <p>Your Security Code is: <b style="font-size: 24px; color: #d97706; letter-spacing: 4px;">${otpCode}</b></p>
                <p>Trace ID: <small>${traceId}</small></p>
                <p><i>If you did not request this, check your server logs immediately.</i></p>
            `;

            await sendAutoMail(ROOT_EMAIL, "URGENT: Root Access Code", "SECURITY SYSTEM", emailMessage);
            
            console.log(`[SYSTEM ROOT] Handshake initiated. Trace: ${traceId}`);
            res.status(200).json({ success: true, trace_id: traceId });

        } catch (err) {
            console.error("[ROOT HANDSHAKE ERROR]", err);
            res.status(500).json({ error: 'Failed to initiate security handshake.' });
        }
    });
    
    // ==========================================
    // 1. THE LOGIN (Handles Standard AND Root OTP)
    // ==========================================
    router.post('/admin/login', async (req, res) => {
        try {
            const { username, password, otp, trace_id } = req.body;
            
            // Front-end sends UPPERCASE, backend gracefully converts to lowercase for checks
            const cleanUsername = username ? username.trim().toLowerCase() : '';
            console.log(`[LOGIN ATTEMPT] Username: ${cleanUsername}`);

            // ----------------------------------------------------
            // 🛡️ BRANCH A: SYSTEM_ROOT_ADMIN INTERCEPT
            // ----------------------------------------------------
            if (cleanUsername === 'system_root_admin') {
                const storedRoot = rootOtpStore.get('ROOT');

                if (!storedRoot) return res.status(400).json({ error: 'No active root request found.' });
                if (storedRoot.trace_id !== trace_id) return res.status(403).json({ error: 'Trace ID mismatch.' });
                if (Date.now() > storedRoot.expires) {
                    rootOtpStore.delete('ROOT');
                    return res.status(400).json({ error: 'Code expired. Request a new one.' });
                }

                if (storedRoot.code !== otp.trim().toUpperCase()) {
                    storedRoot.attempts += 1;
                    if (storedRoot.attempts >= 3) {
                        rootOtpStore.delete('ROOT');
                        return res.status(429).json({ error: 'Maximum attempts reached. Handshake destroyed.' });
                    }
                    return res.status(401).json({ error: 'Invalid security code.' });
                }

                // OTP is Valid! Destroy it and log the user in.
                rootOtpStore.delete('ROOT');

                const tokenPayload = {
                    aud: 'authenticated',          
                    role: 'authenticated',          
                    sub: 'SYSTEM-ROOT-0000',    
                    username: 'SYSTEM_ROOT_ADMIN',
                    user_role: 'superadmin',            
                };

                const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

                res.cookie('auth_token', token, {
                    httpOnly: true,  
                    secure: true,       
                    sameSite: 'none',   
                    maxAge: 24 * 60 * 60 * 1000 
                });

                console.log(`✅ [ROOT ACCESS GRANTED] Trace ID: ${trace_id}`);
                
                return res.status(200).json({
                    message: 'Root Authentication successful',
                    access_token: token, // 🛡️ FIX: Included for frontend localStorage
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

            // ----------------------------------------------------
            // 🏢 BRANCH B: STANDARD OFFICIAL LOGIN
            // ----------------------------------------------------
            const { data: accountData, error: accountError } = await supabase
                .from('officials_accounts')
                .select(`
                    account_id,
                    username,
                    password,
                    role,
                    official_id,
                    officials (
                        full_name,
                        position
                    )
                `)
                .eq('username', cleanUsername) 
                .single();

            if (accountError || !accountData) {
                console.error("[DB ERROR]", accountError?.message);
                return res.status(401).json({ error: 'Administrative account not found.' });
            }

            const isValid = verifyPassword(password, accountData.password);
            if (!isValid) return res.status(401).json({ error: 'Invalid password.' });

            const realName = accountData.officials?.full_name || 'System Administrator';
            const position = accountData.officials?.position || 'Official';
            
            const userRole = deriveRoleFromPosition(position, accountData.role);

            const tokenPayload = {
                aud: 'authenticated',          
                role: 'authenticated',          
                sub: accountData.account_id,    
                username: accountData.username,
                user_role: userRole,            
            };

            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

            logActivity(supabase, accountData.username, 'LOGIN', `${realName} (${userRole}) logged in.`)
                .catch(err => console.error("[LOG ERROR]", err.message));

            res.cookie('auth_token', token, {
                httpOnly: true,  
                secure: true,       
                sameSite: 'none',   
                maxAge: 24 * 60 * 60 * 1000 
            });

            res.status(200).json({
                message: 'Authentication successful',
                access_token: token, // 🛡️ FIX: Included for frontend localStorage
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole, 
                profile: { 
                    record_id: accountData.official_id, 
                    profileName: realName,
                    position: position,
                    role: userRole 
                }
            });

        } catch (err) {
            console.error("[CRITICAL LOGIN ERROR]", err.message);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });

    // ==========================================
    // 2. THE KILL SWITCH (LOGOUT)
    // ==========================================
    router.post('/admin/logout', (req, res) => {
        res.clearCookie('auth_token', {
            httpOnly: true,
            secure: true,
            sameSite: 'none'
        });
        
        console.log("[AUTH] Session terminated and cookie cleared.");
        res.status(200).json({ message: 'Logged out securely.' });
    });

    // ==========================================
    // 3. ZERO TRUST KEY ROTATION (REFRESH)
    // ==========================================
    router.post('/auth/refresh', (req, res) => {
        try {
            const token = req.cookies?.auth_token;
            if (!token) {
                return res.status(401).json({ error: 'No token to refresh' });
            }

            jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, decoded) => {
                if (err || !decoded) {
                    return res.status(403).json({ error: 'Invalid token signature' });
                }

                const now = Math.floor(Date.now() / 1000);
                if (decoded.exp && (now - decoded.exp > 604800)) { 
                    return res.status(401).json({ error: 'Refresh window expired. Please log in again.' });
                }

                const { iat, exp, ...newPayload } = decoded;
                const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '24h' });

                res.cookie('auth_token', newToken, {
                    httpOnly: true,
                    secure: true,
                    sameSite: 'none',
                    maxAge: 24 * 60 * 60 * 1000
                });

                console.log(`[ZERO TRUST] Token silently refreshed for user: ${decoded.username}`);
                
                // 🛡️ FIX: Return the new token so `api.ts` can update `localStorage`
                res.status(200).json({ 
                    message: 'Token rotated successfully',
                    token: newToken 
                });
            });
        } catch (err) {
            console.error("[REFRESH ERROR]", err.message);
            res.status(500).json({ error: 'Failed to refresh session.' });
        }
    });
};