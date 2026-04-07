import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';

/**
 * 📢 INTERNAL HELPER 1: Notify a Specific User (Admin -> Resident)
 */
const createNotification = async (supabase, userId, title, message, type = 'document') => {
    try {
        const { error } = await supabase
            .from('notifications')
            .insert([{
                user_id: String(userId), // Forced to string to match the new text format
                title: title,
                message: message,
                type: type,
                is_read: false,
                created_at: new Date().toISOString()
            }]);
        if (error) console.error("[NOTIFICATION ERROR]", error.message);
    } catch (err) {
        console.error("[SYSTEM ERROR] Notification Dispatch Failed:", err.message);
    }
};

/**
 * 📢 INTERNAL HELPER 2: Notify All Admins/Staff (Resident -> Admin)
 * 🛡️ BULLETPROOF VERSION: Ignores uppercase/lowercase role mismatches
 */
const notifyAllAdmins = async (supabase, title, message, type = 'document') => {
    try {
        // 1. Fetch ALL officials to bypass case-sensitivity SQL limitations
        const { data: officials, error: fetchError } = await supabase
            .from('officials_account')
            .select('account_id, role');

        if (fetchError) {
            console.error("❌ [NOTIF ERROR] Could not fetch officials:", fetchError.message);
            return;
        }

        // 2. Filter in JavaScript to make it 100% case-insensitive
        const validRoles = ['admin', 'superadmin', 'staff'];
        const targetAdmins = officials.filter(off => 
            off.role && validRoles.includes(off.role.toLowerCase().trim())
        );

        if (targetAdmins.length > 0) {
            // 3. Prepare the payload
            const bulkNotifs = targetAdmins.map(admin => ({
                user_id: String(admin.account_id), // Forced to string to match the SQL update
                title: title,
                message: message,
                type: type,
                is_read: false,
                created_at: new Date().toISOString()
            }));

            // 4. Fire the notifications
            const { error: insertError } = await supabase.from('notifications').insert(bulkNotifs);
            
            if (insertError) {
                console.error("❌ [NOTIF ERROR] Supabase rejected the insert:", insertError.message);
            } else {
                console.log(`✅ [NOTIF SUCCESS] Notification delivered to ${targetAdmins.length} admins.`);
            }
        } else {
            console.warn("⚠️ [NOTIF WARNING] No admins or staff found in the database. Nobody to notify.");
        }
    } catch (err) {
        console.error("💥 [SYSTEM ERROR] Admin Notification Dispatch Failed:", err.message);
    }
};

/**
 * 🛡️ ZERO TRUST RBAC MIDDLEWARE
 */
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Security Policy: Insufficient permissions.' 
            });
        }
        req.validatedRole = userRole;
        next();
    };
};

export const documentRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 1. GET CONFIG: DOCUMENT TYPES
    // =========================================================
    router.get('/documents/types', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const documentTypes = [
                { id: 'brgy_clearance', label: 'Barangay Clearance', price: 200, icon: 'fa-file-certificate' },
                { id: 'cert_residency', label: 'Certificate of Residency', price: 75, icon: 'fa-home' },
                { id: 'cert_indigency', label: 'Certificate of Indigency', price: 0, icon: 'fa-hand-holding-heart' },
                { id: 'biz_permit', label: 'Barangay Certificate (jobseeker)', price: 500, icon: 'fa-store' },
                { id: 'good_moral', label: 'Affidavit of Barangay Official', price: 50, icon: 'fa-user-check' }
            ];
            res.status(200).json(documentTypes);
        } catch (err) {
            res.status(500).json({ error: "Configuration Sync Failed." });
        }
    });

    // =========================================================
    // 2. GET REGISTRY: FETCH ALL DOCUMENTS
    // =========================================================
    router.get('/documents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            let query = supabase.from('document_requests').select('*');
            if (req.validatedRole === 'resident') {
                const residentId = req.user?.record_id || req.user?.resident_id; 
                query = query.eq('resident_id', residentId);
            }
            const { data: docs, error: docError } = await query.order('date_requested', { ascending: false });
            if (docError) throw docError;

            const { data: residents } = await supabase.from('residents_records').select('record_id, first_name, last_name, email');
            const formattedData = docs.map(doc => {
                const resident = residents?.find(r => r.record_id === doc.resident_id);
                return {
                    ...doc,
                    residentName: resident ? `${resident.last_name}, ${resident.first_name}` : (doc.resident_name || 'Unknown'),
                    residentEmail: resident?.email || null
                };
            });
            res.status(200).json(formattedData);
        } catch (err) {
            res.status(500).json({ error: "Registry Sync Error." });
        }
    });

    // =========================================================
    // 3. POST: SAVE REQUEST (Resident & Admin Notifications)
    // =========================================================
    router.post('/documents/save', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const r = req.body;
            const actor = req.user?.username || 'Resident';
            const userRole = req.validatedRole;

            // 🛡️ THE IDENTITY LOCK
            const secureResidentId = (userRole === 'resident') 
                ? (req.user?.record_id || req.user?.resident_id) 
                : r.resident_id;

            if (!secureResidentId) {
                return res.status(403).json({ success: false, error: "Cannot verify resident identity." });
            }

            const { data, error } = await supabase.from('document_requests').insert([{
                resident_id: secureResidentId,
                resident_name: r.resident_name,
                type: r.type,
                purpose: r.purpose,
                other_purpose: r.other_purpose || '',
                price: r.price || 0,
                reference_no: r.reference_no || `REF-${Date.now()}`,
                date_requested: new Date().toISOString(),
                status: 'Pending'
            }]).select().single();

            if (error) throw error;

            logActivity(supabase, actor, 'DOCUMENT_REQUEST_CREATED', `Request for ${r.type} filed by ${r.resident_name}.`);

            // 🔔 RESIDENT CONFIRMATION NOTIFICATION
            if (userRole === 'resident') {
                await createNotification(
                    supabase, 
                    secureResidentId, 
                    "Request Received", 
                    `Your request for ${r.type} is pending review. The final fee is to be assessed by the staff.`,
                    'document'
                );
            }

            // 🔔 RESIDENT -> ADMIN NOTIFICATION TRIGGER
            await notifyAllAdmins(
                supabase, 
                "New Document Request", 
                `${r.resident_name} has requested a ${r.type}. Please review the request and assess the fee.`,
                'document'
            );

            // 📧 AUTO-MAILER
            if (process.env.SMTP_USER) {
                sendAutoMail(
                    process.env.SMTP_USER, 
                    "New Document Request Received",
                    "Action Required: Review & Assess Fee",
                    `A new request for <b>${r.type}</b> has been submitted by <b>${r.resident_name}</b>.<br><br>
                     <b>Purpose:</b> ${r.purpose}<br>
                     <b>Reference No:</b> ${data.reference_no}<br><br>
                     Please log in to the Dashboard to review the request and assess the document fee.`
                ).catch(e => console.error("[ADMIN MAIL FAIL]", e.message));
            }

            res.status(201).json({ success: true, data });
        } catch (err) {
            console.error("[DOC SAVE ERROR]", err.message);
            res.status(400).json({ success: false, error: err.message || "Database Rejected Request." });
        }
    });

    // =========================================================
    // 4. PUT: UPDATE & NOTIFY RESIDENT
    // =========================================================
    router.put('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;
            const actor = req.user?.username || 'Staff';

            const { data, error } = await supabase
                .from('document_requests')
                .update({ status: r.status, price: r.price, purpose: r.purpose })
                .eq('id', id)
                .select().single();

            if (error) throw error;

            logActivity(supabase, actor, 'DOCUMENT_UPDATED', `Doc ID ${id} set to ${r.status}.`);
            
            // 🔔 ADMIN -> RESIDENT NOTIFICATION TRIGGER
            await createNotification(
                supabase, 
                data.resident_id, 
                "Document Status Update", 
                `Your request for ${data.type} is now ${r.status}. Assessed Fee: ₱${parseFloat(r.price).toFixed(2)}.`,
                'document'
            );

            if (['Approved', 'Ready', 'Released', 'Rejected'].includes(r.status)) {
                const { data: resi } = await supabase.from('residents_records').select('email, first_name').eq('record_id', data.resident_id).single();
                if (resi?.email) {
                    sendAutoMail(
                        resi.email, 
                        `Document Update: ${r.status}`, 
                        `Hello, ${resi.first_name}!`, 
                        `Your request for <b>${data.type}</b> has been updated to <b>${r.status}</b>.<br>
                         <b>Assessed Fee:</b> ₱${parseFloat(r.price).toFixed(2)}`
                    ).catch(e => console.error("[RESIDENT MAIL FAIL]", e.message));
                }
            }

            res.status(200).json(data);
        } catch (err) {
            res.status(400).json({ error: "Update failed." });
        }
    });

    // =========================================================
    // 5. PATCH: QUICK STATUS CHANGE & NOTIFY
    // =========================================================
    router.patch('/documents/:id/status', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { status } = req.body;
            const actor = req.user?.username || 'Staff';

            const { data, error } = await supabase
                .from('document_requests')
                .update({ status }) 
                .eq('id', req.params.id)
                .select().single();

            if (error) throw error;

            logActivity(supabase, actor, 'STATUS_PATCH', `Doc ID ${req.params.id} -> ${status}`);
            
            // 🔔 ADMIN -> RESIDENT NOTIFICATION TRIGGER
            await createNotification(
                supabase, 
                data.resident_id, 
                "Document Alert", 
                `Your ${data.type} is now marked as ${status}.`,
                'document'
            );

            const { data: resi } = await supabase.from('residents_records').select('email, first_name').eq('record_id', data.resident_id).single();
            if (resi?.email) {
                sendAutoMail(resi.email, "Status Alert", `Hi ${resi.first_name}`, `Your ${data.type} status is now: ${status}.`)
                .catch(e => console.error("[MAIL FAIL]", e.message));
            }

            res.status(200).json(data);
        } catch (err) {
            res.status(400).json({ error: "Status toggle rejected." });
        }
    });

    // =========================================================
    // 6. DELETE: PURGE
    // =========================================================
    router.delete('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const actor = req.user?.username || 'Admin';
            const { error } = await supabase.from('document_requests').delete().eq('id', req.params.id);
            if (error) throw error;
            
            logActivity(supabase, actor, 'DELETED_DOCUMENT', `Purged Record ID: ${req.params.id}`);
            res.status(200).json({ message: "Record removed." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};