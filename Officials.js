import bcrypt from 'bcryptjs';
import { logActivity } from './Auditlog.js'; 

// --- 🛡️ ZERO TRUST BOUNCER ---
// Completely ignores client headers. Only reads the secure, server-signed JWT payload.
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
        
        if (!userRole || !allowedRoles.includes(userRole)) {
            console.log(`[RBAC REJECTED] Attempted Role="${userRole}", Path=${req.path}`);
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: `Security Policy Violation: Requires [${allowedRoles.join(', ')}].` 
            });
        }
        
        req.validatedRole = userRole;
        next();
    };
};

// --- EMAIL PREFIX HELPER ---
const getRolePrefix = (position) => {
    const pos = position.toLowerCase();
    if (pos.includes('punong')) return 'pb';
    if (pos.includes('secretary')) return 'sec';
    if (pos.includes('treasurer')) return 'treas';
    if (pos.includes('kagawad')) return 'kag';
    if (pos.includes('sk')) return 'sk';
    return 'staff';
};

export const OfficialsRouter = (router, supabase, authenticateToken) => {

    // ==========================================
    // 1. GET ALL OFFICIALS 
    // ==========================================
    router.get('/officials', authenticateToken, async (req, res) => {
        try { 
            const { data, error } = await supabase
                .from('officials')
                .select('*')
                .order('position', { ascending: true }); 
            
            if (error) throw error; 
            res.json(data); 
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    });

    // ==========================================
    // 2. GET: SMART PROFILE FETCH (Zero Trust Override)
    // ==========================================
    router.get('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            // 🛡️ ZERO TRUST OVERRIDE:
            // The frontend is sending a "ghost ID" (cdddff4e...). We will ignore it!
            // Instead, we extract your true ID directly from your secure login token.
            const trueId = req.user?.account_id || req.user?.record_id || req.user?.sub;

            // Step A: Search using the TRUE token ID
            let { data: account } = await supabase
                .from('officials_accounts')
                .select('official_id, role, username, theme_preference')
                .eq('account_id', trueId)
                .single();

            // Step B: Fallback just in case the token stores the official_id instead
            if (!account) {
                const { data: altAccount } = await supabase
                    .from('officials_accounts')
                    .select('official_id, role, username, theme_preference')
                    .eq('official_id', trueId)
                    .single();
                account = altAccount;
            }

            if (!account) {
                console.error(`[PROFILE DB ERROR]: Could not match token ID: ${trueId}`); 
                return res.status(404).json({ error: "Account not found in database." });
            }

            // Step C: Fetch the profile
            const { data: profile, error: profError } = await supabase
                .from('officials')
                .select('*')
                .eq('id', account.official_id)
                .single();

            if (profError || !profile) return res.status(404).json({ error: "Profile missing." });

            res.json({ 
                ...profile, 
                email: profile.email || account.username, 
                role: account.role,
                theme_preference: account.theme_preference 
            });
        } catch (err) {
            console.error("[CRITICAL PROFILE ERROR]:", err.message);
            res.status(500).json({ error: "Server Error" });
        }
    });
    
    // ==========================================
    // 3. PUT: SMART PROFILE UPDATE (Zero Trust & Crash Proof)
    // ==========================================
    router.put('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            const { full_name, email, contact_number } = req.body;

            // 🛡️ ZERO TRUST OVERRIDE FIX: 
            // We ignore req.params.id to prevent IDOR attacks.
            const trueId = req.user?.account_id || req.user?.record_id || req.user?.sub;

            if (!trueId) {
                return res.status(401).json({ error: "Invalid session token." });
            }

            // Search both columns to prevent 404s using the verified token ID
            let { data: account } = await supabase
                .from('officials_accounts')
                .select('official_id')
                .eq('account_id', trueId)
                .single();

            if (!account) {
                const { data: altAccount } = await supabase
                    .from('officials_accounts')
                    .select('official_id')
                    .eq('official_id', trueId)
                    .single();
                account = altAccount;
            }

            if (!account) return res.status(404).json({ error: "Account not found." });

            const { data, error } = await supabase
                .from('officials')
                .update({ full_name, contact_number, email })
                .eq('id', account.official_id)
                .select().single();

            if (error) throw error;
            res.json({ message: "Updated", profile: data });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==========================================
    // 4. POST: ADD OFFICIAL & AUTO-GENERATE ACCOUNT
    // ==========================================
    router.post('/officials', authenticateToken, checkSessionRole(['admin', 'superadmin', 'administrator']), async (req, res) => {
        try {
            const { full_name, position, term_start, term_end, status, contact_number } = req.body;

            const { data: profile, error: profileError } = await supabase
                .from('officials')
                .insert([{
                    full_name,
                    position,
                    term_start: term_start || null,
                    term_end: term_end || null,
                    status: status || 'Active',
                    contact_number
                }])
                .select()
                .single();

            if (profileError) throw profileError;

            // Generate Initials
            const nameParts = profile.full_name.trim().split(/\s+/);
            const firstName = nameParts[0].toLowerCase();
            const prefix = getRolePrefix(position); 

            let fI = nameParts[0] ? nameParts[0][0].toLowerCase() : 'x';
            let mI = 'x'; 
            let lI = 'x';

            if (nameParts.length >= 3) {
                mI = nameParts[1][0].toLowerCase();
                lI = nameParts[nameParts.length - 1][0].toLowerCase();
            } else if (nameParts.length === 2) {
                lI = nameParts[1][0].toLowerCase();
            }
            const initials = `${fI}${mI}${lI}`;

            // Generate Unique Username
            let isUnique = false;
            let finalUsername = "";
            const { count } = await supabase.from('officials_accounts').select('*', { count: 'exact', head: true });
            let sequence = (count || 0) + 1;

            while (!isUnique) {
                const numberSuffix = String(sequence).padStart(3, '0');
                const candidate = `${initials}${numberSuffix}@${prefix}.officials.eng-hill.brg.ph`;

                const { data: existing } = await supabase
                    .from('officials_accounts')
                    .select('username')
                    .eq('username', candidate)
                    .maybeSingle();

                if (!existing) {
                    finalUsername = candidate;
                    isUnique = true;
                } else {
                    sequence++; 
                }
            }

            const plainPassword = `${firstName}123456`;
            const securePassword = bcrypt.hashSync(plainPassword, 10);
            const systemRole = position.toLowerCase().includes('punong') ? 'superadmin' : 'admin';

            const { error: accountError } = await supabase
                .from('officials_accounts')
                .insert([{
                    official_id: profile.id,
                    username: finalUsername,
                    password: securePassword,
                    role: systemRole,
                    status: 'Active'
                }]);

            if (accountError) throw accountError;

            await logActivity(supabase, req.user?.username || 'System', 'ADD_OFFICIAL', `Added ${full_name} as ${position}`);

            res.status(201).json({ 
                ...profile, 
                account: { username: finalUsername, password: plainPassword } 
            });

        } catch (err) {
            console.error("Save Error:", err.message);
            res.status(400).json({ error: err.message });
        }
    });

    // ==========================================
    // 5. PUT: UPDATE OFFICIAL
    // ==========================================
    router.put('/officials/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'administrator']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { full_name, position, term_start, term_end, status, contact_number } = req.body; 

            const updates = { full_name, position, term_start, term_end, status, contact_number };

            const { data, error } = await supabase
                .from('officials')
                .update(updates)
                .eq('id', id)
                .select(); 

            if (error) throw error; 
            await logActivity(supabase, req.user?.username || 'System', 'UPDATE_OFFICIAL', `Updated details for ${full_name}`);
            res.json(data[0]); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });

    // ==========================================
    // 6. DELETE: SOFT ARCHIVE
    // ==========================================
    router.delete('/officials/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'administrator']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { data: official } = await supabase.from('officials').select('full_name').eq('id', id).single();
            
            const { error } = await supabase
                .from('officials')
                .update({ status: 'End of Term', term_end: new Date().toISOString().split('T')[0] })
                .eq('id', id); 
                
            if (error) throw error; 
            
            await logActivity(supabase, req.user?.username || 'System', 'ARCHIVE_OFFICIAL', `Official term ended: ${official?.full_name}`);
            res.json({ message: 'Official term ended successfully' }); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });
};