import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_fallback_secret';

export const ResidentsLoginRouter = (router, supabase) => {
    
    router.post('/residents/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            const cleanUsername = username ? username.trim().toLowerCase() : '';

            console.log(`[RESIDENT LOGIN DATA RECEIVED] Raw: "${username}", Cleaned: "${cleanUsername}", PassLength: ${password?.length}`);

            // 1. SAFE FETCH: Grab the account
            const { data: accountData, error: accountError } = await supabase
                .from('residents_account')
                .select('*')
                .eq('username', cleanUsername)
                .single();

            if (accountError) {
                if (accountError.code !== 'PGRST116') {
                    console.error("❌ [DB FETCH ERROR - ACCOUNT]:", accountError.message);
                }
                return res.status(401).json({ error: 'Resident account not found.' });
            }

            if (!accountData) {
                return res.status(401).json({ error: 'Resident account not found.' });
            }

            // 2. Verify Password
            const isValid = bcrypt.compareSync(password, accountData.password);
            if (!isValid) return res.status(401).json({ error: 'Invalid password.' });

            // 3. SAFE FETCH: Grab the profile details
            const { data: profileData, error: profileError } = await supabase
                .from('residents_records')
                .select('first_name, last_name, email')
                .eq('record_id', accountData.resident_id)
                .single();

            if (profileError) {
                console.warn("⚠️ [DB WARNING - PROFILE]: Profile metadata missing, but allowing login.", profileError.message);
            }

            // 🛡️ THE FIX: Aggressively format the name and ensure it's never "undefined"
            const fName = profileData?.first_name || '';
            const lName = profileData?.last_name || '';
            
            let safeFullName = `${fName} ${lName}`.trim().toUpperCase();
            
            if (!safeFullName || safeFullName.includes('UNDEFINED')) {
                safeFullName = 'UNKNOWN RESIDENT';
            }

            // 4. Generate Zero Trust Token (NOW WITH IDENTITY DATA!)
            const tokenPayload = {
                aud: 'authenticated',
                role: 'authenticated',
                sub: accountData.resident_id,
                record_id: accountData.resident_id,
                username: accountData.username,
                user_role: 'resident',
                first_name: fName.toUpperCase(),
                last_name: lName.toUpperCase(),
                full_name: safeFullName,  // 🔥 This fixes Document.js!
                exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24) 
            };

            const token = jwt.sign(tokenPayload, JWT_SECRET);

            // 5. Inject Secure Cookie
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 24 * 60 * 60 * 1000
            });

            // 6. Send Data to Frontend LocalStorage
            res.status(200).json({
                message: 'Login successful',
                user: {
                    record_id: accountData.resident_id,
                    username: accountData.username,
                    full_name: safeFullName,
                    first_name: fName.toUpperCase(),
                    last_name: lName.toUpperCase(),
                    role: 'resident'
                },
                // Pack this for the useDashboardLogic.ts to catch easily
                profile: {
                    record_id: accountData.resident_id,
                    first_name: fName.toUpperCase(),
                    last_name: lName.toUpperCase(),
                    formattedName: safeFullName
                }
            });

        } catch (err) {
            console.error("❌ [LOGIN CRASH]", err.message);
            res.status(500).json({ error: 'Internal server error.' });
        }
    });
};