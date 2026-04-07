// IDS.js
import chalk from 'chalk';

// In-memory store for bot detection.
const userPatterns = new Map();

// 🧹 MEMORY LEAK PROTECTION
// Automatically clear old IP records every 15 minutes to keep server memory clean
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of userPatterns.entries()) {
        if (now - data.lastSeen > 15 * 60 * 1000) {
            userPatterns.delete(ip);
        }
    }
}, 15 * 60 * 1000);

// 🛡️ THREAT SIGNATURES (WAF Lite)
const sqlInjectionRegex = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER)\b)|(['"]\s*(OR|AND)\s*['"]?\d)/i;
const xssRegex = /(<script.*?>.*?<\/script>)|(<.*?on\w+\s*=.*?>)/i;

// Helper to deeply inspect request data for malicious payloads
const inspectPayload = (obj) => {
    if (!obj || Object.keys(obj).length === 0) return null;
    const str = typeof obj === 'object' ? JSON.stringify(obj) : String(obj);
    if (sqlInjectionRegex.test(str)) return 'SQL_INJECTION_ATTEMPT';
    if (xssRegex.test(str)) return 'CROSS_SITE_SCRIPTING_ATTEMPT';
    return null;
};

export const IDS = (req) => {
    // 1. ROBUST IP EXTRACTION (Matches the IPS logic)
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';
    const now = Date.now();
    
    // 2. DEEP PACKET INSPECTION (The Payload Check)
    // Check the body, URL queries, and URL parameters for malicious code
    const payloadThreat = inspectPayload(req.body) || inspectPayload(req.query) || inspectPayload(req.params);
    if (payloadThreat) {
        console.log(chalk.bgRed.white.bold(' [IDS THREAT] ') + chalk.red(` ${payloadThreat} detected from ${ip}`));
        return { level: 'CRITICAL', reason: payloadThreat }; // Sends to IPS for a Hard Block
    }

    // 3. BOT DETECTION (Timing Variance)
    const data = userPatterns.get(ip) || { lastSeen: now, gaps: [], score: 0 };
    
    const currentGap = now - data.lastSeen;
    if (currentGap > 0) { // Ignore simultaneous parallel requests
        data.gaps.push(currentGap);
        if (data.gaps.length > 5) data.gaps.shift(); // Keep only last 5 gaps
    }

    const averageGap = data.gaps.reduce((a, b) => a + b, 0) / (data.gaps.length || 1);
    
    // Variance < 10ms over 5 requests is inhumanly consistent
    const isTooConsistent = data.gaps.length === 5 && data.gaps.every(g => Math.abs(g - averageGap) < 10); 

    data.lastSeen = now;
    userPatterns.set(ip, data);
    
    if (isTooConsistent) {
        console.log(chalk.bgMagenta.white.bold(' [IDS BOT] ') + chalk.magenta(` Low entropy pattern detected from ${ip}`));
        // Reset gaps so if they pass the CAPTCHA/Challenge, they aren't immediately blocked again
        data.gaps = []; 
        return { level: 'CHALLENGE', reason: 'BOT_PATTERN_DETECTED' }; // Sends to IPS for Soft-Lock
    }

    // 4. ZERO TRUST ENFORCEMENT
    // Note: The RBAC 'x-user-role' check was intentionally removed. 
    // Authorization is strictly handled by the `authenticateToken` middleware via secure cookies.

    return { level: 'SAFE', reason: 'NORMAL_TRAFFIC' };
};