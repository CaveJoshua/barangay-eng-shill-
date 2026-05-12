import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logActivity } from './Auditlog.js'; 
import { sendAutoMail } from './Mailer.js'; 

const ALL_SYSTEM_ROLES = [
    'superadmin', 'admin', 'staff', 'barangayhall', 
    'punongbarangay', 'barangaysecretary', 'secretary', 
    'kagawad', 'barangaykagawad', 
    'skchairperson', 'barangayskchairperson', 
    'treasurer', 'barangaytreasurer', 
    'bhw', 'barangayhealthworker', 
    'resident'
];

const deriveSystemRole = (position) => {
    if (!position) return 'resident';
    const posLower = position.toLowerCase();
    
    if (posLower.includes('punong') || posLower.includes('super admin') || posLower.includes('barangay hall')) return 'superadmin';
    if (posLower.includes('secretary')) return 'barangaysecretary';
    if (posLower.includes('treasurer')) return 'treasurer';
    if (posLower.includes('kagawad')) return 'kagawad';
    if (posLower.includes('sk') || posLower.includes('youth')) return 'skchairperson';
    if (posLower.includes('health worker') || posLower.includes('bhw')) return 'bhw';
    return 'staff';
};

const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
        if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
        
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ error: 'Forbidden', message: `Access Denied.` });
        }
        
        req.validatedRole = userRole.toLowerCase().trim();
        next();
    };
};

export const ProfileRouter = (router, supabase, authenticateToken) => {

    // ── 1. GET: BRUTE-FORCE PROFILE FETCH ──
    router.get('/officials/profile/:id', 
        [authenticateToken, authorizeRoles(ALL_SYSTEM_ROLES)], 
        async (req, res) => {
            try {
                // 🛡️ BRUTE FORCE OVERRIDE: Ignore the URL ID. Trust ONLY the verified JWT token.
                const secureTokenId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.record_id || req.user?.id || req.user?.sub;
                
                // If token fails, fallback to requested ID
                const targetId = secureTokenId || req.params.id;

                // TIER 1: SEARCH OFFICIALS
                let offAcc = null;
                const { data: accById } = await supabase.from('officials_accounts').select('*').eq('account_id', targetId).maybeSingle();
                if (accById) offAcc = accById;
                else {
                    const { data: accByOffId } = await supabase.from('officials_accounts').select('*').eq('official_id', targetId).maybeSingle();
                    if (accByOffId) offAcc = accByOffId;
                }

                if (offAcc) {
                    const { data: profile } = await supabase.from('officials').select('*').eq('id', offAcc.official_id).maybeSingle();
                    if (profile) {
                        return res.json({
                            ...profile,
                            email: profile.email || offAcc.username,
                            role: deriveSystemRole(profile.position), 
                            theme_preference: offAcc.theme_preference 
                        });
                    }
                }

                // TIER 2: SEARCH RESIDENTS
                let resAcc = null;
                const { data: rAccById } = await supabase.from('residents_account').select('*').eq('account_id', targetId).maybeSingle();
                if (rAccById) resAcc = rAccById;
                else {
                    const { data: rAccByResId } = await supabase.from('residents_account').select('*').eq('resident_id', targetId).maybeSingle();
                    if (rAccByResId) resAcc = rAccByResId;
                }

                if (resAcc) {
                    const { data: profile } = await supabase.from('residents_records').select('*').eq('record_id', resAcc.resident_id).maybeSingle();
                    if (profile) {
                        return res.json({
                            ...profile,
                            full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
                            email: profile.email || resAcc.username,
                            role: 'resident', 
                            theme_preference: resAcc.theme_preference || 'light'
                        });
                    }
                }

                return res.status(404).json({ error: "Brute-force mapping failed." });

            } catch (err) {
                res.status(500).json({ error: "Internal server error." });
            }
        }
    );

    // ── 2. PUT: BRUTE-FORCE PROFILE UPDATE ──
    router.put('/officials/profile/:id', 
        [authenticateToken, authorizeRoles(ALL_SYSTEM_ROLES)], 
        async (req, res) => {
            try {
                const { full_name, first_name, last_name, email, contact_number, phone } = req.body;

                // 🛡️ BRUTE FORCE: Force update on the token's owner, ignore URL hacks
                const targetId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.record_id || req.params.id;
                const safePhone = contact_number || phone;

                // UPDATE OFFICIAL
                let { data: offAcc } = await supabase.from('officials_accounts').select('official_id').eq('account_id', targetId).maybeSingle();
                if (!offAcc) offAcc = await supabase.from('officials_accounts').select('official_id').eq('official_id', targetId).maybeSingle();

                if (offAcc) {
                    await supabase.from('officials').update({ full_name, email, contact_number: safePhone }).eq('id', offAcc.official_id);
                    return res.status(200).json({ success: true, message: "Official profile updated." });
                }

                // UPDATE RESIDENT
                let { data: resAcc } = await supabase.from('residents_account').select('resident_id').eq('account_id', targetId).maybeSingle();
                if (!resAcc) resAcc = await supabase.from('residents_account').select('resident_id').eq('resident_id', targetId).maybeSingle();

                if (resAcc) {
                    await supabase.from('residents_records').update({ 
                        first_name: first_name || full_name?.split(' ')[0], 
                        last_name: last_name || full_name?.split(' ').slice(1).join(' '),
                        email: email, 
                        contact_number: safePhone 
                    }).eq('record_id', resAcc.resident_id);
                    return res.status(200).json({ success: true, message: "Resident profile updated." });
                }

                return res.status(404).json({ success: false, error: "Account mapping failed." });

            } catch (err) {
                res.status(500).json({ success: false, error: "Failed to update profile." });
            }
        }
    );

    // ── 3. PATCH: BRUTE-FORCE THEME TOGGLE ──
    router.patch('/accounts/theme', 
        [authenticateToken, authorizeRoles(ALL_SYSTEM_ROLES)], 
        async (req, res) => {
            try {
                const { theme } = req.body;
                const tokenIdentifier = req.user?.id || req.user?.account_id || req.user?.official_id || req.user?.sub || req.user?.record_id || req.user?.resident_id;

                if (!tokenIdentifier) return res.status(401).json({ error: "Unauthorized session." });

                let { data: offAcc } = await supabase.from('officials_accounts').select('account_id').eq('account_id', tokenIdentifier).maybeSingle();
                if (!offAcc) offAcc = await supabase.from('officials_accounts').select('account_id').eq('official_id', tokenIdentifier).maybeSingle();

                if (offAcc) {
                    await supabase.from('officials_accounts').update({ theme_preference: theme }).eq('account_id', offAcc.account_id);
                    return res.status(200).json({ success: true, theme });
                }

                let { data: resAcc } = await supabase.from('residents_account').select('account_id').eq('account_id', tokenIdentifier).maybeSingle();
                if (!resAcc) resAcc = await supabase.from('residents_account').select('account_id').eq('resident_id', tokenIdentifier).maybeSingle();

                if (resAcc) {
                    try { await supabase.from('residents_account').update({ theme_preference: theme }).eq('account_id', resAcc.account_id); } catch (e) { }
                    return res.status(200).json({ success: true, theme });
                }

                return res.status(404).json({ error: "Theme update mapping failed." });

            } catch (err) {
                res.status(500).json({ error: "Failed to sync theme preference." });
            }
        }
    );
};