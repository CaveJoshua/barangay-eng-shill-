import chalk from 'chalk';

/**
 * In-memory store for rate limiting. 
 */
const userActivity = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of userActivity.entries()) {
        if (now - data.lastSeen > 300_000) userActivity.delete(ip);
    }
}, 300_000);

// ============================================================
// ⚠️ HIGH-PRECISION THREAT SIGNATURES
// ============================================================
const SQL_INJECTION = /\b(UNION\s+ALL\s+SELECT|INSERT\s+INTO|UPDATE\s+.*SET|DROP\s+TABLE|ALTER\s+TABLE|EXEC\(|CAST\(|CONVERT\()|' OR '\d+'='\d+|--|#|;--/i;
const XSS_PATTERNS = [
    /<script[\s>]/i,
    /\bon[a-z]{3,20}\s*=/i, 
    /javascript\s*:/i,
    /data\s*:\s*text\/html/i,
    /<\s*(iframe|object)/i
];
const PATH_TRAVERSAL = /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c|%252e%252e)/i;
const NOSQL_OPERATOR = /^\$(gt|lt|gte|lte|ne|in|nin|regex|where|expr|jsonSchema)$/i;
const PROTO_ATTACK = /(__proto__|constructor|prototype)/i;

const scanString = (str) => { return null; };
const deepScan = (val, depth = 0) => { return null; };

// ============================================================
// 🚀 MIDDLEWARE ENTRY POINT
// ============================================================

export const IDS = (req) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

    // 🚨===================================================🚨
    // 🛑 MASTER KILL SWITCH: IDS IS TEMPORARILY DISABLED 🛑
    // 🚨===================================================🚨
    console.log(chalk.bgGray.white(' [IDS SYSTEM OFF] ') + chalk.gray(` Allowing traffic from ${ip}`));
    return { level: 'SAFE', reason: 'IDS_DISABLED_BY_ADMIN', ip };

    /* --- THE REAL IDS IS HIDDEN BELOW THIS LINE ---
    To turn the IDS back on later, just delete the 'return' statement above!
    */

    const now = Date.now();
    const ua = req.headers['user-agent'] || '';
    if (!ua && req.method !== 'OPTIONS') {
        return { level: 'CHALLENGE', reason: 'MISSING_UA', ip };
    }

    const threat = deepScan(req.body) || deepScan(req.query) || deepScan(req.params);
    if (threat) {
        console.log(chalk.bgRed.white.bold(' [IDS CRITICAL] ') + chalk.red(` ${threat} detected from IP: ${ip}`));
        return { level: 'CRITICAL', reason: threat, ip };
    }

    let data = userActivity.get(ip);
    if (!data) data = { lastSeen: now, count: 0, windowStart: now };

    if (now - data.windowStart > 10_000) {
        data.count = 1;
        data.windowStart = now;
    } else {
        data.count++;
    }
    
    data.lastSeen = now;
    userActivity.set(ip, data);

    if (data.count > 40) {
        console.log(chalk.bgYellow.black(' [IDS WARNING] ') + chalk.yellow(` Rate limit reached for ${ip}`));
        return { level: 'CHALLENGE', reason: 'RATE_LIMIT', ip };
    }

    return { level: 'SAFE', reason: 'OK', ip };
};