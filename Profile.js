// Profile.js

// 🛡️ STRICT AUTHORIZATION MIDDLEWARE (Standardized)
const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
        // Fallback for residents mapping
        if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
        
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: `Insufficient Permissions. Required roles: ${allowedRoles.join(', ')}` 
            });
        }
        req.validatedRole = userRole.toLowerCase().trim();
        next();
    };
};

export const ProfileRouter = (router, supabase, authenticateToken) => {

    // ── 1. GET: SMART PROFILE FETCH (Role-Agnostic) ──
    router.get('/officials/profile/:id', 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall', 'resident'])], 
        async (req, res) => {
            try {
                const { id } = req.params; 

                // ==========================================
                // STEP A: SEARCH OFFICIALS SYSTEM
                // ==========================================
                let { data: offAcc } = await supabase
                    .from('officials_accounts')
                    .select('official_id, role, username, theme_preference')
                    .eq('account_id', id)
                    .maybeSingle();

                if (!offAcc) {
                    const { data: altOffAcc } = await supabase
                        .from('officials_accounts')
                        .select('official_id, role, username, theme_preference')
                        .eq('official_id', id)
                        .maybeSingle();
                    offAcc = altOffAcc;
                }

                if (offAcc) {
                    const { data: profile, error: profError } = await supabase
                        .from('officials')
                        .select('*')
                        .eq('id', offAcc.official_id) 
                        .maybeSingle();

                    if (!profError && profile) {
                        return res.json({
                            ...profile,
                            email: profile.email || offAcc.username,
                            role: offAcc.role,
                            theme_preference: offAcc.theme_preference 
                        });
                    }
                }

                // ==========================================
                // STEP B: SEARCH RESIDENTS SYSTEM
                // ==========================================
                let { data: resAcc } = await supabase
                    .from('residents_account')
                    .select('resident_id, username, theme_preference')
                    .eq('account_id', id)
                    .maybeSingle();

                if (!resAcc) {
                    const { data: altResAcc } = await supabase
                        .from('residents_account')
                        .select('resident_id, username, theme_preference')
                        .eq('resident_id', id)
                        .maybeSingle();
                    resAcc = altResAcc;
                }

                if (resAcc) {
                    const { data: profile, error: resError } = await supabase
                        .from('residents_records')
                        .select('*')
                        .eq('record_id', resAcc.resident_id)
                        .maybeSingle();

                    if (!resError && profile) {
                        return res.json({
                            ...profile,
                            full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
                            email: profile.email || resAcc.username,
                            role: 'Resident', // Force generic role for residents
                            theme_preference: resAcc.theme_preference || 'light'
                        });
                    }
                }

                // If we get here, they don't exist in either system
                console.error(`[PROFILE DB ERROR]: No account mapped to ID: ${id}`); 
                return res.status(404).json({ error: "Account not found in any system." });

            } catch (err) {
                console.error("[CRITICAL PROFILE ERROR]:", err.message);
                res.status(500).json({ error: "Internal server error." });
            }
        }
    );


    // ── 2. PUT: SMART PROFILE UPDATE (Role-Agnostic) ──
    router.put('/officials/profile/:id', 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall', 'resident'])], 
        async (req, res) => {
            try {
                const { id } = req.params;
                const { full_name, first_name, last_name, email, contact_number, phone } = req.body;

                // 🛡️ ZERO-TRUST OWNERSHIP GUARD: Prevent horizontal privilege escalation
                const isAdmin = ['admin', 'superadmin', 'staff'].includes(req.validatedRole);
                const tokenIDs = [req.user?.id, req.user?.account_id, req.user?.official_id, req.user?.sub, req.user?.record_id, req.user?.resident_id].map(String);
                
                // If they are not an admin, the ID in the URL MUST match an ID in their secure token
                if (!isAdmin && !tokenIDs.includes(String(id))) {
                    return res.status(403).json({ error: "Forbidden. You are only authorized to modify your own profile." });
                }

                const safePhone = contact_number || phone;

                // ==========================================
                // STEP A: TRY UPDATING OFFICIAL
                // ==========================================
                let { data: offAcc } = await supabase.from('officials_accounts').select('official_id').eq('account_id', id).maybeSingle();
                if (!offAcc) offAcc = await supabase.from('officials_accounts').select('official_id').eq('official_id', id).maybeSingle();

                if (offAcc) {
                    const { error: updateError } = await supabase
                        .from('officials')
                        .update({ full_name, email, contact_number: safePhone })
                        .eq('id', offAcc.official_id);

                    if (updateError) throw updateError;
                    return res.status(200).json({ success: true, message: "Official profile updated." });
                }

                // ==========================================
                // STEP B: TRY UPDATING RESIDENT
                // ==========================================
                let { data: resAcc } = await supabase.from('residents_account').select('resident_id').eq('account_id', id).maybeSingle();
                if (!resAcc) resAcc = await supabase.from('residents_account').select('resident_id').eq('resident_id', id).maybeSingle();

                if (resAcc) {
                    const { error: resUpdateError } = await supabase
                        .from('residents_records')
                        .update({ 
                            first_name: first_name || full_name?.split(' ')[0], 
                            last_name: last_name || full_name?.split(' ').slice(1).join(' '),
                            email: email, 
                            contact_number: safePhone 
                        })
                        .eq('record_id', resAcc.resident_id);

                    if (resUpdateError) throw resUpdateError;
                    return res.status(200).json({ success: true, message: "Resident profile updated." });
                }

                return res.status(404).json({ success: false, error: "Account mapping failed." });

            } catch (err) {
                console.error("[PROFILE UPDATE ERROR]:", err.message);
                res.status(500).json({ success: false, error: "Failed to update profile." });
            }
        }
    );


    // ── 3. PATCH: ZERO TRUST THEME TOGGLE (Role-Agnostic) ──
    router.patch('/accounts/theme', 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall', 'resident'])], 
        async (req, res) => {
            try {
                const { theme } = req.body;
                
                // Look for every possible ID key in the JWT
                const tokenIdentifier = req.user?.id || req.user?.account_id || req.user?.official_id || req.user?.sub || req.user?.record_id || req.user?.resident_id;

                if (!tokenIdentifier) {
                    return res.status(401).json({ error: "Unauthorized session. ID missing from token." });
                }

                // Check Officials
                let { data: offAcc } = await supabase.from('officials_accounts').select('account_id').eq('account_id', tokenIdentifier).maybeSingle();
                if (!offAcc) offAcc = await supabase.from('officials_accounts').select('account_id').eq('official_id', tokenIdentifier).maybeSingle();

                if (offAcc) {
                    const { error } = await supabase.from('officials_accounts').update({ theme_preference: theme }).eq('account_id', offAcc.account_id);
                    if (error) throw error;
                    return res.status(200).json({ success: true, theme });
                }

                // Check Residents
                let { data: resAcc } = await supabase.from('residents_account').select('account_id').eq('account_id', tokenIdentifier).maybeSingle();
                if (!resAcc) resAcc = await supabase.from('residents_account').select('account_id').eq('resident_id', tokenIdentifier).maybeSingle();

                if (resAcc) {
                    // Ignore errors if the column doesn't exist yet on the residents table, but try to update it if it does
                    try {
                        await supabase.from('residents_account').update({ theme_preference: theme }).eq('account_id', resAcc.account_id);
                    } catch (e) { /* silent fail if resident table lacks theme column */ }
                    
                    return res.status(200).json({ success: true, theme });
                }

                return res.status(404).json({ error: "Account mapping failed for theme update." });

            } catch (err) {
                console.error("[THEME SYNC ERROR]:", err.message);
                res.status(500).json({ error: "Failed to sync theme preference." });
            }
        }
    );
};