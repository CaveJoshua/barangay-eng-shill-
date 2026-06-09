import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

// GraphQL Imports
import { buildSchema, NoSchemaIntrospectionCustomRule } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';

// Modular Imports
import dataRoutes from './Data.js';
import { startPulse, handleShutdown } from './src/components/Captcha/Regulator.js';

dotenv.config();

// ==========================================
// 🛡️ STARTUP GUARDS — fail fast if secrets missing
// ==========================================
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) throw new Error('[FATAL] SUPABASE_JWT_SECRET is not set in environment.');

const ADMIN_GATE_KEY = process.env.ADMIN_GATE_KEY;
if (!ADMIN_GATE_KEY) throw new Error('[FATAL] ADMIN_GATE_KEY is not set in environment.');

const app = express();
const PORT = process.env.PORT || 8000;

// ==========================================
// 🛡️ CORS — explicit allowlist, no wildcard
// ==========================================
const ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const isCloudflareOrigin = (origin) => origin && origin.endsWith('.barangay-engineer-s-hill.pages.dev');

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin) || isCloudflareOrigin(origin)) {
            callback(null, true);
        } else {
            console.error(`[CORS BLOCKED]: ${origin}`);
            callback(new Error('Blocked by CORS Policy'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'X-XSRF-TOKEN'],
    optionsSuccessStatus: 200
};

// ==========================================
// 🛡️ SECURITY MIDDLEWARE
// ==========================================
export const authenticateToken = (req, res, next) => {
  const token = req.cookies?.auth_token || req.headers['authorization']?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthenticated' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      const isExpired = err.name === 'TokenExpiredError';
      return res.status(isExpired ? 401 : 403).json({ error: isExpired ? 'Token expired.' : 'Invalid token.' });
    }
    req.user = user;
    next();
  });
};

export const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        const role = (req.user?.role || req.user?.user_role || '').toLowerCase().trim();
        if (!allowedRoles.includes(role)) return res.status(403).json({ error: 'Forbidden' });
        next();
    };
};

// ==========================================
// ⚙️ GLOBAL CONFIG
// ==========================================
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors(corsOptions));

// 🛡️ SMART BODY LIMIT (J-CVE-101203 hardening)
// Announcement uploads carry base64 images (≤50mb); every other route is capped at
// 10mb to blunt payload-DoS. The previous flat 200mb global parser silently overrode
// the smart cap inside Data.js, so the intended limit never actually applied.
const bodyLimitFor = (req) =>
  (['POST', 'PUT'].includes(req.method) && /^\/api\/announcements(\/|$)/.test(req.path)) ? '50mb' : '10mb';

app.use((req, res, next) => express.json({ limit: bodyLimitFor(req) })(req, res, next));
app.use((req, res, next) => express.urlencoded({ extended: true, limit: bodyLimitFor(req) })(req, res, next));
app.use(cookieParser());

// ==========================================
// 🕸️ 1. GRAPHQL ENGINE (PRIORITY ROUTING)
// ==========================================
const schema = buildSchema(`
  type Stats { totalPopulation: Int, documentsIssued: Int, blotterCases: Int }
  type Query { systemStatus: String, getStats: Stats }
`);

const rootValue = {
  systemStatus: () => "SMART BARANGAY CORE // ENCRYPTED_TUNNEL",
  getStats: () => ({ totalPopulation: 1205, documentsIssued: 45, blotterCases: 12 })
};

// Protected GraphQL endpoint (introspection disabled — J-CVE-101203)
app.all('/api/graphql',
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])],
    createHandler({ schema, rootValue, validationRules: [NoSchemaIntrospectionCustomRule] })
);

// ==========================================
// 📺 2. HIDDEN DEVELOPER PORTAL (GATEKEEPER)
// ==========================================
app.get('/developer-portal', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
    (req, res) => {
        // 🛡️ SECONDARY GATE CHECK — value sourced from the ADMIN_GATE_KEY env var.
        // (The literal key was previously hard-coded in this comment — removed in J-CVE-101203.)
        if (!req.query.key || req.query.key !== ADMIN_GATE_KEY) {
            return res.status(404).json({ error: "Not Found", message: "Resource restricted." });
        }

        try {
            const uiPath = path.join(process.cwd(), '.sys_core', 'Graphql.tsx');
            const htmlContent = fs.readFileSync(uiPath, 'utf8');
            res.send(htmlContent);
        } catch (err) {
            res.status(500).send("System Error: Core module missing.");
        }
    }
);

// ==========================================
// 📂 3. STANDARD API ROUTES
// ==========================================
app.use('/api', dataRoutes); 

// ==========================================
// 🚨 4. GLOBAL TRAPDOOR
// ==========================================
app.use((req, res) => {
    res.status(404).json({ error: "Not Found", message: "Endpoint Restricted." });
});

// ==========================================
// 🚀 5. BOOT
// ==========================================
const stopPulse = startPulse();
process.on('SIGINT', () => handleShutdown(stopPulse));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CORE] System Live on Port ${PORT}`);
});