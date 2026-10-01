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

import http from 'http';

// Modular Imports
import dataRoutes from './app.js';
import { startPulse, handleShutdown } from './security/Regulator.js';
import { initWebSocketServer, getActiveWebSocketClientsCount } from './lib/WebSocketServer.js';
import { globalApiLimiter, authLoginLimiter, publicEndpointLimiter } from './lib/RateLimiter.js';
import { concurrentUserGatekeeper, getActiveUserStats } from './lib/ActiveUserTracker.js';
import { corsOptions, isAllowedOrigin } from './security/corsConfig.js';

dotenv.config();

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) throw new Error('[FATAL] SUPABASE_JWT_SECRET is not set in environment.');

const ADMIN_GATE_KEY = process.env.ADMIN_GATE_KEY;
if (!ADMIN_GATE_KEY) throw new Error('[FATAL] ADMIN_GATE_KEY is not set in environment.');

const app = express();
const PORT = process.env.PORT || 8000;



export const authenticateToken = (req, res, next) => {
  const token = req.cookies?.auth_token || req.headers['authorization']?.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Unauthenticated' });

  // can never trick verify into accepting a different/"none" algorithm.
  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
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

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors(corsOptions));

const bodyLimitFor = (req) =>
  (['POST', 'PUT'].includes(req.method) && /^\/api\/announcements(\/|$)/.test(req.path)) ? '50mb' : '10mb';

app.use((req, res, next) => express.json({ limit: bodyLimitFor(req) })(req, res, next));
app.use((req, res, next) => express.urlencoded({ extended: true, limit: bodyLimitFor(req) })(req, res, next));
app.use(cookieParser());

app.set('trust proxy', 1);
app.use(concurrentUserGatekeeper);
app.use('/api/admin/login', authLoginLimiter);
app.use('/api/residents/login', authLoginLimiter);
app.use('/api/documents/track', publicEndpointLimiter);
app.use('/api/', globalApiLimiter);

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

app.get('/developer-portal', 
    [authenticateToken, authorizeRoles(['admin', 'superadmin'])], 
    (req, res) => {
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

// Public route to instantly verify server liveness and Resend API health
app.get('/api/system/diagnostics', (req, res) => {
    const resendKey = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM;
    
    let mailerStatus = "ONLINE";
    let mailerReason = "Resend API key is loaded and appears structurally valid.";

    if (!resendKey) {
        mailerStatus = "OFFLINE - CRITICAL";
        mailerReason = "RESEND_API_KEY is missing from your environment variables. You must add it to the Render dashboard.";
    } else if (!resendKey.startsWith('re_')) {
        mailerStatus = "WARNING";
        mailerReason = "RESEND_API_KEY is present, but does not start with 're_'. It is likely invalid or copy-pasted incorrectly.";
    } else if (!resendFrom) {
        mailerStatus = "WARNING";
        mailerReason = "RESEND_API_KEY is active, but RESEND_FROM is missing. Emails will default to Resend's testing address.";
    }

    return res.status(200).json({
        server: {
            status: "ONLINE",
            message: "Main Express API & Realtime WebSocket Gateway are active.",
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development',
            websocket: {
                status: "ONLINE",
                activeClients: getActiveWebSocketClientsCount()
            },
            concurrency: getActiveUserStats()
        },
        mailer_integration: {
            status: mailerStatus,
            reason: mailerReason
            // (length/prefix) on a public, unauthenticated endpoint.
        }
    });
});

app.use('/api', dataRoutes); 

app.use((req, res) => {
    res.status(404).json({ error: "Not Found", message: "Endpoint Restricted." });
});

const httpServer = http.createServer(app);
initWebSocketServer(httpServer);

const stopPulse = startPulse();
process.on('SIGINT', () => handleShutdown(stopPulse));

httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[CORE] System Live on Port ${PORT}`);
    console.log(`[REALTIME] WebSocket Gateway Listening on ws://0.0.0.0:${PORT}/ws`);
});
