import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logActivity } from './Auditlog.js';

// Siguraduhin na ang secret na ito ay ang "Legacy JWT Secret" mula sa Supabase Dashboard
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
            const userRole = accountData.role ? accountData.role.toLowerCase() : 'staff';

            const tokenPayload = {
                aud: 'authenticated',           
                role: 'authenticated',          
                sub: accountData.account_id,    
                username: accountData.username,
                user_role: userRole,            
            };

            // Sign token (24 hours expiry)
            const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

            logActivity(supabase, accountData.username, 'LOGIN', `${realName} (${userRole}) logged in.`)
                .catch(err => console.error("[LOG ERROR]", err.message));

            // 🛡️ UPDATED: Cross-Site Cookie Injection
            res.cookie('auth_token', token, {
                httpOnly: true,  
                secure: true,       // MUST BE TRUE for sameSite 'none'
                sameSite: 'none',   // ALLOWS Cloudflare to talk to Render
                maxAge: 24 * 60 * 60 * 1000 
            });

            res.status(200).json({
                message: 'Authentication successful',
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole,
                profile: { 
                    record_id: accountData.official_id, 
                    profileName: realName,
                    position: position
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
        // 🛡️ UPDATED: Cross-Site Cookie Destruction
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

            // Verify the token, ignoring expiration so we can rotate a recently expired one safely
            jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }, (err, decoded) => {
                if (err || !decoded) {
                    return res.status(403).json({ error: 'Invalid token signature' });
                }

                // Check if the token is completely stale (e.g., expired more than 7 days ago)
                const now = Math.floor(Date.now() / 1000);
                if (decoded.exp && (now - decoded.exp > 604800)) { 
                    return res.status(401).json({ error: 'Refresh window expired. Please log in again.' });
                }

                // Strip old timeline claims so jwt.sign can generate fresh ones
                const { iat, exp, ...newPayload } = decoded;
                
                // Mint a fresh 24-hour token
                const newToken = jwt.sign(newPayload, JWT_SECRET, { expiresIn: '24h' });

                // 🛡️ UPDATED: Cross-Site Cookie Injection
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