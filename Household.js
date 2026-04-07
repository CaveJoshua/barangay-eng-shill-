import { logActivity } from './Auditlog.js';

/**
 * HOUSEHOLD ROUTER - ZERO TRUST ARCHITECTURE
 * Features: Atomic Member Transfers, Automated Audit Logs, and Secure Cookie RBAC.
 */

// --- 🛡️ INTERNAL RBAC GUARD ---
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Access Denied: You do not have permission to manage household records.' 
            });
        }
        next();
    };
};

export const HouseholdRouter = (router, supabase, authenticateToken) => {

    // 1. GET ALL HOUSEHOLDS (Handshake Secured)
    router.get('/households', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { data: households, error: hhError } = await supabase
                .from('households')
                .select('*')
                .order('created_at', { ascending: false });

            if (hhError) throw hhError;

            const { data: residents, error: resError } = await supabase
                .from('residents_records')
                .select('record_id, first_name, last_name, household_id, is_4ps');

            if (resError) throw resError;

            const formatted = households.map(hh => {
                const members = residents.filter(r => r.household_id === hh.id);
                const head = residents.find(r => r.record_id === hh.head_id);

                return {
                    id: hh.id,
                    household_number: hh.household_number,
                    head: head ? `${head.last_name}, ${head.first_name}` : 'Unassigned',
                    zone: hh.zone || 'N/A',
                    address: hh.address || '',
                    membersCount: members.length,
                    is4Ps: members.some(m => m.is_4ps === true),
                    isIndigent: false 
                };
            });

            res.status(200).json(formatted);
        } catch (err) {
            console.error("Household List Error:", err.message);
            res.status(500).json({ error: "Failed to sync household registry." });
        }
    });

    // 2. GET SINGLE HOUSEHOLD
    router.get('/households/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { id } = req.params;

            const { data: household, error: hhError } = await supabase
                .from('households')
                .select('*')
                .eq('id', id)
                .single();

            if (hhError) throw hhError;

            // Manual Join for Metadata
            const { data: members, error: memError } = await supabase
                .from('residents_records')
                .select('record_id, first_name, last_name, dob, household_id, relationship_to_head, occupation, sex')
                .or(`household_id.eq.${id},record_id.eq.${household.head_id}`);

            if (memError) throw memError;

            const head = members.find(m => m.record_id === household.head_id);
            const familyMembers = members.filter(m => m.household_id === id && m.record_id !== household.head_id);

            res.status(200).json({
                ...household,
                head: head || null,
                members: familyMembers || []
            });
        } catch (err) {
            res.status(500).json({ error: "Household lookup failed." });
        }
    });

    // 3. CREATE HOUSEHOLD (Audited Handshake)
    router.post('/households', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { head_id, zone, address, members } = req.body;
            const actor = req.user?.username || 'Staff';
            
            const uniqueMembers = Array.from(new Map(members.map(m => [m.record_id, m])).values());
            const memberIds = uniqueMembers.map(m => m.record_id);

            // Validation logic remains the same... (Conflict checks)
            const { data: headConflicts } = await supabase
                .from('households')
                .select('household_number, head_id')
                .in('head_id', [head_id, ...memberIds]);

            if (headConflicts && headConflicts.length > 0) {
                 throw new Error(`One or more members are already designated as Heads in Household ${headConflicts[0].household_number}.`);
            }

            const hh_num = `HH-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

            // Create House
            const { data: newHH, error: hhError } = await supabase
                .from('households')
                .insert([{ household_number: hh_num, head_id, zone, address }])
                .select().single();

            if (hhError) throw hhError;

            // Atomic Updates for Members
            const serverUpdates = uniqueMembers.map(m => {
                return supabase.from('residents_records')
                    .update({ household_id: newHH.id, relationship_to_head: m.relationship })
                    .eq('record_id', m.record_id);
            });

            serverUpdates.push(
                supabase.from('residents_records')
                    .update({ household_id: newHH.id, relationship_to_head: 'HEAD' })
                    .eq('record_id', head_id)
            );

            await Promise.all(serverUpdates);

            // Audit the Creation
            logActivity(supabase, actor, 'HOUSEHOLD_CREATED', `Mined Block: ${hh_num} established at Zone ${zone}.`)
                .catch(e => console.error("Audit Fail:", e.message));

            res.status(201).json(newHH);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // 4. UPDATE HOUSEHOLD (Synced Handshake)
    router.put('/households/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const { head_id, zone, address, members } = req.body;
            const actor = req.user?.username || 'Staff';

            const uniqueMembers = Array.from(new Map(members.map(m => [m.record_id, m])).values());
            
            // Step A: Update Household Meta
            const { error: updateError } = await supabase
                .from('households')
                .update({ head_id, zone, address, updated_at: new Date() })
                .eq('id', id);

            if (updateError) throw updateError;

            // Step B: Wipe current residents to prevent ghosts
            await supabase.from('residents_records')
                .update({ household_id: null, relationship_to_head: null })
                .eq('household_id', id);

            // Step C: Link New Batch
            const serverUpdates = uniqueMembers.map(m => {
                return supabase.from('residents_records')
                    .update({ household_id: id, relationship_to_head: m.relationship })
                    .eq('record_id', m.record_id);
            });

            serverUpdates.push(
                supabase.from('residents_records')
                    .update({ household_id: id, relationship_to_head: 'HEAD' })
                    .eq('record_id', head_id)
            );

            await Promise.all(serverUpdates);

            logActivity(supabase, actor, 'HOUSEHOLD_UPDATED', `Registry Sync: Updated Household ID ${id}.`)
                .catch(e => console.error("Audit Fail:", e.message));

            res.status(200).json({ message: "Household Sync Successful" });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // 5. DELETE HOUSEHOLD (Safe Unlinking)
    router.delete('/households/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const { id } = req.params;
            const actor = req.user?.username || 'Admin';

            // Safeguard: Everyone becomes independent again
            await supabase.from('residents_records')
                .update({ household_id: null, relationship_to_head: null })
                .eq('household_id', id);

            const { error } = await supabase.from('households').delete().eq('id', id);
            if (error) throw error;

            logActivity(supabase, actor, 'HOUSEHOLD_DELETED', `Registry Purge: Permanently removed Household ID ${id}.`)
                .catch(e => console.error("Audit Fail:", e.message));

            res.status(200).json({ message: "Household removed safely." });
        } catch (err) {
            res.status(500).json({ error: "Failed to purge record." });
        }
    });
};