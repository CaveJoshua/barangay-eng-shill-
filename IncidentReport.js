
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

// 🛡️ SUBMISSION RATE LIMIT — enforced per resident at filing time via a DB count
// of today's blotter_cases (see the POST handler). This replaces the previous
// in-memory limiter so the cap survives restarts and only counts real filings.

// =========================================================
// ⚡ SURGICAL MULTER CONFIG: Disk Storage
// =========================================================
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 🚧 RAIL: 10MB hard cap per file (images + video)
    fileFilter: (req, file, cb) => {
        if (file.fieldname === 'video') {
            return file.mimetype.startsWith('video/')
                ? cb(null, true)
                : cb(new Error('Only video files are allowed (mp4, webm, mov).'));
        }
        if (file.fieldname === 'evidence') {
            return file.mimetype.startsWith('image/')
                ? cb(null, true)
                : cb(new Error('Only image files are allowed as evidence.'));
        }
        cb(null, true);
    }
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
// 🖋️ EVIDENCE STAMP + CHAIN-OF-CUSTODY HELPERS
// Every uploaded photo/video is tagged with an immutable Cloudinary "context"
// stamp (who / when / where / which-case) so each asset is independently
// auditable from the media store itself. Photos ALSO receive a visible
// date + case-number watermark via a lazy delivery transform — the transform
// is only resolved on fetch, so a malformed overlay can never block the upload
// or destroy the underlying evidence.
// =========================================================

// Cloudinary context values may not contain '=' or '|' (the pair delimiters).
const cleanCtx = (v) => String(v ?? '').replace(/[=|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 240);

const buildEvidenceContext = (meta) => ({
    case_number:      cleanCtx(meta.caseNumber),
    complainant_id:   cleanCtx(meta.complainantId),
    complainant_name: cleanCtx(meta.complainantName),
    uploaded_by:      cleanCtx(meta.actor),
    captured_at:      cleanCtx(meta.capturedAt),
    uploaded_at:      cleanCtx(new Date().toISOString()),
    source_ip:        cleanCtx(meta.ip),
    user_agent:       cleanCtx(meta.userAgent),
});

// Builds a visible, baked-in evidence watermark URL. Returns the pristine
// secure_url as a fallback if the transform URL cannot be constructed.
const buildStampedImageUrl = (publicId, format, stampText, fallbackUrl) => {
    try {
        return cloudinary.url(publicId, {
            secure: true,
            format: format || undefined,
            transformation: [
                { width: 1600, crop: 'limit', quality: 'auto' },
                {
                    overlay: { font_family: 'Arial', font_size: 32, font_weight: 'bold', text: stampText },
                    color: 'white', background: 'rgb:000000B3',
                    gravity: 'south_east', x: 20, y: 20,
                },
            ],
        }) || fallbackUrl;
    } catch (e) {
        console.warn('[EVIDENCE STAMP] URL build failed, using pristine asset:', e.message);
        return fallbackUrl;
    }
};

// Renders a short, ASCII-safe stamp caption: "<case>  -  YYYY-MM-DD HH:MM UTC".
const buildStampCaption = (caseNumber, capturedAt) => {
    const d = capturedAt && !isNaN(Date.parse(capturedAt)) ? new Date(capturedAt) : new Date();
    const ts = d.toISOString().replace('T', ' ').slice(0, 16); // YYYY-MM-DD HH:MM
    return `${caseNumber}  -  ${ts} UTC`;
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

const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
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

    // GET CASES BY RESIDENT ID (IDOR: residents restricted to own records)
    router.get(['/blotter/resident/:id', '/blotters/resident/:id'],
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall', 'resident'])],
        async (req, res) => {
            try {
                const { id } = req.params;
                const userRole = req.validatedRole;

                if (userRole === 'resident') {
                    const ownId = String(req.user?.record_id || req.user?.resident_id || req.user?.sub);
                    if (ownId !== String(id)) {
                        return res.status(403).json({ error: 'Forbidden. You can only view your own incident reports.' });
                    }
                }

                const { data: cases } = await supabase.from('blotter_cases').select('*').eq('complainant_id', id).order('created_at', { ascending: false });
                const { data: requests } = await supabase.from('blotter_requests').select('*').eq('resident_id', id);
                res.status(200).json([...(cases || []), ...(requests || []).map(r => ({ ...r, status: r.status || 'Pending' }))]);
            } catch (err) { res.status(500).json({ error: "Fetch failed." }); }
        }
    );

    // POST: CREATE REPORT
    router.post(['/blotter', '/blotters'], 
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'resident', 'barangayhall'])], 
        async (req, res) => {
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const clientUserAgent = req.headers['user-agent'] || 'unknown';
            let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
            if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
            
            const isResident = String(userRole).toLowerCase().trim() === 'resident';

            // 🛡️ DAILY LIMIT — at most 2 online filings per resident per day.
            // DB-backed (counts rows in blotter_cases) so it: (a) survives server
            // restarts / runs correctly across multiple instances, and (b) counts only
            // SUCCESSFUL filings — a failed/aborted attempt no longer burns the quota
            // the way the old in-memory consume() did. We count by the server-set
            // `created_at` (NOT the client-supplied `date_filed`, which is spoofable).
            if (isResident) {
                const tokenResidentId = req.user?.record_id || req.user?.resident_id || req.user?.id || req.user?.sub;
                const startOfToday = new Date();
                startOfToday.setHours(0, 0, 0, 0);
                try {
                    const { count, error: limitErr } = await supabase
                        .from('blotter_cases')
                        .select('*', { count: 'exact', head: true })
                        .eq('complainant_id', tokenResidentId)
                        .gte('created_at', startOfToday.toISOString());
                    if (limitErr) throw limitErr;
                    if ((count || 0) >= 2) {
                        return res.status(429).json({
                            error: 'Too Many Requests',
                            message: 'Submission throttled. You have reached the limit of 2 filings per day. Please try again tomorrow.'
                        });
                    }
                } catch (limitCheckErr) {
                    // Fail-open on a transient DB error so a legitimate report is never
                    // wrongly blocked; the insert below is still authenticated + audited.
                    console.error('[BLOTTER LIMIT] daily-count check failed:', limitCheckErr.message);
                }
            }

            // 🛡️ MANUAL MULTER HANDLER — up to 5 evidence images + 1 video
            const multiUpload = upload.fields([
                { name: 'evidence', maxCount: 5 },
                { name: 'video', maxCount: 1 },
            ]);

            multiUpload(req, res, async (err) => {
                if (err) {
                    if (err.message === 'Request aborted' || err.code === 'ECONNRESET') {
                        console.warn('⚠️ [BLOTTER] Resident cancelled upload or navigated away.');
                        return res.status(204).end(); 
                    }
                    return res.status(400).json({ error: "Upload failed.", details: err.message });
                }

                try {
                    const r = req.body;
                    const validatedRole = req.validatedRole;
                    const tokenResidentId = req.user?.record_id || req.user?.resident_id || req.user?.id || req.user?.sub;
                    
                    const isOnline = validatedRole === 'resident';
                    const secureComplainantId = isOnline ? (tokenResidentId || r.complainant_id) : (r.complainant_id || 'WALK-IN');

                    const prefix = isOnline ? 'ON-INC-' : 'WK-INC-';
                    const suffix = Date.now().toString().slice(-6); 
                    const generatedCaseNumber = r.case_number || `${prefix}${suffix}`;
                    const initialStatus = isOnline ? 'Pending' : 'Active';

                    let finalNarrative = await processNarrativeImages(r.narrative);

                    // 🖋️ Chain-of-custody stamp shared by every asset on this report.
                    const actor = req.user?.username || r.complainant_name || 'Resident';
                    const evidenceContext = buildEvidenceContext({
                        caseNumber:       generatedCaseNumber,
                        complainantId:    secureComplainantId,
                        complainantName:  r.complainant_name,
                        actor,
                        capturedAt:       r.client_captured_at,
                        ip:               clientIp,
                        userAgent:        clientUserAgent,
                    });
                    const evidenceTags = ['blotter_evidence', String(generatedCaseNumber), String(secureComplainantId)];
                    const stampCaption = buildStampCaption(generatedCaseNumber, r.client_captured_at);

                    // 🖼️ EVIDENCE IMAGES (up to 5) — stamped + audited
                    const evidenceFiles = req.files?.evidence || [];
                    let uploadedImageLinks = [];
                    let uploadedImageMeta = [];
                    if (evidenceFiles.length > 0) {
                        const formUploadPromises = evidenceFiles.map(async (file) => {
                            try {
                                const result = await cloudinary.uploader.upload(file.path, {
                                    folder: 'blotter_evidence',
                                    context: evidenceContext,   // 🖋️ immutable per-asset stamp
                                    tags: evidenceTags,
                                });
                                fs.unlink(file.path).catch(e => console.warn("[CLEANUP WARNING]", e.message));
                                // Visible date + case-number watermark (lazy, never breaks the upload).
                                const displayUrl = buildStampedImageUrl(result.public_id, result.format, stampCaption, result.secure_url);
                                return { display_url: displayUrl, public_id: result.public_id, bytes: result.bytes || 0 };
                            } catch (uploadErr) {
                                console.error('[EVIDENCE IMAGE UPLOAD ERROR]', uploadErr.message);
                                return null;
                            }
                        });

                        uploadedImageMeta = (await Promise.all(formUploadPromises)).filter(Boolean);
                        uploadedImageLinks = uploadedImageMeta.map(m => m.display_url);
                        if (uploadedImageLinks.length > 0) {
                            finalNarrative += ` ${uploadedImageLinks.map(url => `[ATTACHED EVIDENCE] ${url}`).join(' ')}`;
                        }
                    }

                    // 🎥 SINGLE VIDEO (≤10MB, video-only) — stamped + audited
                    const videoFile = req.files?.video?.[0];
                    let uploadedVideoMeta = null;
                    if (videoFile) {
                        try {
                            const vid = await cloudinary.uploader.upload(videoFile.path, {
                                folder: 'blotter_videos',
                                resource_type: 'video',
                                context: evidenceContext,       // 🖋️ immutable per-asset stamp
                                tags: ['blotter_video', String(generatedCaseNumber), String(secureComplainantId)],
                            });
                            fs.unlink(videoFile.path).catch(() => {});
                            if (vid?.secure_url) {
                                finalNarrative += ` [ATTACHED VIDEO] ${vid.secure_url}`;
                                uploadedVideoMeta = { public_id: vid.public_id, bytes: vid.bytes || 0 };
                            }
                        } catch (vErr) {
                            console.error('[VIDEO UPLOAD ERROR]', vErr.message);
                            fs.unlink(videoFile.path).catch(() => {});
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

                    logActivity(supabase, actor, 'INCIDENT_REPORTED', `Case ${dbPayload.case_number} filed.`, req).catch(() => {});

                    // 🖋️ Dedicated evidence audit trail — captures actor + IP + device (via req),
                    // counts, total bytes, and the Cloudinary public_ids so each uploaded asset
                    // is independently traceable back to this filing.
                    if (uploadedImageMeta.length > 0) {
                        const totalBytes = uploadedImageMeta.reduce((sum, m) => sum + (m.bytes || 0), 0);
                        const ids = uploadedImageMeta.map(m => m.public_id).join(', ');
                        logActivity(
                            supabase, actor, 'EVIDENCE_IMAGE_UPLOADED',
                            `${uploadedImageMeta.length} photo(s) stamped & stored for Case ${dbPayload.case_number} (${totalBytes} bytes) [${ids}]`,
                            req,
                        ).catch(() => {});
                    }
                    if (uploadedVideoMeta) {
                        logActivity(
                            supabase, actor, 'EVIDENCE_VIDEO_UPLOADED',
                            `Video stamped & stored for Case ${dbPayload.case_number} (${uploadedVideoMeta.bytes} bytes) [${uploadedVideoMeta.public_id}]`,
                            req,
                        ).catch(() => {});
                    }

                    if (isOnline) createNotification(supabase, secureComplainantId, "Report Received", `Under review.`, 'blotter').catch(() => {});
                    notifyAllAdmins(supabase, "New Incident", `Case ${dbPayload.case_number} filed.`, 'blotter').catch(() => {});
                    
                    if (process.env.SMTP_USER) {
                        sendAutoMail(process.env.SMTP_USER, "New Incident Report", "Attention Required", `New report filed.<br>Case No: <strong>${dbPayload.case_number}</strong>`).catch(() => {});
                    }

                } catch (err) {
                    console.error("[BLOTTER POST ERROR]:", err);
                    if (req.files) {
                        Object.values(req.files).flat().forEach(file => fs.unlink(file.path).catch(() => {}));
                    }
                    res.status(400).json({ error: err.message || "Failed to process request." });
                }
            });
        }
    );

    // PUT: UPDATE RECORD OR MIGRATE ONLINE TO ACTIVE
    router.put(['/blotter/:id', '/blotters/:id'],
        [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])],
        async (req, res) => {
            try {
                const r = req.body;
                const { id } = req.params;

                const processedNarrative = r.narrative ? await processNarrativeImages(r.narrative) : undefined;

                const allowed = {};
                if (r.complainant_name  !== undefined) allowed.complainant_name  = r.complainant_name;
                if (r.respondent        !== undefined) allowed.respondent        = r.respondent;
                if (r.incident_type     !== undefined) allowed.incident_type     = r.incident_type;
                if (processedNarrative  !== undefined) allowed.narrative         = processedNarrative;
                if (r.date_filed        !== undefined) allowed.date_filed        = r.date_filed;
                if (r.time_filed        !== undefined) allowed.time_filed        = r.time_filed;
                if (r.status            !== undefined) allowed.status            = r.status;
                if (r.hearing_date      !== undefined) allowed.hearing_date      = r.hearing_date;
                if (r.hearing_time      !== undefined) allowed.hearing_time      = r.hearing_time;
                if (r.rejection_reason  !== undefined) allowed.rejection_reason  = r.rejection_reason;
                if (r.resolution        !== undefined) allowed.resolution        = r.resolution;

                const { data: caseData } = await supabase.from('blotter_cases')
                    .update(allowed).eq('id', id).select().maybeSingle();

                if (caseData) return res.json({ success: true, data: caseData });

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

    // PATCH: UPDATE STATUS
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


