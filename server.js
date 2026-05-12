import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser'; 
import helmet from 'helmet'; 
import jwt from 'jsonwebtoken'; 
import fs from 'fs';
import path from 'path';

// GraphQL Imports
import { buildSchema } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';

// Modular Imports
import dataRoutes from './data.js';
import { startPulse, handleShutdown } from 'Captcha/Regulator.js';

dotenv.config();

const app = express();
const PORT = 8000;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'your_secret';
const ADMIN_GATE_KEY = "Barangay_Admin_2026_Secure"; // 🛡️ Your Hardcoded Password

// ==========================================
// 🛡️ SECURITY MIDDLEWARE
// ==========================================
export const authenticateToken = (req, res, next) => {
  const token = req.cookies?.auth_token || req.headers['authorization']?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthenticated' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session Expired' });
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
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" }, contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));
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

// Protected GraphQL endpoint
app.all('/api/graphql', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
    createHandler({ schema, rootValue })
);

// ==========================================
// 📺 2. HIDDEN DEVELOPER PORTAL (GATEKEEPER)
// ==========================================
app.get('/developer-portal', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
    (req, res) => {
        // 🛡️ SECONDARY PASSWORD CHECK (Hardcoded)
        // Access via: http://localhost:8000/developer-portal?key=Barangay_Admin_2026_Secure
        if (req.query.key !== ADMIN_GATE_KEY) {
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