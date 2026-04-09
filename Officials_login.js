import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logActivity } from './Auditlog.js';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_fallback_secret';

const verifyPassword = (inputPassword, storedPassword) => {
    if (!inputPassword || !storedPassword) return false;
    if (storedPassword.startsWith('$2')) {
        return bcrypt.compareSync(inputPassword, storedPassword);
    }
    return inputPassword === storedPassword;
};

export const OfficialsLoginRouter = (router, supabase) => {
    
    // ==========================================
    // 1. THE HANDSHAKE (LOGIN)
    // ==========================================
    router.post('/admin/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            const cleanUsername = username ? username.trim().toLowerCase() : '';

            console.log(`[LOGIN ATTEMPT] Username: ${cleanUsername}`);

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
                .ilike('username', cleanUsername)
                .single();

            if (accountError || !accountData) {
                console.error("[DB ERROR]", accountError?.message);
                return res.status(401).json({ error: 'Administrative account not found.' });
            }

            const isValid = verifyPassword(password, accountData.password);
            if (!isValid) return res.status(401).json({ error: 'Invalid password.' });

            const realName = accountData.officials?.full_name || 'System Administrator';
            const position = accountData.officials?.position || 'Official';
            
            // 🛡️ THE FIX: Normalize the role (remove spaces, lowercase) 
            // This ensures "superadmin" is sent exactly as the frontend expects.
            const userRole = accountData.role ? accountData.role.toLowerCase().trim() : 'staff';

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

            // 🛡️ Cross-Site Cookie Injection
            res.cookie('auth_token', token, {
                httpOnly: true,  
                secure: true,       // Required for sameSite 'none' (Cloudflare/Render)
                sameSite: 'none',   
                maxAge: 24 * 60 * 60 * 1000 
            });

            // 🛡️ Consistency: Send the specific userRole in the main role field 
            // and the profile object to avoid any frontend confusion.
            res.status(200).json({
                message: 'Authentication successful',
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
                res.status(200).json({ message: 'Token rotated successfully' });
            });
        } catch (err) {
            console.error("[REFRESH ERROR]", err.message);
            res.status(500).json({ error: 'Failed to refresh session.' });
        }
    });
};