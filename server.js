import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser'; // <-- NEW: Required for Zero Trust cookies
import dataRoutes from './data.js';
import { startPulse, handleShutdown } from './Regulator.js';

dotenv.config();

const app = express();
const PORT = 8000;

// 1. GLOBAL CORS (ZERO TRUST EDITION)
app.use(cors({
  origin: [
    'http://localhost:5173', 
    'http://127.0.0.1:5173',
  ], 
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