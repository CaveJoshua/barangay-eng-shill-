// IDS.js
import chalk from 'chalk';

// In-memory store for bot detection and rate limiting.
const userActivity = new Map();

// 🧹 MEMORY LEAK PROTECTION (Runs every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of userActivity.entries()) {
        // Clear records inactive for more than 5 minutes to free RAM
        if (now - data.lastSeen > 5 * 60 * 1000) {
            userActivity.delete(ip);
        }
    }
}, 5 * 60 * 1000);

// 🛡️ THREAT SIGNATURES (WAF Lite - Hardened)
const sqlInjectionRegex = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC)\b)|(['"]\s*(OR|AND)\s*['"]?\d)/i;
const xssRegex = /(<script.*?>.*?<\/script>)|(<.*?on\w+\s*=.*?>)|(javascript:)/i;
const pathTraversalRegex = /(\.\.\/|\.\.\\)/; // Catches attempts to read server files

// Helper to deeply inspect request data for malicious payloads
const inspectPayload = (obj) => {
    if (!obj || Object.keys(obj).length === 0) return null;
    const str = typeof obj === 'object' ? JSON.stringify(obj) : String(obj);
    
    if (sqlInjectionRegex.test(str)) return 'SQL_INJECTION_ATTEMPT';
    if (xssRegex.test(str)) return 'CROSS_SITE_SCRIPTING_ATTEMPT';
    if (pathTraversalRegex.test(str)) return 'PATH_TRAVERSAL_ATTEMPT';
    
    return null;
};

// ⚙️ SLIDING WINDOW CONFIGURATION
const TIME_WINDOW_MS = 10000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 35; // Allow 35 requests per 10 seconds (Friendly for SPAs)

export const IDS = (req) => {
    // 1. ROBUST IP EXTRACTION
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';
    const now = Date.now();
    
    // 2. DEEP PACKET INSPECTION (The Payload Check)
    const payloadThreat = inspectPayload(req.body) || inspectPayload(req.query) || inspectPayload(req.params);
    if (payloadThreat) {
        console.log(chalk.bgRed.white.bold(' [IDS THREAT] ') + chalk.red(` ${payloadThreat} detected from ${ip}`));
        return { level: 'CRITICAL', reason: payloadThreat }; 
    }

    // 3. BOT DETECTION (Sliding Window Velocity)
    const data = userActivity.get(ip) || { lastSeen: now, timestamps: [] };
    
    // Add current request to the history
    data.timestamps.push(now);
    data.lastSeen = now;

    // Filter out old requests that fall outside our 10-second window
    data.timestamps = data.timestamps.filter(timestamp => now - timestamp < TIME_WINDOW_MS);

    // Update the memory store
    userActivity.set(ip, data);
    
    // Evaluate Request Velocity
    if (data.timestamps.length > MAX_REQUESTS_PER_WINDOW) {
        console.log(chalk.bgMagenta.white.bold(' [IDS BOT] ') + chalk.magenta(` High velocity traffic (${data.timestamps.length} reqs/10s) from ${ip}`));
        
        // Clear their history. If they solve the CAPTCHA, they start fresh. 
        // If they don't, the IPS lock handles them anyway.
        data.timestamps = []; 
        userActivity.set(ip, data);

        return { level: 'CHALLENGE', reason: 'RATE_LIMIT_EXCEEDED' }; 
    }

    // 4. ZERO TRUST ENFORCEMENT
    return { level: 'SAFE', reason: 'NORMAL_TRAFFIC' };
};