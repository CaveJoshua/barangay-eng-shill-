
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import chalk from 'chalk';

/**
 * Resolves the client IP or authenticated Account Identity.
 * If authenticated, keys by Account ID so 50+ users behind 1 router aren't lumped together.
 */
const resolveAccountOrIpKey = (req) => {
    // 1. Authenticated user token / payload (Prioritize Account ID)
    if (req.user?.sub) return `user_${req.user.sub}`;
    if (req.user?.username) return `user_${req.user.username}`;
    if (req.user?.record_id) return `user_${req.user.record_id}`;

    // 2. Fallback to IP address (handles X-Forwarded-For with IPv6/IPv4 normalization)
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                  req.socket?.remoteAddress || 
                  req.ip || 
                  '127.0.0.1';

    return ipKeyGenerator(rawIp);
};

// 500 active accounts * 30 req/min = 15,000 req/min baseline.
// Configured to 25,000 req/min capacity with standard HTTP 429 Retry-After.
export const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 25_000,         // 25,000 requests per minute server-wide
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: resolveAccountOrIpKey,
    handler: (req, res, next, options) => {
        console.warn(chalk.yellow(`[RATE-LIMIT] Global throttle hit by: ${resolveAccountOrIpKey(req)}`));
        res.status(429).json({
            error: 'Too Many Requests',
            message: 'System is experiencing high traffic. Please retry in a few seconds.',
            retryAfter: Math.ceil(options.windowMs / 1000)
        });
    }
});

// Allows up to 350 requests per minute per authenticated account (approx 6 req/sec).
// Easily covers active form editing, instant badge sync, and search queries.
export const accountOperationalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 350,            // 350 requests/min per account
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: resolveAccountOrIpKey,
    skip: (req) => req.method === 'OPTIONS',
    handler: (req, res, next, options) => {
        res.status(429).json({
            error: 'Account Rate Limit Exceeded',
            message: 'You are making requests too quickly. Please slow down.',
            retryAfter: 15
        });
    }
});

// High burst limit (1,000 req/min per IP) for unauthenticated community tracking.
export const publicEndpointLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 1000,           // 1,000 requests/min
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                      req.socket?.remoteAddress || 
                      req.ip || 
                      '127.0.0.1';
        return ipKeyGenerator(rawIp);
    },
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too Many Queries',
            message: 'Too many public requests from your network. Please wait a moment before querying again.'
        });
    }
});

// Allows unlimited successful logins (500 distinct accounts can log in at once),
// while strictly punishing brute force password guessing (max 10 failed attempts/15m).
export const authLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes window
    max: 1000,                 // High ceiling for total login attempts per IP
    skipSuccessfulRequests: true, 
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const username = req.body?.username ? String(req.body.username).toLowerCase().trim() : '';
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '127.0.0.1';
        return `${ip}_${username}`;
    },
    handler: (req, res) => {
        res.status(429).json({
            error: 'Too Many Failed Login Attempts',
            message: 'Security lock active due to repeated failed login attempts. Please wait 15 minutes or contact your administrator.'
        });
    }
});
