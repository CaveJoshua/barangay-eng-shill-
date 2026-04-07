// Regulator.js
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
 * We wrap the middleware in a function so we can inject the Supabase client
 * down into the IPS for audit logging.
 */
export const createSecurityRegulator = (supabase) => {
    return (req, res, next) => {
        // Trace ID Injection (Track attackers across logs & microservices)
        req.traceId = crypto.randomUUID();
        res.setHeader('X-Trace-Id', req.traceId);

        // Track Active I/O & Throughput
        stats.activeConnections++;
        stats.totalRequests++;

        // Clean up connection count when request finishes or aborts early
        res.on('finish', () => stats.activeConnections--);
        res.on('close', () => {
            if (!res.writableFinished) stats.activeConnections--;
        });

        // Scan & Enforce
        const idsReport = IDS(req);
        
        // ZERO TRUST OPTIMIZATION: If safe, skip the heavy IPS routing
        if (idsReport.level === 'SAFE') {
            return next();
        }

        // If a threat is detected, pass to the IPS with the DB client
        IPS(req, res, next, idsReport, supabase);
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
 * 3. ADVANCED TELEMETRY HEARTBEAT (Production Aware)
 */
export const startPulse = (intervalMs = 15000, gcThresholdMB = 500) => {
    const isProd = process.env.NODE_ENV === 'production';
    
    if (!isProd) {
        console.log(theme.system('\n[DEV_TELEMETRY] Advanced Diagnostics: ') + chalk.green('ONLINE'));
    } else {
        console.log(JSON.stringify({ event: 'telemetry_started', message: 'System heartbeat initialized' }));
    }

    const interval = setInterval(async () => {
        const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
        const lag = await measureEventLoopLag();
        const cpuLoad = os.loadavg()[0].toFixed(2); 
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        
        const rps = ((stats.totalRequests - stats.previousRequests) / (intervalMs / 1000)).toFixed(1);
        stats.previousRequests = stats.totalRequests;

        const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(1);

        // Dynamic Threat/Load Assessment
        let status = 'STABLE';
        if (lag > 50 || toMB(heapUsed) > gcThresholdMB * 0.8 || cpuLoad > 2.0) status = 'WARNING';
        if (lag > 100 || toMB(heapUsed) > gcThresholdMB) status = 'CRITICAL';

        // PRODUCTION LOGGING (Clean, parseable JSON)
        if (isProd) {
            // Only log in production if there's an actual problem, to save log space
            if (status !== 'STABLE') {
                console.warn(JSON.stringify({
                    level: 'warn', event: 'system_pulse', status, rps, activeConnections: stats.activeConnections, lag_ms: lag, cpuLoad, memory_mb: toMB(heapUsed)
                }));
            }
        } 
        // DEVELOPMENT LOGGING (Your awesome chalk UI)
        else {
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
            console.log(
                theme.pulse('┗ [MEM_HEAP]  ') +
                theme.dim('RSS (Total): ') + theme.metric(`${toMB(rss)}MB`) +
                theme.dim(' | V8 Heap: ') + theme.metric(`${toMB(heapUsed)}/${toMB(heapTotal)}MB`) +
                theme.dim(' | C++ Ext: ') + theme.metric(`${toMB(external)}MB`)
            );
        }

        // Emergency V8 Garbage Collection Check
        if (toMB(heapUsed) > gcThresholdMB) {
            if (global.gc) {
                if (!isProd) console.log(theme.warning('⚠️ HEAP LIMIT REACHED ') + theme.system(` Forcing V8 Garbage Collection...`));
                global.gc();
            } else if (!isProd) {
                console.log(theme.error('⚠️ HEAP LIMIT REACHED ') + theme.dim(` Cannot run GC. Start node with --expose-gc flag.`));
            }
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
        console.error(chalk.red('[FATAL] Cleanup timeout. Forcing process kill.'));
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
        console.error(theme.error(' SHUTDOWN FAILED '), err);
        process.exit(1);
    }
};