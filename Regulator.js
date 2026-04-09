import chalk from 'chalk';
import os from 'os';
import crypto from 'crypto';
import { IDS } from './IDS.js';
import { IPS } from './IPS.js';

const theme = {
    pulse: chalk.bold.blue,
    success: chalk.bgGreen.black.bold,
    warning: chalk.bgYellow.black.bold,
    error: chalk.bgRed.white.bold,
    system: chalk.bold.magenta,
    dim: chalk.dim,
    metric: chalk.cyan
};

// --- METRICS STATE ---
const stats = {
    activeConnections: 0,
    totalRequests: 0,
    previousRequests: 0
};

/**
 * 1. THE SECURITY HANDSHAKE (Middleware Factory)
 * Updated to be ASYNC to handle the database-logging IPS.
 */
export const createSecurityRegulator = (supabase) => {
    return async (req, res, next) => { // 🚨 FIXED: Added async here
        // Trace ID Injection
        req.traceId = crypto.randomUUID();
        res.setHeader('X-Trace-Id', req.traceId);

        // Track Active I/O
        stats.activeConnections++;
        stats.totalRequests++;

        res.on('finish', () => stats.activeConnections--);
        res.on('close', () => {
            if (!res.writableFinished) stats.activeConnections--;
        });

        // Scan the request
        const idsReport = IDS(req);
        
        // ZERO TRUST OPTIMIZATION
        if (idsReport.level === 'SAFE') {
            return next();
        }

        // 🚨 FIXED: Added await here. 
        // This ensures the IPS sends the 428/403 response before the middleware chain continues.
        try {
            await IPS(req, res, next, idsReport, supabase);
        } catch (err) {
            console.error(theme.error(' [REGULATOR ERROR] '), "IPS Handshake Failed:", err.message);
            res.status(500).json({ error: "Security Handshake Failure" });
        }
    };
};

/**
 * 2. MEASURE EVENT LOOP LAG
 */
const measureEventLoopLag = () => {
    return new Promise((resolve) => {
        const start = Date.now();
        setImmediate(() => resolve(Date.now() - start));
    });
};

/**
 * 3. ADVANCED TELEMETRY HEARTBEAT
 */
export const startPulse = (intervalMs = 15000, gcThresholdMB = 500) => {
    const isProd = process.env.NODE_ENV === 'production';
    
    if (!isProd) {
        console.log(theme.system('\n[DEV_TELEMETRY] Advanced Diagnostics: ') + chalk.green('ONLINE'));
    }

    const interval = setInterval(async () => {
        const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
        const lag = await measureEventLoopLag();
        const cpuLoad = os.loadavg()[0].toFixed(2); 
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        
        const rps = ((stats.totalRequests - stats.previousRequests) / (intervalMs / 1000)).toFixed(1);
        stats.previousRequests = stats.totalRequests;

        const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1);

        let status = 'STABLE';
        if (lag > 50 || toMB(heapUsed) > gcThresholdMB * 0.8 || cpuLoad > 2.0) status = 'WARNING';
        if (lag > 100 || toMB(heapUsed) > gcThresholdMB) status = 'CRITICAL';

        if (!isProd) {
            let coloredStatus = chalk.green(status);
            if (status === 'WARNING') coloredStatus = chalk.yellow(status);
            if (status === 'CRITICAL') coloredStatus = chalk.bgRed.white.bold(` ${status} `);

            console.log(
                theme.pulse('┣ [SYS_PULSE] ') + coloredStatus +
                theme.dim(' | RPS: ') + theme.metric(rps) +
                theme.dim(' | Active I/O: ') + theme.metric(stats.activeConnections) +
                theme.dim(' | Lag: ') + theme.metric(`${lag}ms`) +
                theme.dim(' | CPU Load: ') + theme.metric(cpuLoad) +
                theme.dim(` | RAM(Sys): `) + theme.metric(`${freeMem}GB free`)
            );
        }
    }, intervalMs);

    return () => clearInterval(interval);
};

/**
 * 4. GRACEFUL SHUTDOWN HANDLER
 */
export const handleShutdown = async (cleanupTasks) => {
    console.log(`\n${theme.error(' INIT SHUTDOWN SEQUENCE ')}`);
    
    const forceExit = setTimeout(() => {
        process.exit(1);
    }, 10000);

    try {
        const tasks = Array.isArray(cleanupTasks) ? cleanupTasks : [cleanupTasks];
        for (const task of tasks) {
            if (typeof task === 'function') await task();
        }
        console.log(theme.success(' SYSTEM OFFLINE '));
        clearTimeout(forceExit);
        process.exit(0);
    } catch (err) {
        process.exit(1);
    }
};