import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import os from 'os';
import { promises as fs } from 'fs';

// =========================================================
// 📁 CLOUDINARY CONFIGURATION
// =========================================================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// =========================================================
// ⚡ SURGICAL MULTER CONFIG: Disk Storage
// =========================================================
const upload = multer({ 
    dest: os.tmpdir(), 
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// =========================================================
// 🛡️ IMAGE PROCESSOR ENGINE
// Scans narrative for Base64 strings, uploads them to Cloudinary, 
// and replaces the massive text with short, secure URLs.
// =========================================================
const processNarrativeImages = async (narrative) => {
    let finalNarrative = narrative || "";
    // Matches data:image/...;base64,... 
    const base64Regex = /(data:image\/[^;]+;base64,[^\s]+)/g;
    const matchedBase64 = finalNarrative.match(base64Regex) || [];

    if (matchedBase64.length > 0) {
        const uploadPromises = matchedBase64.map(async (base64Str) => {
            try {
                const result = await cloudinary.uploader.upload(base64Str, { folder: 'blotter_evidence' });
                return { oldString: base64Str, newUrl: result.secure_url };
            } catch (uploadErr) {
                console.error("[CLOUDINARY ERROR]", uploadErr.message);
                return null;
            }
        });

        const uploadResults = await Promise.all(uploadPromises);
        
        // Swap out the massive strings for clean URLs
        uploadResults.forEach(item => {
            if (item) {
                finalNarrative = finalNarrative.replace(item.oldString, item.newUrl);
            }
        });
    }
    return finalNarrative;
};

// =========================================================
// INTERNAL HELPERS (Notifications & RBAC)
// =========================================================
const createNotification = async (supabase, userId, title, message, type = 'blotter') => {
    if (!userId || userId === 'WALK-IN') return; 
    try {
        await supabase.from('notifications').insert([{
            user_id: String(userId), title, message, type, is_read: false, created_at: new Date().toISOString()
        }]);
    } catch (err) { console.error("[NOTIF_ERROR]", err.message); }
};

const notifyAllAdmins = async (supabase, title, message, type = 'blotter') => {
    try {
        const { data: officials } = await supabase.from('officials_accounts').select('account_id, role');
        const validRoles = ['admin', 'superadmin', 'staff'];
        const targetAdmins = (officials || []).filter(off => off.role && validRoles.includes(off.role.toLowerCase().trim()));
        if (targetAdmins.length > 0) {
            const bulkNotifs = targetAdmins.map(admin => ({
                user_id: String(admin.account_id), title, message, type, is_read: false, created_at: new Date().toISOString()
            }));
            await supabase.from('notifications').insert(bulkNotifs);
        }
    } catch (err) { console.error("[ADMIN_NOTIF_ERROR]:", err.message); }
};

const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
        if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ error: 'Forbidden', message: 'Insufficient Permissions.' });
        }
        req.validatedRole = userRole.toLowerCase().trim();
        next();
    };
};

export const BlotterRouter = (router, supabase, authenticateToken) => {
    
    // ── 1. GET ALL (Admin) ──
    router.get('/blotter', authenticateToken, checkRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { data: cases } = await supabase.from('blotter_cases').select('*').order('created_at', { ascending: false });
            const { data: requests } = await supabase.from('blotter_requests').select('*').order('created_at', { ascending: false });
            res.json([...(cases || []), ...(requests || []).map(r => ({ ...r, id: r.id || r.request_id, case_number: 'PENDING', status: r.status || 'Pending' }))]);
        } catch (err) { res.status(500).json({ error: "Sync failed." }); }
    });

    // ── 2. GET RESIDENT HISTORY ──
    router.get('/blotter/resident/:id', authenticateToken, checkRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { id } = req.params;
            const { data: cases } = await supabase.from('blotter_cases').select('*').eq('complainant_id', id).order('created_at', { ascending: false });
            const { data: requests } = await supabase.from('blotter_requests').select('*').eq('resident_id', id);
            res.status(200).json([...(cases || []), ...(requests || []).map(r => ({ ...r, status: r.status || 'Pending' }))]);
        } catch (err) { res.status(500).json({ error: "Fetch failed." }); }
    });

    // ── 3. POST: CREATE REPORT ──
    router.post('/blotter', authenticateToken, checkRole(['admin', 'superadmin', 'staff', 'resident']), upload.array('evidence', 5), async (req, res) => {
        try {
            const r = req.body;
            const userRole = req.validatedRole;
            const tokenResidentId = req.user?.record_id || req.user?.resident_id || req.user?.id || req.user?.sub;
            const secureComplainantId = (userRole === 'resident') ? (tokenResidentId || r.complainant_id) : (r.complainant_id || 'WALK-IN');

            // ⚡ 1. Process Base64 images from frontend payload
            let finalNarrative = await processNarrativeImages(r.narrative);

            // ⚡ 1.5. Fallback: Handle traditional form-data uploads just in case
            let uploadedImageLinks = [];
            if (req.files && req.files.length > 0) {
                const formUploadPromises = req.files.map(async (file) => {
                    try {
                        const result = await cloudinary.uploader.upload(file.path, { folder: 'blotter_evidence' });
                        fs.unlink(file.path).catch(e => console.warn("[CLEANUP WARNING]", e.message));
                        return result.secure_url;
                    } catch (uploadErr) {
                        console.error("[CLOUDINARY ERROR]", uploadErr.message);
                        return null; 
                    }
                });

                const formResults = await Promise.all(formUploadPromises);
                uploadedImageLinks = formResults.filter(url => url !== null);
                
                if (uploadedImageLinks.length > 0) {
                    const formattedUrls = uploadedImageLinks.map(url => `[ATTACHED EVIDENCE] ${url}`).join(' ');
                    finalNarrative += ` ${formattedUrls}`;
                }
            }

            // ⚡ 2. DATABASE COMMIT
            const dbPayload = {
                case_number: r.case_number || `INC-${Date.now()}`,
                complainant_name: r.complainant_name,
                complainant_id: secureComplainantId,
                respondent: r.respondent,
                incident_type: r.incident_type,
                narrative: finalNarrative, 
                date_filed: r.date_filed || new Date().toISOString().split('T')[0],
                time_filed: r.time_filed || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                status: 'Pending'
            };

            const { data, error } = await supabase.from('blotter_cases').insert([dbPayload]).select().single();
            if (error) throw error;

            res.status(201).json({ success: true, data });

            // Background Tasks
            logActivity(supabase, req.user.username || 'System', 'INCIDENT_REPORTED', `Case ${dbPayload.case_number} filed.`).catch(() => {});
            if (userRole === 'resident') {
                createNotification(supabase, secureComplainantId, "Report Received", `Under review.`, 'blotter').catch(() => {});
            }
            notifyAllAdmins(supabase, "New Incident", `Case ${dbPayload.case_number} filed.`, 'blotter').catch(() => {});
            if (process.env.SMTP_USER) {
                sendAutoMail(
                    process.env.SMTP_USER, 
                    "New Incident Report", 
                    "Attention Required", 
                    `New report filed.<br>Case No: <strong>${dbPayload.case_number}</strong>`
                ).catch(e => console.error("[BACKGROUND_MAIL_ERROR]", e.message));
            }

        } catch (err) {
            console.error("[BLOTTER POST ERROR]:", err);
            res.status(400).json({ error: err.message || "Failed to process request." });
        }
    });

    // ── 4. PUT: UPDATE REPORT (THE FIX FOR YOUR 500 ERROR) ──
    router.put('/blotter/:id', authenticateToken, checkRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const r = req.body;

            // 🚨 Crucial Fix: Process any NEW Base64 images added during an edit before saving!
            if (r.narrative) {
                r.narrative = await processNarrativeImages(r.narrative);
            }

            const { data, error } = await supabase.from('blotter_cases').update(r).eq('id', req.params.id).select().single();
            if (error) throw error;
            
            res.json({ success: true, data });
        } catch (err) { 
            console.error("[BLOTTER PUT ERROR]:", err);
            res.status(500).json({ error: "Update failed.", details: err.message }); 
        }
    });

    // ── 5, 6. PATCH, DELETE ──
    router.patch('/blotter/:id/status', authenticateToken, checkRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { status, hearing_date, hearing_time, rejection_reason } = req.body;
            const { data } = await supabase.from('blotter_cases').update({ status, hearing_date, hearing_time, rejection_reason }).eq('id', req.params.id).select().single();
            if (data.complainant_id && data.complainant_id !== 'WALK-IN') {
                let msg = `Case #${data.case_number} is now ${status}.`;
                createNotification(supabase, data.complainant_id, "Status update", msg, 'blotter').catch(() => {}); 
            }
            res.json({ success: true, data });
        } catch (err) { res.status(500).json({ error: "Patch failed." }); }
    });

    router.delete('/blotter/:id', authenticateToken, checkRole(['admin', 'superadmin']), async (req, res) => {
        try {
            await supabase.from('blotter_cases').delete().eq('id', req.params.id);
            res.json({ success: true, message: "Deleted." });
        } catch (err) { res.status(500).json({ error: "Deletion failed." }); }
    });
};