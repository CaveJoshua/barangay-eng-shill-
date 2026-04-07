import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser'; // <-- NEW: Required for Zero Trust cookies
import dataRoutes from './data.js';
import { startPulse, handleShutdown } from './Regulator.js';

dotenv.config();

const app = express();
const PORT = 8000;

// 1. GLOBAL CORS (ZERO TRUST EDITION - DYNAMIC CLOUDFLARE)
app.use(cors({
  origin: (origin, callback) => {
    // Allow local development
    const allowedLocal = [
      'http://localhost:5173', 
      'http://127.0.0.1:5173'
    ];

    // DYNAMIC WILDCARD: Allows ANY URL ending in your domain
    const isCloudflare = origin && origin.endsWith('.barangay-eng-shill.pages.dev');

    if (!origin || allowedLocal.includes(origin) || isCloudflare) {
      callback(null, true); // Approved
    } else {
      console.error(`[CORS BLOCKED]: ${origin}`);
      callback(new Error('Blocked by CORS Policy')); // Rejected
    }
  }, 
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role', 'x-resident-id', 'X-XSRF-TOKEN'], 
  credentials: true, // <-- CRITICAL: Tells Express to accept the secure cookies
  optionsSuccessStatus: 200
}));

// 2. PARSERS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // <-- CRITICAL: Opens the cookies sent by the frontend

// 3. ROUTE MOUNTING
app.use('/api', dataRoutes); 

// 4. PROCESS HANDLING
const stopPulse = startPulse();
process.on('SIGINT', () => handleShutdown(stopPulse));

// 5. SERVER START (No Logs)
app.listen(PORT, '0.0.0.0');