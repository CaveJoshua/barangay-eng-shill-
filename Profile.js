// Profile.js
export const ProfileRouter = (router, supabase, authenticateToken) => {

    // ── 1. GET: SMART PROFILE FETCH ──
    router.get('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params; // This could be account_id OR official_id

            // Step A: Try to find the account assuming the ID is the account_id
            let { data: account } = await supabase
                .from('officials_accounts')
                .select('official_id, role, username, theme_preference')
                .eq('account_id', id)
                .single();

            // Step B: If not found, try assuming the ID is the official_id!
            if (!account) {
                const { data: altAccount } = await supabase
                    .from('officials_accounts')
                    .select('official_id, role, username, theme_preference')
                    .eq('official_id', id)
                    .single();
                
                account = altAccount; // Reassign if we found it this way
            }

            if (!account) {
                console.error(`[PROFILE DB ERROR]: No account mapped to ID: ${id}`); 
                return res.status(404).json({ error: "Administrative account not found." });
            }

            // Step C: Now that we have the guaranteed official_id, fetch the profile
            const { data: profile, error: profError } = await supabase
                .from('officials')
                .select('*')
                .eq('id', account.official_id) 
                .single();

            if (profError || !profile) {
                return res.status(404).json({ error: "Profile details missing." });
            }

            res.json({
                ...profile,
                email: profile.email || account.username,
                role: account.role,
                theme_preference: account.theme_preference 
            });

        } catch (err) {
            console.error("[CRITICAL PROFILE ERROR]:", err.message);
            res.status(500).json({ error: "Internal server error." });
        }
    });

    // ── 2. PUT: SMART PROFILE UPDATE ──
    router.put('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const { full_name, email, contact_number } = req.body;

            // 1. Find the official_id (checking both columns just like the GET route)
            let { data: account } = await supabase
                .from('officials_accounts')
                .select('official_id')
                .eq('account_id', id)
                .single();

            if (!account) {
                const { data: altAccount } = await supabase
                    .from('officials_accounts')
                    .select('official_id')
                    .eq('official_id', id)
                    .single();
                account = altAccount;
            }

            if (!account) {
                return res.status(404).json({ success: false, error: "Account mapping failed." });
            }

            // 2. Update the officials table using the guaranteed official_id
            const { error: updateError } = await supabase
                .from('officials')
                .update({
                    full_name: full_name,
                    email: email,
                    contact_number: contact_number
                })
                .eq('id', account.official_id);

            if (updateError) throw updateError;

            res.status(200).json({ success: true, message: "Profile updated successfully." });

        } catch (err) {
            console.error("[PROFILE UPDATE ERROR]:", err.message);
            res.status(500).json({ success: false, error: "Failed to update profile." });
        }
    });

    // ── 3. PATCH: ZERO TRUST THEME TOGGLE (UPDATED) ──
    router.patch('/accounts/theme', authenticateToken, async (req, res) => {
        try {
            const { theme } = req.body;
            
            // 🛡️ EXHAUSTIVE TOKEN CHECK: Look for every possible ID key in the JWT
            const tokenIdentifier = req.user?.id || req.user?.account_id || req.user?.official_id || req.user?.sub || req.user?.record_id;

            if (!tokenIdentifier) {
                return res.status(401).json({ error: "Unauthorized session. ID missing from token." });
            }

            // 🧠 SMART LOOKUP: Exactly like GET/PUT, verify the account before updating
            let { data: account } = await supabase
                .from('officials_accounts')
                .select('account_id')
                .eq('account_id', tokenIdentifier)
                .single();

            if (!account) {
                const { data: altAccount } = await supabase
                    .from('officials_accounts')
                    .select('account_id')
                    .eq('official_id', tokenIdentifier)
                    .single();
                account = altAccount;
            }

            if (!account) {
                return res.status(404).json({ error: "Account mapping failed for theme update." });
            }

            // Update the theme preference in the database targeting the verified account_id
            const { error: themeError } = await supabase
                .from('officials_accounts')
                .update({ theme_preference: theme })
                .eq('account_id', account.account_id);

            if (themeError) throw themeError;

            res.status(200).json({ success: true, theme });

        } catch (err) {
            console.error("[THEME SYNC ERROR]:", err.message);
            res.status(500).json({ error: "Failed to sync theme preference." });
        }
    });
};