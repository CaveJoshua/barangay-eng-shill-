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

// --- NEW: Validation Libraries ---
import { z } from 'zod';
import Joi from 'joi';

import { uploadImage } from './cloud.js';

// Modular Imports
import { documentRouter } from './Document.js';
import { AuditlogRouter, logActivity } from './Auditlog.js'; 
import { RbacRouter } from './Rbac_acc.js'; 
import { AccountManagementRouter } from './Account_Management.js';
import { ResidentsRecordRouter } from './Residents_record.js'; 
import { OfficialsRouter } from './Officials.js'; 
import { HouseholdRouter } from './Household.js';
import { OfficialsLoginRouter } from './Officials_login.js';
import { BlotterRouter } from './Blotter.js'; 
import { ProfileRouter } from './Profile.js';
import { checkRole } from './Rbac_acc.js';
import { ResidentsLoginRouter } from './Resident_login.js';
import { NotificationRouter } from './notification.js'; // NEW: Import Notification Engine

dotenv.config();

const router = express.Router();

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || process.env.JWT_SECRET || 'your_fallback_secret'; 

/**
 * ==========================================
 * VALIDATION SCHEMAS (ZOD & JOI)
 * ==========================================
 */

const loginSchemaZod = z.object({
  username: z.string().min(1, "Username is required."),
  password: z.string().min(1, "Password is required.")
});

const announcementSchemaZod = z.object({
  title: z.string().min(1, "Title is required."),
  content: z.string().min(1, "Content is required."),
  category: z.string().optional().nullable(),
  priority: z.string().optional().nullable(),
  expires_at: z.string().optional().nullable(),
  image_url: z.string().optional().nullable()
});

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
// 1. JWT AUTHENTICATION MIDDLEWARE (ZERO TRUST)
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
        return res.status(403).json({ error: 'Invalid or expired token.' });
    }
    
    req.user = user;
    next();
  });
};

// ==========================================
// 2. GLOBAL MIDDLEWARE & SECURITY HEADERS
// ==========================================
router.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, 
  contentSecurityPolicy: false, 
}));

const corsOptions = {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'], 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role','x-resident-id','X-XSRF-TOKEN'],
  credentials: true,
  optionsSuccessStatus: 200
};

router.use(cors(corsOptions)); 
router.use(express.json({ limit: '30mb' }));
router.use(express.urlencoded({ extended: true, limit: '30mb' }));

// ==========================================
// 3. SECURITY HELPERS
// ==========================================
const verifyPassword = (inputPassword, storedPassword) => {
  if (!inputPassword || !storedPassword) return false;
  if (storedPassword.startsWith('$2')) {
    return bcrypt.compareSync(inputPassword, storedPassword);
  }
  return inputPassword === storedPassword;
};

// ==========================================
// 4. AUTHENTICATION & LOGIN
// ==========================================
router.post('/login', async (req, res) => {
  try {
    const validation = loginSchemaZod.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: validation.error.errors[0].message });
    }
    const { username, password } = validation.data;
    const cleanUsername = username ? username.trim().toLowerCase() : '';

    const { data: accountData, error: accountError } = await supabase
      .from('residents_account')
      .select('*') 
      .ilike('username', cleanUsername) 
      .single();

    if (accountError || !accountData) {
      return res.status(401).json({ error: 'Account not found.' });
    }

    const isValid = verifyPassword(password, accountData.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid password.' });

    const targetResidentId = accountData.resident_id || accountData.record_id;
    
    const { data: profileData } = await supabase
      .from('residents_records')
      .select('record_id, first_name, last_name, purok')
      .eq('record_id', targetResidentId)
      .single();

    const fName = profileData?.first_name || '';
    const lName = profileData?.last_name || '';
    const safeFullName = (fName && lName) ? `${fName} ${lName}` : 'UNKNOWN RESIDENT';

    const token = jwt.sign(
      { 
        account_id: accountData.account_id, 
        username: accountData.username, 
        role: accountData.role,
        user_role: accountData.role, 
        record_id: profileData ? profileData.record_id : null,
        full_name: safeFullName 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logActivity(supabase, accountData.username, 'RESIDENT_LOGIN', 'Login successful');

    res.json({ message: 'Login successful', token, role: accountData.role, profile: profileData });
  } catch (err) {
    res.status(500).json({ error: 'Internal system error.' });
  }
});


// ==========================================
// 5. INITIALIZE PROTECTED MODULES
// ==========================================
NotificationRouter(router, supabase, authenticateToken); // <--- MOUNTED DIRECT NOTIFICATION ENGINE
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
// 6. ANNOUNCEMENTS
// ==========================================
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

// ==========================================
// 7. SYSTEM STATISTICS
// ==========================================
router.get('/stats', authenticateToken, async (req, res) => {
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
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve system statistics.' });
  }
});

// ==========================================
// 8. DIRECT-LINK NOTIFICATION SYSTEM
// ==========================================
// This section bypasses the dedicated notification table and 
// queries operational tables directly for "Pending" items.

router.get('/notifications/summary', authenticateToken, async (req, res) => {
    try {
        // Fetch pending documents directly from the table
        const { data: docs, error: docErr } = await supabase
            .from('document_requests')
            .select('id, resident_name, type, date_requested')
            .eq('status', 'Pending')
            .order('date_requested', { ascending: false })
            .limit(10);

        if (docErr) throw docErr;

        // Fetch pending blotter cases
        const { data: blotters, error: bltErr } = await supabase
            .from('blotter_cases')
            .select('id, complainant_name, incident_type, created_at')
            .eq('status', 'Pending')
            .order('created_at', { ascending: false })
            .limit(10);

        // Merge into a virtual notification feed
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

// Endpoint for the Badge Count
router.get('/notifications/badge-count', authenticateToken, async (req, res) => {
    try {
        const { count: docCount } = await supabase
            .from('document_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'Pending');

        res.status(200).json({ count: docCount || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;