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
// =========================================================
const processNarrativeImages = async (narrative) => {
    let finalNarrative = narrative || "";
    const base64Regex = /(data:[^"'\s]+;base64,[^"'\s]+)/g;
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
        uploadResults.forEach(item => {
            if (item) finalNarrative = finalNarrative.replace(item.oldString, item.newUrl);
        });
    }
    return finalNarrative;
};

// =========================================================
// INTERNAL HELPERS
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

export const BlotterRouter = (router, supabase, authenticateToken) => {
    
    // GET ALL CASES
    router.get(['/blotter', '/blotters'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
        async (req, res) => {
            try {
                const { data: cases } = await supabase.from('blotter_cases').select('*').order('created_at', { ascending: false });
                const { data: requests } = await supabase.from('blotter_requests').select('*').order('created_at', { ascending: false });
                res.json([...(cases || []), ...(requests || []).map(r => ({ ...r, id: r.id || r.request_id, case_number: 'PENDING', status: r.status || 'Pending' }))]);
            } catch (err) { res.status(500).json({ error: "Sync failed." }); }
        }
    );

    // GET CASES BY RESIDENT ID
    router.get(['/blotter/resident/:id', '/blotters/resident/:id'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall', 'resident'])], 
        async (req, res) => {
            try {
                const { id } = req.params;
                const { data: cases } = await supabase.from('blotter_cases').select('*').eq('complainant_id', id).order('created_at', { ascending: false });
                const { data: requests } = await supabase.from('blotter_requests').select('*').eq('resident_id', id);
                res.status(200).json([...(cases || []), ...(requests || []).map(r => ({ ...r, status: r.status || 'Pending' }))]);
            } catch (err) { res.status(500).json({ error: "Fetch failed." }); }
        }
    );

    // POST: CREATE REPORT
    router.post(['/blotter', '/blotters'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'resident', 'barangayhall'])], 
        upload.array('evidence', 5), 
        async (req, res) => {
            try {
                const r = req.body;
                const userRole = req.validatedRole;
                const tokenResidentId = req.user?.record_id || req.user?.resident_id || req.user?.id || req.user?.sub;
                
                const isOnline = userRole === 'resident';
                const secureComplainantId = isOnline ? (tokenResidentId || r.complainant_id) : (r.complainant_id || 'WALK-IN');

                const prefix = isOnline ? 'ON-INC-' : 'WK-INC-';
                const suffix = Date.now().toString().slice(-6); 
                const generatedCaseNumber = r.case_number || `${prefix}${suffix}`;
                const initialStatus = isOnline ? 'Pending' : 'Active';

                let finalNarrative = await processNarrativeImages(r.narrative);

                let uploadedImageLinks = [];
                if (req.files && req.files.length > 0) {
                    const formUploadPromises = req.files.map(async (file) => {
                        try {
                            const result = await cloudinary.uploader.upload(file.path, { folder: 'blotter_evidence' });
                            fs.unlink(file.path).catch(e => console.warn("[CLEANUP WARNING]", e.message));
                            return result.secure_url;
                        } catch (uploadErr) {
                            return null; 
                        }
                    });

                    const formResults = await Promise.all(formUploadPromises);
                    uploadedImageLinks = formResults.filter(url => url !== null);
                    if (uploadedImageLinks.length > 0) {
                        finalNarrative += ` ${uploadedImageLinks.map(url => `[ATTACHED EVIDENCE] ${url}`).join(' ')}`;
                    }
                }

                const dbPayload = {
                    case_number: generatedCaseNumber,
                    complainant_name: r.complainant_name,
                    complainant_id: secureComplainantId,
                    respondent: r.respondent,
                    incident_type: r.incident_type,
                    narrative: finalNarrative, 
                    date_filed: r.date_filed || new Date().toISOString().split('T')[0],
                    time_filed: r.time_filed || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                    status: initialStatus 
                };

                const { data, error } = await supabase.from('blotter_cases').insert([dbPayload]).select().single();
                if (error) throw error;

                res.status(201).json({ success: true, data });

                logActivity(supabase, req.user.username || 'System', 'INCIDENT_REPORTED', `Case ${dbPayload.case_number} filed.`).catch(() => {});
                if (isOnline) createNotification(supabase, secureComplainantId, "Report Received", `Under review.`, 'blotter').catch(() => {});
                notifyAllAdmins(supabase, "New Incident", `Case ${dbPayload.case_number} filed.`, 'blotter').catch(() => {});
                
                if (process.env.SMTP_USER) {
                    sendAutoMail(process.env.SMTP_USER, "New Incident Report", "Attention Required", `New report filed.<br>Case No: <strong>${dbPayload.case_number}</strong>`).catch(() => {});
                }

            } catch (err) {
                console.error("[BLOTTER POST ERROR]:", err);
                res.status(400).json({ error: err.message || "Failed to process request." });
            }
        }
    );

    // PUT: UPDATE RECORD OR MIGRATE ONLINE TO ACTIVE
    router.put(['/blotter/:id', '/blotters/:id'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
        async (req, res) => {
            try {
                const r = req.body;
                const { id } = req.params;

                if (r.narrative) r.narrative = await processNarrativeImages(r.narrative);

                // 1. Try to update an existing active case first.
                const { data: caseData, error: caseErr } = await supabase.from('blotter_cases')
                    .update(r).eq('id', id).select().maybeSingle();

                if (caseData) return res.json({ success: true, data: caseData });

                // 2. If it wasn't an active case, it might be a pending request being activated
                if (r.status === 'Active' || r.status === 'Hearing') {
                    const { data: reqData } = await supabase.from('blotter_requests').select('*').eq('id', id).maybeSingle();
                    
                    if (reqData) {
                        const newCasePayload = {
                            case_number: reqData.case_number || `ON-INC-${Date.now().toString().slice(-6)}`,
                            complainant_name: reqData.complainant_name,
                            complainant_id: reqData.resident_id,
                            respondent: reqData.respondent,
                            incident_type: reqData.incident_type,
                            narrative: reqData.narrative,
                            date_filed: reqData.created_at,
                            status: r.status,
                            hearing_date: r.hearing_date || null,
                            hearing_time: r.hearing_time || null
                        };
                        
                        const { data: migratedCase, error: insertErr } = await supabase.from('blotter_cases').insert([newCasePayload]).select().single();
                        if (insertErr) throw insertErr;

                        // Purge from requests now that it is a full case
                        await supabase.from('blotter_requests').delete().eq('id', id);
                        createNotification(supabase, reqData.resident_id, "Report Accepted", "Your incident report is now active.", 'blotter').catch(() => {});
                        
                        return res.json({ success: true, data: migratedCase });
                    }
                }

                return res.status(404).json({ error: "Record not found in registry." });
            } catch (err) { 
                console.error("[BLOTTER PUT ERROR]:", err);
                res.status(500).json({ error: "Update failed.", details: err.message }); 
            }
        }
    );

    // PATCH: UPDATE STATUS (Hearings, Settlements)
    router.patch(['/blotter/:id/status', '/blotters/:id/status'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
        async (req, res) => {
            try {
                const { status, hearing_date, hearing_time, rejection_reason } = req.body;
                const { id } = req.params;

                const { data: caseData } = await supabase.from('blotter_cases')
                    .update({ status, hearing_date, hearing_time, rejection_reason }).eq('id', id).select().maybeSingle();
                
                if (caseData) {
                    if (caseData.complainant_id && caseData.complainant_id !== 'WALK-IN') {
                        createNotification(supabase, caseData.complainant_id, "Status update", `Case #${caseData.case_number} is now ${status}.`, 'blotter').catch(() => {}); 
                    }
                    return res.json({ success: true, data: caseData });
                }

                return res.status(404).json({ error: "Record not found to patch." });
            } catch (err) { res.status(500).json({ error: "Patch failed." }); }
        }
    );

    // DELETE: Quick Archive / Purge
    router.delete(['/blotter/:id', '/blotters/:id'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
        async (req, res) => {
            try {
                await supabase.from('blotter_cases').delete().eq('id', req.params.id);
                res.json({ success: true, message: "Deleted." });
            } catch (err) { res.status(500).json({ error: "Deletion failed." }); }
        }
    );
};