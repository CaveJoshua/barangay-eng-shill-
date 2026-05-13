import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';

// =========================================================
// 🛡️ INTERNAL HELPERS & PRICE ENGINE
// =========================================================

/**
 * THE PRICE LOGIC ENGINE (FIXED):
 * ──────────────────────────────────────────────────────────────────────────
 * Rule (per spec):
 *   • "To be assessed"  →  ONLY when status === 'Pending' AND price is 0.
 *   • Every other case  →  show the actual ₱ amount, including ₱0.00.
 *
 * This means:
 *   - Indigency (price = 0) once Approved/Ready/Completed → "₱0.00"
 *   - A Rejected / Cancelled request with no fee yet      → "₱0.00"
 *   - A still-Pending request with price = 0              → "To be assessed"
 *   - A still-Pending request that already has a fee set  → show that fee
 * ──────────────────────────────────────────────────────────────────────────
 */
const formatPriceDisplay = (status, price) => {
    const currentStatus = (status || 'pending').toLowerCase().trim();
    const numPrice = Number(price || 0);

    // 🎯 The ONLY case that shows the pending-state string.
    if (currentStatus === 'pending' && numPrice === 0) {
        return "To be assessed";
    }

    // 💰 All other cases — including ₱0.00 for free certificates
    //    once they leave the Pending state — show the peso amount.
    return `₱${numPrice.toFixed(2)}`;
};

const createNotification = async (supabase, userId, title, message, type = 'document') => {
    if (!userId) return; 
    try {
        await supabase.from('notifications').insert([{
            user_id: String(userId), title, message, type, is_read: false, created_at: new Date().toISOString()
        }]);
    } catch (err) { console.error("[NOTIF_ERR]", err.message); }
};

const notifyAllAdmins = async (supabase, title, message, type = 'document') => {
    try {
        const { data: officials } = await supabase.from('officials_accounts').select('account_id, role');
        const validRoles = ['admin', 'superadmin', 'staff', 'barangayhall'];
        const targetAdmins = (officials || []).filter(off => off.role && validRoles.includes(off.role.toLowerCase().trim()));
        if (targetAdmins.length > 0) {
            const bulkNotifs = targetAdmins.map(admin => ({
                user_id: String(admin.account_id), title, message, type, is_read: false, created_at: new Date().toISOString()
            }));
            await supabase.from('notifications').insert(bulkNotifs);
        }
    } catch (err) { console.error("[ADMIN_NOTIF_ERR]:", err.message); }
};

const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ error: 'Forbidden', message: 'Security Policy: Insufficient permissions.' });
        }
        req.validatedRole = userRole;
        next();
    };
};

// =========================================================
// 🚀 MAIN ROUTER EXPORT
// =========================================================
export const documentRouter = (router, supabase, authenticateToken) => {

    // ── 1. GET CONFIG: DOCUMENT TYPES ──
    router.get('/documents/types', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident', 'barangayhall']), async (req, res) => {
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

    // ── 2. GET REGISTRY: FETCH ALL DOCUMENTS (ADMIN VIEW) ──
    router.get('/documents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident', 'barangayhall']), async (req, res) => {
        try {
            let query = supabase.from('document_requests').select('*');
            
            if (req.validatedRole === 'resident') {
                const residentId = req.user?.record_id || req.user?.resident_id || req.user?.sub; 
                query = query.eq('resident_id', residentId);
            }

            const { data: docs, error: docError } = await query.order('date_requested', { ascending: false });
            if (docError) throw docError;

            const { data: residents } = await supabase.from('residents_records').select('record_id, first_name, last_name, email');

            const formattedData = (docs || []).map(doc => {
                const resident = residents?.find(r => r.record_id === doc.resident_id);
                return {
                    ...doc,
                    residentName: resident ? `${resident.last_name}, ${resident.first_name}` : (doc.resident_name || 'Unknown'),
                    residentEmail: resident?.email || null,
                    price_display: formatPriceDisplay(doc.status, doc.price)
                };
            });
            
            res.status(200).json(formattedData);
        } catch (err) {
            res.status(500).json({ error: "Registry Sync Error." });
        }
    });

    // ── 2.5 GET RESIDENT HISTORY (PORTAL VIEW) ──
    router.get('/documents/resident/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident', 'barangayhall']), async (req, res) => {
        try {
            const { id } = req.params;
            const { data, error } = await supabase.from('document_requests').select('*').eq('resident_id', id).order('date_requested', { ascending: false });

            if (error) throw error;
            const mappedData = (data || []).map(doc => ({
                ...doc,
                price_display: formatPriceDisplay(doc.status, doc.price)
            }));
            res.status(200).json(mappedData);
        } catch (err) {
            res.status(500).json({ error: "Failed to retrieve document history." });
        }
    });

    // ── 3. POST: SAVE REQUEST (THE ID FACTORY + RATE LIMITER) ──
    router.post('/documents/save', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident', 'barangayhall']), async (req, res) => {
        try {
            const r = req.body;
            const actor = req.user?.username || req.user?.sub || 'Resident';
            const userRole = req.validatedRole;

            const requestMethod = userRole === 'resident' ? 'Online' : 'Walk-in';
            const prefix = userRole === 'resident' ? 'ON-LN' : 'WK-IN';

            const secureResidentId = (userRole === 'resident') 
                ? (req.user?.record_id || req.user?.resident_id || req.user?.sub) 
                : r.resident_id;

            if (!secureResidentId) return res.status(403).json({ success: false, error: "Identity verification failed." });

            // 🛡️ RATE LIMITER: 2 requests per day
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const { count, error: countError } = await supabase.from('document_requests').select('*', { count: 'exact', head: true }).eq('resident_id', secureResidentId).gte('date_requested', today.toISOString());

            if (countError) throw countError;
            if (count >= 2) return res.status(429).json({ success: false, error: "Daily limit reached. (Max 2 requests/day)" });

            // ID FACTORY: Step 1 (Temp ID)
            const tempRef = `TEMP-${Date.now()}`;
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

            // ID FACTORY: Step 2 (Pretty Ref Number)
            const prettyId = `${prefix}-${String(initialDoc.id).padStart(4, '0')}`;
            const { data: finalDoc, error: updateError } = await supabase.from('document_requests').update({ reference_no: prettyId }).eq('id', initialDoc.id).select().single();

            if (updateError) throw updateError;

            const responseWithPrice = { 
                ...finalDoc, 
                price_display: formatPriceDisplay(finalDoc.status, finalDoc.price) 
            };

            logActivity(supabase, actor, 'DOCUMENT_REQUEST_CREATED', `Ref: ${prettyId}`);
            if (userRole === 'resident') {
                createNotification(supabase, secureResidentId, "Request Received", `Your request for ${r.type} is pending review.`);
            }
            notifyAllAdmins(supabase, "New Document Request", `${r.resident_name} requested a ${r.type}. Ref: ${prettyId}`);

            res.status(201).json({ success: true, data: responseWithPrice });
        } catch (err) {
            console.error("[DOC_SAVE_ERR]", err.message);
            res.status(400).json({ success: false, error: "Database Rejected Request." });
        }
    });

    // ── 4. PUT: FULL UPDATE (ADMIN APPROVAL SYNC) ──
    router.put('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'barangayhall']), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;
            const actor = req.user?.username || 'Staff';

            const { data, error } = await supabase.from('document_requests').update(r).eq('id', id).select().single();
            if (error) throw error;

            logActivity(supabase, actor, 'DOCUMENT_UPDATED', `Doc ID ${id} set to ${r.status}.`);
            createNotification(supabase, data.resident_id, "Document Update", `Your ${data.type} is now ${data.status}.`);

            // Email automation for finalized documents
            if (['Approved', 'Ready', 'Released', 'Rejected'].includes(r.status)) {
                const { data: resi } = await supabase.from('residents_records').select('email, first_name').eq('record_id', data.resident_id).maybeSingle();
                if (resi?.email) {
                    sendAutoMail(resi.email, `Document Update: ${r.status}`, `Hello ${resi.first_name}`, `Your ${data.type} status is now ${r.status}.`);
                }
            }

            res.status(200).json({ 
                ...data, 
                price_display: formatPriceDisplay(data.status, data.price) 
            });
        } catch (err) {
            res.status(400).json({ error: "Update failed." });
        }
    });

    // ── 5. PATCH: QUICK STATUS UPDATE ──
    router.patch('/documents/:id/status', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'barangayhall']), async (req, res) => {
        try {
            const { data, error } = await supabase.from('document_requests').update(req.body).eq('id', req.params.id).select().single();
            if (error) throw error;

            res.status(200).json({ 
                ...data, 
                price_display: formatPriceDisplay(data.status, data.price) 
            });
        } catch (err) {
            res.status(400).json({ error: "Patch failed." });
        }
    });

    // ── 6. DELETE: PURGE RECORD ──
    router.delete('/documents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'barangayhall']), async (req, res) => {
        try {
            await supabase.from('document_requests').delete().eq('id', req.params.id);
            res.status(200).json({ success: true, message: "Record removed." });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }); 
};