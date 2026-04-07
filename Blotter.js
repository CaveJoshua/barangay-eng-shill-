import { logActivity } from './Auditlog.js';
import { checkRole } from './Rbac_acc.js'; 

/**
 * 📢 INTERNAL HELPER: Notify All Admins/Staff of New Incidents
 * 🛡️ BULLETPROOF VERSION: Ignores uppercase/lowercase role mismatches
 */
const notifyAllAdmins = async (supabase, title, message, type = 'blotter') => {
    try {
        const { data: officials, error: fetchError } = await supabase
            .from('officials_account')
            .select('account_id, role');

        if (fetchError) {
            console.error("❌ [NOTIF ERROR] Could not fetch officials:", fetchError.message);
            return;
        }

        const validRoles = ['admin', 'superadmin', 'staff'];
        const targetAdmins = officials.filter(off => 
            off.role && validRoles.includes(off.role.toLowerCase().trim())
        );

        if (targetAdmins.length > 0) {
            const bulkNotifs = targetAdmins.map(admin => ({
                user_id: String(admin.account_id),
                title: title,
                message: message,
                type: type, 
                is_read: false,
                created_at: new Date().toISOString()
            }));

            const { error: insertError } = await supabase.from('notifications').insert(bulkNotifs);
            
            if (insertError) {
                console.error("❌ [NOTIF ERROR] Supabase rejected the insert:", insertError.message);
            } else {
                console.log(`✅ [NOTIF SUCCESS] Blotter notification delivered to ${targetAdmins.length} admins.`);
            }
        } else {
            console.warn("⚠️ [NOTIF WARNING] No admins or staff found in the database. Nobody to notify.");
        }
    } catch (err) {
        console.error("💥 [SYSTEM ERROR] Admin Notification Dispatch Failed:", err.message);
    }
};

export const BlotterRouter = (router, supabase, authenticateToken) => {
    
    // =========================================================
    // 1. GET: FETCH ALL (Unified Cases & Portal Requests)
    // =========================================================
    router.get('/blotter', authenticateToken, checkRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const userRole = (req.user?.role || req.user?.user_role || '').toLowerCase();
            const tokenResidentId = req.user?.record_id || req.user?.resident_record_id;
            const isResident = userRole === 'resident';

            let casesQuery = supabase.from('blotter_cases').select('*');
            if (isResident) {
                casesQuery = casesQuery.eq('complainant_id', tokenResidentId);
            }
            
            const { data: cases, error: caseError } = await casesQuery.order('created_at', { ascending: false });
            if (caseError) throw caseError;

            let reqQuery = supabase.from('blotter_requests').select('*');
            if (isResident) {
                reqQuery = reqQuery.eq('resident_id', tokenResidentId);
            }
            const { data: requests } = await reqQuery;

            const unifiedData = [
                ...(cases || []),
                ...(requests || []).map(r => ({
                    ...r,
                    id: r.id || r.request_id,
                    case_number: 'PENDING',
                    status: r.status || 'Pending'
                }))
            ];

            res.json(unifiedData);
        } catch (err) {
            console.error("[BLOTTER GET ERROR]:", err.message);
            res.status(500).json({ error: "Failed to sync blotter records." });
        }
    });

    // =========================================================
    // 2. POST: CREATE NEW COMPLAINT
    // =========================================================
    router.post('/blotter', authenticateToken, checkRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const r = req.body; 
            const userRole = (req.user?.role || req.user?.user_role || '').toLowerCase();
            const tokenResidentId = req.user?.record_id || req.user?.resident_record_id;

            const secureComplainantId = (userRole === 'resident') ? tokenResidentId : (r.complainant_id || 'WALK-IN');

            const dbPayload = {
                case_number: r.caseNumber || r.case_number || `BLT-${Date.now()}`,
                complainant_name: r.complainantName || r.complainant_name,
                complainant_id: secureComplainantId,
                respondent: r.respondent,
                incident_type: r.type || r.incident_type,
                narrative: r.narrative,
                date_filed: r.dateFiled || r.date_filed || new Date().toISOString().split('T')[0],
                time_filed: r.timeFiled || r.time_filed || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                status: 'Pending'
            };

            const { data, error } = await supabase.from('blotter_cases').insert([dbPayload]).select().single();
            if (error) throw error;

            await logActivity(supabase, req.user.username, 'BLOTTER_CREATED', `Case ${dbPayload.case_number} filed against ${dbPayload.respondent}`);
            
            await notifyAllAdmins(
                supabase, 
                "New Blotter Incident Filed", 
                `Case ${dbPayload.case_number}: ${dbPayload.complainant_name} filed a complaint against ${dbPayload.respondent}.`,
                'blotter' 
            );

            res.status(201).json({ success: true, data });
        } catch (err) {
            console.error("[BLOTTER POST ERROR]:", err.message);
            res.status(400).json({ error: err.message });
        }
    });

    // =========================================================
    // 3. PUT: SMART DYNAMIC UPDATE (THE FIX IS HERE)
    // =========================================================
    // This route now dynamically maps only the fields provided by the frontend.
    // It accepts BOTH full form updates AND partial status/hearing updates securely.
    router.put('/blotter/:id', authenticateToken, checkRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;

            // Initialize an empty payload
            const updates = {};

            // 🛠️ DYNAMIC MAPPING: Only add to payload if it exists in the request
            if (r.complainantName !== undefined || r.complainant_name !== undefined) updates.complainant_name = r.complainantName || r.complainant_name;
            if (r.complainantId !== undefined || r.complainant_id !== undefined) updates.complainant_id = r.complainantId || r.complainant_id;
            if (r.respondent !== undefined) updates.respondent = r.respondent;
            if (r.type !== undefined || r.incident_type !== undefined) updates.incident_type = r.type || r.incident_type;
            if (r.narrative !== undefined) updates.narrative = r.narrative;
            if (r.dateFiled !== undefined || r.date_filed !== undefined) updates.date_filed = r.dateFiled || r.date_filed;
            if (r.timeFiled !== undefined || r.time_filed !== undefined) updates.time_filed = r.timeFiled || r.time_filed;
            
            // Allow dynamic injection of the new scheduling & rejection columns
            if (r.status !== undefined) updates.status = r.status;
            if (r.hearing_date !== undefined) updates.hearing_date = r.hearing_date;
            if (r.hearing_time !== undefined) updates.hearing_time = r.hearing_time;
            if (r.rejection_reason !== undefined) updates.rejection_reason = r.rejection_reason;

            // Execute the update
            const { data, error } = await supabase
                .from('blotter_cases')
                .update(updates)
                .eq('id', id)
                .select()
                .single();

            if (error) throw error;

            await logActivity(supabase, req.user.username, 'BLOTTER_UPDATED', `Case ID ${id} modified/updated.`);
            res.json({ success: true, data });
        } catch (err) {
            console.error("[BLOTTER PUT ERROR]:", err.message);
            res.status(500).json({ error: err.message || "Failed to update case details." });
        }
    });

    // =========================================================
    // 4. PATCH: STATUS & HEARING UPDATE (Kept for fallback/direct API calls)
    // =========================================================
    router.patch('/blotter/:id/status', authenticateToken, checkRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const { status, hearing_date, hearing_time, rejection_reason } = req.body;

            const { data, error } = await supabase
                .from('blotter_cases')
                .update({ 
                    status, 
                    hearing_date, 
                    hearing_time, 
                    rejection_reason
                })
                .eq('id', id)
                .select().single();

            if (error) throw error;

            await logActivity(supabase, req.user.username, 'BLOTTER_STATUS_CHANGE', `Case ID ${id} marked as ${status}`);
            res.json({ success: true, data });
        } catch (err) {
            console.error("[BLOTTER PATCH ERROR]:", err.message);
            res.status(500).json({ error: "Status update failed." });
        }
    });

    // =========================================================
    // 5. DELETE: REMOVE RECORD
    // =========================================================
    router.delete('/blotter/:id', authenticateToken, checkRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase.from('blotter_cases').delete().eq('id', id);
            
            if (error) throw error;

            await logActivity(supabase, req.user.username, 'BLOTTER_DELETED', `Case ID ${id} removed from system.`);
            res.json({ success: true, message: "Record permanently deleted." });
        } catch (err) {
            console.error("[BLOTTER DELETE ERROR]:", err.message);
            res.status(500).json({ error: "Deletion failed." });
        }
    });
};