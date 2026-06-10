import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import https from 'https';
import helmet from 'helmet';
import jwt from 'jsonwebtoken'; 

import { uploadImage } from './cloud.js';

// Modular Imports
import { documentRouter } from './Document.js';
import { AuditlogRouter, logActivity } from './Auditlog.js'; 
import { RbacRouter } from './Rbac.js'; 
import { AccountManagementRouter } from './Account_Management.js';
import { ResidentsRecordRouter } from './ResidentsRecord.js'; 
import { OfficialsRouter } from './Officials.js'; 
import { HouseholdRouter } from './Household.js';
import { OfficialsLoginRouter } from './OfficialsLogin.js';
import { BlotterRouter } from './IncidentReport.js'; 
import { ProfileRouter } from './Profile.js';
import { ResidentsLoginRouter } from './ResidentLogin.js';
import { NotificationRouter } from './Notification.js'; 
import { CaptchaRouter } from './src/components/Captcha/captcha.js';
// 🛡️ SECURITY REGULATOR IMPORT
import { createSecurityRegulator } from './src/components/Captcha/Regulator.js';

dotenv.config();

const router = express.Router();

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('[FATAL] SUPABASE_JWT_SECRET is not set.');

/**
 * ==========================================
 * SSL & SUPABASE CLIENT INITIALIZATION
 * ==========================================
 */
const certPath = path.resolve(process.cwd(), process.env.DB_SSL_CERT_PATH || './prod-ca-2021 (1).crt');
let sslCert;
try {
  sslCert = fs.readFileSync(certPath).toString();
} catch (err) {
  console.warn("⚠️ Warning: SSL Certificate not found.");
}

const supabaseOptions = { db: { schema: 'public' } };

if (sslCert) {
  supabaseOptions.global = {
    fetch: (url, options) => {
      return fetch(url, {
        ...options,
        agent: new https.Agent({ ca: sslCert, rejectUnauthorized: true })
      });
    }
  };
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, supabaseOptions);

// ==========================================
// 1. JWT AUTHENTICATION MIDDLEWARE
// ==========================================
export const authenticateToken = (req, res, next) => {
  let token = req.cookies?.auth_token;

  if (!token) {
    const authHeader = req.headers['authorization'];
    token = authHeader && authHeader.split(' ')[1]; 
  }

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Session invalid or secure cookie missing.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.error("[AUTH BOUNCER] Token Verification Failed:", err.message);
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(isExpired ? 401 : 403).json({ error: isExpired ? 'Token expired.' : 'Invalid token.' });
    }
    req.user = user;
    next();
  });
};

// 🛡️ STRICT AUTHORIZATION MIDDLEWARE (Standardized)
export const authorizeRoles = (allowedRoles) => {
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

// ==========================================
// 2. GLOBAL MIDDLEWARE & SECURITY HEADERS
// ==========================================

const corsOptions = {
  origin: (origin, callback) => {
    const allowedLocal = ['http://localhost:5173', 'http://127.0.0.1:5173'];
    
    // 🛡️ THE FIX: Check both suffixes explicitly using separate endsWith statements
    const isCloudflare = origin && (
      origin.endsWith('.barangay-engineer-s-hill.pages.dev') || 
      origin.endsWith('.barangay-engineers-hill.pages.dev')
    );

    if (!origin || allowedLocal.includes(origin) || isCloudflare) {
      callback(null, true);
    } else {
      console.error(`[CORS BLOCKED]: ${origin}`);
      callback(new Error('Blocked by CORS Policy'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'x-resident-id', 'X-XSRF-TOKEN'],
  credentials: true,
  optionsSuccessStatus: 200
};

router.use(cors(corsOptions)); 

// Announcement POST/PUT carry base64 images bound for Cloudinary — allow up to 50mb there.
// Every other route (passwords, records, JSON forms) is capped at 10mb to prevent DoS.
router.use((req, res, next) => {
  const isImageUpload = ['POST', 'PUT'].includes(req.method) && /^\/announcements(\/|$)/.test(req.path);
  express.json({ limit: isImageUpload ? '50mb' : '10mb' })(req, res, next);
});
router.use((req, res, next) => {
  const isImageUpload = ['POST', 'PUT'].includes(req.method) && /^\/announcements(\/|$)/.test(req.path);
  express.urlencoded({ extended: true, limit: isImageUpload ? '50mb' : '10mb' })(req, res, next);
});

// ==========================================
// 2.5 ZERO TRUST SECURITY REGULATOR (IDS/IPS)
// ==========================================
// Scans the payload for threats BEFORE it reaches authentication or the database
router.use(createSecurityRegulator(supabase));

// ==========================================
// 3. SECURITY HELPERS
// ==========================================
const verifyPassword = async (inputPassword, storedPassword) => {
  if (!inputPassword || !storedPassword) return false;
  if (!storedPassword.startsWith('$2')) {
    console.error('[SECURITY] Unhashed password in database. Force-reset required.');
    return false;
  }
  return bcrypt.compare(inputPassword, storedPassword);
};

// ==========================================
// 4. INITIALIZE PROTECTED MODULES
// ==========================================
// 🛡️ SECURITY MODULES (Must be Public/Outside Auth)
CaptchaRouter(router, supabase); 

// Core Modules
NotificationRouter(router, supabase, authenticateToken); 
HouseholdRouter(router, supabase, authenticateToken);
ResidentsLoginRouter(router, supabase);
documentRouter(router, supabase, authenticateToken); 
AuditlogRouter(router, supabase, authenticateToken);
RbacRouter(router, supabase, authenticateToken); 
AccountManagementRouter(router, supabase, authenticateToken); 
ResidentsRecordRouter(router, supabase, authenticateToken); 
OfficialsRouter(router, supabase, authenticateToken); 
OfficialsLoginRouter(router, supabase); 
BlotterRouter(router, supabase, authenticateToken); 
ProfileRouter(router, supabase, authenticateToken);


// ==========================================
// 🔐 5. MASTER AUTHENTICATION ENDPOINT
// Resolves the 404 Error: Maps to POST /api/auth
// ==========================================
router.post('/auth', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: "Email and password are required." });
        }

        // 1. Check Officials Account First
        const { data: official, error: officialErr } = await supabase
            .from('officials_account') // Adjust table name if different in your DB
            .select('*')
            .eq('email', email)
            .single();

        let userToAuth = null;
        let role = null;

        if (official) {
            userToAuth = official;
            role = official.role || 'admin'; 
        } else {
            // 2. Fallback to check Residents Account if not found in officials
            const { data: resident, error: residentErr } = await supabase
                .from('residents_account')
                .select('*')
                .eq('email', email)
                .single();

            if (resident) {
                userToAuth = resident;
                role = 'resident';
            }
        }

        if (!userToAuth) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        // 3. Verify Password using your helper function
        const isValid = await verifyPassword(password, userToAuth.password);
        if (!isValid) {
            return res.status(401).json({ error: "Invalid credentials." });
        }

        // 4. Generate JWT Token
        // Strip out the password hash before putting the user object into the token
        const { password: _pw, ...safeUser } = userToAuth; 
        const tokenPayload = { ...safeUser, role: role };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });

        // 5. Issue HTTP-Only Cookie (Matches your authenticateToken middleware)
        // Cross-site (Cloudflare) needs SameSite=None + Secure; detect HTTPS per-request.
        const _crossSite = req.secure === true
            || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'
            || process.env.NODE_ENV === 'production';
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: _crossSite,
            sameSite: _crossSite ? 'none' : 'lax',
            maxAge: 12 * 60 * 60 * 1000 // 12 hours
        });

        return res.status(200).json({ 
            message: "Authentication successful", 
            user: tokenPayload,
            token: token 
        });

    } catch (error) {
        console.error("[AUTH ERROR]", error.message);
        return res.status(500).json({ error: "Internal Server Error" });
    }
});


// ==========================================
// 6. ANNOUNCEMENTS (FULL CRUD CAPABILITIES ADDED)
// ==========================================

// GET ALL (Remains Public/Unrestricted so residents and visitors can see them)
router.get('/announcements', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch announcements." });
    }
});

// POST NEW (Locked down to authorized roles only)
router.post('/announcements', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
    async (req, res) => {
        try {
            const { title, content, category, priority, expires_at, image_url, status } = req.body;

            if (!title || !content || !expires_at) {
                return res.status(400).json({ error: "Headline, details, and expiry date are required." });
            }

            let secureImageUrl = null;
            
            if (image_url && image_url.includes('base64,')) {
                console.log("Uploading new image to Cloudinary...");
                try {
                    secureImageUrl = await uploadImage(image_url, 'barangay_announcements');
                } catch (uploadErr) {
                    console.error("Cloudinary Upload Failed:", uploadErr.message);
                    return res.status(500).json({ error: "Failed to upload image to cloud." });
                }
            }

            const { data, error } = await supabase
                .from('announcements')
                .insert([{
                    title,
                    content,
                    category: category || 'Public Advisory',
                    priority: priority || 'Low',
                    expires_at,
                    image_url: secureImageUrl || image_url, 
                    status: status || 'Active'
                }])
                .select()
                .single();

            if (error) throw error;
            
            await logActivity(supabase, req.user?.username, 'CREATE_ANNOUNCEMENT', `Created: ${title}`, req);
            res.status(201).json(data);
        } catch (err) {
            console.error("Post Error:", err.message);
            res.status(500).json({ error: "Failed to save announcement." });
        }
});

// PUT (UPDATE) EXISTING (Locked down)
router.put('/announcements/:id', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
    async (req, res) => {
        try {
            const { id } = req.params;
            const { title, content, category, priority, expires_at, image_url, status } = req.body;

            // Field allowlist — only update known columns
            const updates = {};
            if (title     !== undefined) updates.title      = title;
            if (content   !== undefined) updates.content    = content;
            if (category  !== undefined) updates.category   = category;
            if (priority  !== undefined) updates.priority   = priority;
            if (expires_at!== undefined) updates.expires_at = expires_at;
            if (status    !== undefined) updates.status     = status;

            if (image_url !== undefined) {
                if (image_url && image_url.includes('base64,')) {
                    console.log("Updating image on Cloudinary...");
                    const uploadedUrl = await uploadImage(image_url, 'barangay_announcements');
                    // Only persist if Cloudinary succeeded; don't fall back to raw base64
                    if (uploadedUrl) updates.image_url = uploadedUrl;
                } else {
                    updates.image_url = image_url;
                }
            }

            const { data, error } = await supabase
                .from('announcements')
                .update(updates)
                .eq('id', id)
                .select()
                .maybeSingle();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: "Post not found." });

            await logActivity(supabase, req.user?.username, 'UPDATE_ANNOUNCEMENT', `Updated: ${updates.title || id}`, req);
            res.status(200).json(data);
        } catch (err) {
            res.status(500).json({ error: "Failed to update announcement." });
        }
});

// DELETE (Locked down to higher-tier admins)
router.delete('/announcements/:id', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
    async (req, res) => {
        try {
            const { id } = req.params;
            const { error } = await supabase
                .from('announcements')
                .delete()
                .eq('id', id);

            if (error) throw error;
            
            await logActivity(supabase, req.user?.username, 'DELETE_ANNOUNCEMENT', `Deleted ID: ${id}`, req);
            res.status(200).json({ message: "Announcement removed." });
        } catch (err) {
            res.status(500).json({ error: "Failed to delete announcement." });
        }
});

// ==========================================
// 7. SYSTEM STATISTICS
// ==========================================
// Locked down so regular residents can't probe system-wide counts (like audit logs)
router.get('/stats', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
    async (req, res) => {
        try {
            const [pop, doc, blot, act] = await Promise.all([
            supabase.from('residents_records').select('*', { count: 'exact', head: true }),
            supabase.from('document_requests').select('*', { count: 'exact', head: true }),
            supabase.from('blotter_cases').select('*', { count: 'exact', head: true }),
            supabase.from('audit_logs').select('*', { count: 'exact', head: true })
            ]);

            res.status(200).json({
            stats: { 
                totalPopulation: pop.count || 0, 
                documentsIssued: doc.count || 0, 
                blotterCases: blot.count || 0, 
                systemActivities: act.count || 0 
            },
            barangayName: "Barangay Engineer's Hill",
            systemName: "Smart Barangay",
            adminName: req.user?.full_name || req.user?.username || 'Administrator',
            position: req.user?.position || req.user?.role || 'Official'
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to retrieve system statistics.' });
        }
});

// ==========================================
// 7.5 RAW ANALYTICS AGGREGATE
// ==========================================
// Server-side analytics rollup. Admin-gated (mirrors /stats). Wires up
// ApiService.getAnalytics() → previously pointed at a non-existent route. (J-CVE-101203)
router.get('/analytics/raw',
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])],
    async (req, res) => {
        try {
            const [resCount, docs, blotters] = await Promise.all([
                supabase.from('residents_records').select('*', { count: 'exact', head: true }),
                supabase.from('document_requests').select('status, type, date_requested'),
                supabase.from('blotter_cases').select('status, incident_type, created_at')
            ]);

            const tally = (rows, key) => (rows || []).reduce((acc, row) => {
                const bucket = row?.[key] || 'Unspecified';
                acc[bucket] = (acc[bucket] || 0) + 1;
                return acc;
            }, {});

            res.status(200).json({
                generatedAt: new Date().toISOString(),
                totalResidents: resCount.count || 0,
                documents: {
                    total:    docs.data?.length || 0,
                    byStatus: tally(docs.data, 'status'),
                    byType:   tally(docs.data, 'type')
                },
                blotter: {
                    total:    blotters.data?.length || 0,
                    byStatus: tally(blotters.data, 'status'),
                    byType:   tally(blotters.data, 'incident_type')
                }
            });
        } catch (err) {
            console.error("[ANALYTICS_RAW_ERROR]:", err.message);
            res.status(500).json({ error: 'Failed to compute analytics.' });
        }
});

// ==========================================
// 8. DIRECT-LINK NOTIFICATION SYSTEM
// ==========================================

// Locked down to prevent PII leaks of other residents
router.get('/notifications/summary', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
    async (req, res) => {
        try {
            const { data: docs, error: docErr } = await supabase
                .from('document_requests')
                .select('id, resident_name, type, date_requested')
                .eq('status', 'Pending')
                .not('tracking_code', 'ilike', '%WK-IN%')
                .order('date_requested', { ascending: false })
                .limit(10);

            if (docErr) throw docErr;

            const { data: blotters, error: bltErr } = await supabase
                .from('blotter_cases')
                .select('id, complainant_name, incident_type, created_at')
                .eq('status', 'Pending')
                .order('created_at', { ascending: false })
                .limit(10);

            const feed = [
                ...docs.map(d => ({
                    id: `DOC-${d.id}`,
                    title: 'New Request',
                    message: `${d.resident_name} requested ${d.type}`,
                    timestamp: d.date_requested,
                    category: 'document'
                })),
                ...(bltErr ? [] : blotters.map(b => ({
                    id: `BLT-${b.id}`,
                    title: 'New Blotter',
                    message: `Incident reported by ${b.complainant_name}`,
                    timestamp: b.created_at,
                    category: 'blotter'
                })))
            ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

            res.status(200).json(feed);
        } catch (err) {
            console.error("[DIRECT NOTIF ERROR]", err.message);
            res.status(500).json({ error: "Failed to fetch live feed." });
        }
});

// Locked down to prevent probing of system states
router.get('/notifications/badge-count', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin', 'staff', 'barangayhall'])], 
    async (req, res) => {
        try {
            const { count: docCount } = await supabase
                .from('document_requests')
                .select('*', { count: 'exact', head: true })
                .eq('status', 'Pending')
                .not('tracking_code', 'ilike', '%WK-IN%');

            res.status(200).json({ count: docCount || 0 });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
});

export default router;
