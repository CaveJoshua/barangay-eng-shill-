import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';

// =========================================================
// INTERNAL HELPER 1: Notify a Specific User (Admin -> Resident)
// =========================================================
const createNotification = async (supabase, userId, title, message, type = 'document') => {
    if (!userId) return; 
    try {
        const { error } = await supabase
            .from('notifications')
            .insert([{
                user_id: String(userId), 
                title: title,
                message: message,
                type: type,
                is_read: false,
                created_at: new Date().toISOString()
            }]);
        if (error) throw error;
    } catch (err) {
        console.error("[NOTIFICATION_DISPATCH_ERROR] Failed to send user notification:", err.message);
    }
};

// =========================================================
// INTERNAL HELPER 2: Notify All Admins/Staff
// =========================================================
const notifyAllAdmins = async (supabase, title, message, type = 'document') => {
    try {
        const { data: officials, error: fetchError } = await supabase
            .from('officials_accounts') 
            .select('account_id, role');

        if (fetchError) throw fetchError;
        if (!officials || officials.length === 0) return;

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
            if (insertError) throw insertError;
        }
    } catch (err) {
        console.error("[ADMIN_NOTIFICATION_ERROR] Failed to broadcast to officials:", err.message);
    }
};

// =========================================================
// ZERO TRUST RBAC MIDDLEWARE
// =========================================================
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
        if (!allowedRoles.includes(userRole)) {
            console.warn(`[RBAC_VIOLATION] Role '${userRole}' attempted unauthorized access to ${req.originalUrl}.`);
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Security Policy: Insufficient permissions.' 
            });
        }
        req.validatedRole = userRole;
        next();
    };
};

// =========================================================
// ROUTER EXPORT
// =========================================================
export const documentRouter = (router, supabase, authenticateToken) => {

    // ── 1. GET CONFIG: DOCUMENT TYPES ──
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
            console.error("[DOCUMENT_TYPES_FETCH_ERROR] Configuration sync failed:", err.message);
            res.status(500).json({ error: "Configuration Sync Failed." });
        }
    });

    // ── 2. GET REGISTRY: FETCH ALL DOCUMENTS ──
    router.get('/documents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            let query = supabase.from('document_requests').select('*');
            
            if (req.validatedRole === 'resident') {
                const residentId = req.user?.record_id || req.user?.resident_id || req.user?.sub; 
                if (!residentId) return res.status(400).json({ error: "Missing resident identity in token." });
                query = query.eq('resident_id', residentId);
            }

            const { data: docs, error: docError } = await query.order('date_requested', { ascending: false });
            if (docError) throw docError;

            const { data: residents, error: resError } = await supabase.from('residents_records').select('record_id, first_name, last_name, email');
            if (resError) throw resError;

            // 🎯 Ensure rejection_reason is explicitly mapped and provided to the frontend
            const formattedData = (docs || []).map(doc => {
                const resident = residents?.find(r => r.record_id === doc.resident_id);
                return {
                    ...doc,
                    residentName: resident ? `${resident.last_name}, ${resident.first_name}` : (doc.resident_name || 'Unknown'),
                    residentEmail: resident?.email || null,
                    rejection_reason: doc.rejection_reason || null 
                };
            });
            
            res.status(200).json(formattedData);
        } catch (err) {
            console.error("[DOCUMENT_REGISTRY_FETCH_ERROR] Failed to retrieve document records:", err.message || err);
            res.status(500).json({ error: "Registry Sync Error. Check server logs." });
        }
    });

    // ── 2.5 THE RESIDENT ROUTING POINT ──
    router.get('/documents/resident/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { id } = req.params;
            const { data, error } = await supabase
                .from('document_requests')
                .select('*') 
                .eq('resident_id', id)
                .order('date_requested', { ascending: false });

            if (error) throw error;
            res.status(200).json(data || []);
        } catch (err) {
            console.error(`[DOC_ROUTER] Resident ${req.params.id} Fetch Error:`, err.message);
            res.status(500).json({ error: "Failed to retrieve your document history." });
        }
    });

    // ── 3. POST: SAVE REQUEST (THE ID FACTORY) ──
    router.post('/documents/save', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const r = req.body;
            const actor = req.user?.username || req.user?.sub || 'Resident';
            const userRole = req.validatedRole;

            const requestMethod = userRole === 'resident' ? 'Online' : 'Walk-in';
            const prefix = userRole === 'resident' ? 'ON-LN' : 'WK-IN';

            const secureResidentId = (userRole === 'resident') 
                ? (req.user?.record_id || req.user?.resident_id || req.user?.sub) 
                : r.resident_id;

            if (!secureResidentId) {
                return res.status(403).json({ success: false, error: "Cannot verify resident identity." });
            }

            const tempRef = `TEMP-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

            const { data: initialDoc, error: insertError } = await supabase.from('document_requests').insert([{
                resident_id: secureResidentId,
                resident_name: r.resident_name,
                type: r.type,
                purpose: r.purpose,
                other_purpose: r.other_purpose || '',
                price: r.price || 0,
                reference_no: tempRef, 
                date_requested: new Date().toISOString(),
                status: 'Pending',
                request_method: requestMethod
            }]).select().single();

            if (insertError) throw insertError;

            const prettyId = `${prefix}-${String(initialDoc.id).padStart(4, '0')}`;

            const { data: finalDoc, error: updateError } = await supabase
                .from('document_requests')
                .update({ reference_no: prettyId })
                .eq('id', initialDoc.id)
                .select()
                .single();

            if (updateError) throw updateError;

            logActivity(supabase, actor, 'DOCUMENT_REQUEST_CREATED', `Request for ${r.type} filed by ${r.resident_name} (${requestMethod}). ID: ${prettyId}`);

            if (userRole === 'resident' && requestMethod === 'Online') {
                await createNotification(supabase, secureResidentId, "Request Received", `Your online request for ${r.type} is pending review.`, 'document');
            } else if (requestMethod === 'Walk-in') {
                console.info(`[SYSTEM_INFO] Walk-in request logged for ${r.resident_name}. Initial notification bypassed.`);
            }

            await notifyAllAdmins(supabase, "New Document Request", `${r.resident_name} requested a ${r.type} (${requestMethod}). Ref: ${prettyId}`, 'document');

            if (process.env.SMTP_USER) {
                sendAutoMail(
                    process.env.SMTP_USER, 
                    "New Document Request Received",
                    "Action Required",
                    `A new <b>${requestMethod}</b> request for <b>${r.type}</b> has been submitted by <b>${r.resident_name}</b>.<br><br>Reference No: <strong>${prettyId}</strong>`
                ).catch(e => console.error("[ADMIN_EMAIL_DISPATCH_ERROR]", e.message));
            }

            res.status(201).json({ success: true, data: finalDoc });
        } catch (err) {
            console.error("[DOCUMENT_SAVE_ERROR] Failed to create document request:", err.message);
            res.status(400).json({ success: false, error: err.message || "Database Rejected Request." });
        }
    });

    // ── 4. PUT: FULL UPDATE (WITH REJECTION REASON) ──
    router.put('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;
            const actor = req.user?.username || 'Staff';

            const payload = { status: r.status, price: r.price, purpose: r.purpose };
            if (r.rejection_reason !== undefined) {
                payload.rejection_reason = r.rejection_reason;
            }

            const { data, error } = await supabase
                .from('document_requests')
                .update(payload)
                .eq('id', id)
                .select().single();

            if (error) throw error;

            logActivity(supabase, actor, 'DOCUMENT_UPDATED', `Doc ID ${id} set to ${r.status}.`);
            
            await createNotification(supabase, data.resident_id, "Document Status Update", `Your request for ${data.type} is now ${r.status}.`, 'document');

            if (['Approved', 'Ready', 'Released', 'Rejected'].includes(r.status)) {
                const { data: resi } = await supabase.from('residents_records').select('email, first_name').eq('record_id', data.resident_id).single();
                if (resi?.email) {
                    let emailMessage = `Your request for <b>${data.type}</b> is now <b>${r.status}</b>.`;
                    
                    if (r.status === 'Rejected' && r.rejection_reason) {
                        emailMessage += `<br><br><b>Reason for rejection:</b><br><i>"${r.rejection_reason}"</i><br><br>Please contact the barangay hall if you have any questions.`;
                    }

                    sendAutoMail(resi.email, `Document Update: ${r.status}`, `Hello, ${resi.first_name}!`, emailMessage)
                    .catch(e => console.error("[RESIDENT_EMAIL_DISPATCH_ERROR]", e.message));
                }
            }

            res.status(200).json(data);
        } catch (err) {
            console.error("[DOCUMENT_UPDATE_ERROR] Failed to modify document data:", err.message);
            res.status(400).json({ error: "Update failed." });
        }
    });

    // ── 5. PATCH: QUICK STATUS UPDATE (WITH PRICE SUPPORT) ──
    router.patch('/documents/:id/status', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            // 🎯 THE FIX: Extract price from req.body
            const { status, rejection_reason, price } = req.body;
            const actor = req.user?.username || 'Staff';

            const payload = { status };
            if (rejection_reason !== undefined) {
                payload.rejection_reason = rejection_reason;
            }
            // 🎯 THE FIX: Add price to the Supabase update payload
            if (price !== undefined) {
                payload.price = price;
            }

            const { data, error } = await supabase
                .from('document_requests')
                .update(payload) 
                .eq('id', req.params.id)
                .select().single();

            if (error) throw error;

            logActivity(supabase, actor, 'STATUS_PATCH', `Doc ID ${req.params.id} -> ${status} (Price: ${price !== undefined ? price : 'unchanged'})`);
            
            await createNotification(supabase, data.resident_id, "Document Alert", `Your ${data.type} is now ${status}.`, 'document');

            const { data: resi } = await supabase.from('residents_records').select('email, first_name').eq('record_id', data.resident_id).single();
            if (resi?.email) {
                let emailMessage = `Your ${data.type} is now: ${status}.`;
                
                if (status === 'Rejected' && rejection_reason) {
                    emailMessage += `<br><br><b>Reason for rejection:</b><br><i>"${rejection_reason}"</i><br><br>Please contact the barangay hall if you have any questions.`;
                }

                sendAutoMail(resi.email, "Status Alert", `Hi ${resi.first_name}`, emailMessage)
                .catch(e => console.error("[RESIDENT_EMAIL_DISPATCH_ERROR]", e.message));
            }

            res.status(200).json(data);
        } catch (err) {
            console.error("[DOCUMENT_STATUS_PATCH_ERROR] Failed to patch status:", err.message);
            res.status(400).json({ error: "Status toggle rejected." });
        }
    });

    // ── 6. DELETE: PURGE ──
    router.delete('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const actor = req.user?.username || 'Admin';
            const { error } = await supabase.from('document_requests').delete().eq('id', req.params.id);
            if (error) throw error;
            
            logActivity(supabase, actor, 'DELETED_DOCUMENT', `Purged Record ID: ${req.params.id}`);
            res.status(200).json({ message: "Record removed." });
        } catch (err) {
            console.error("[DOCUMENT_DELETE_ERROR] Failed to execute database purge:", err.message);
            res.status(500).json({ error: err.message });
        }
    }); 
};