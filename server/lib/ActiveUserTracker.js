
import chalk from 'chalk';
import jwt from 'jsonwebtoken';

const MAX_TOTAL_USERS = 500;
const MAX_RESIDENT_USERS = 470;
const RESERVED_OFFICIAL_SLOTS = 30; // 500 - 470 = 30
const SESSION_TTL_MS = 2 * 60 * 1000; // 2 minutes active window

// Map of unique user/session key -> { lastSeen: number, isOfficial: boolean }
const activeUsers = new Map();

// Periodic prune every 15 seconds to purge idle sessions
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of activeUsers.entries()) {
        if (now - session.lastSeen > SESSION_TTL_MS) {
            activeUsers.delete(key);
        }
    }
}, 15_000);

const OFFICIAL_ROLES = new Set([
    'superadmin',
    'admin',
    'official',
    'punongbarangay',
    'barangaysecretary',
    'barangaytreasurer',
    'kagawad',
    'barangayhall'
]);

/**
 * Inspects request authentication to determine if the user is an Official / Administrator
 */
export const checkIsOfficialOrAdmin = (req) => {
    // 1. Check req.user if already populated by auth middleware
    if (req.user) {
        const role = (req.user.user_role || req.user.role || '').toLowerCase().trim();
        if (OFFICIAL_ROLES.has(role)) return true;
        if (req.user.username?.toLowerCase() === 'system_root_admin') return true;
    }

    // 2. Check token in cookies or Authorization header (fast decode for gatekeeping)
    const token = req.cookies?.auth_token || req.headers['authorization']?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.decode(token);
            if (decoded) {
                const role = (decoded.user_role || decoded.role || '').toLowerCase().trim();
                if (OFFICIAL_ROLES.has(role)) return true;
                if (decoded.username?.toLowerCase() === 'system_root_admin') return true;
            }
        } catch {
            // Ignore malformed token decode
        }
    }

    // 3. Check official route paths
    const path = req.path.toLowerCase();
    if (path.startsWith('/api/admin') || path.startsWith('/api/officials') || path.startsWith('/api/rbac')) {
        // High-privilege routes
        return true;
    }

    return false;
};

/**
 * Extracts a unique user/session identifier from the request
 */
export const getClientSessionKey = (req) => {
    if (req.user?.sub) return `user_${req.user.sub}`;
    if (req.user?.username) return `user_${req.user.username}`;
    if (req.user?.record_id) return `user_${req.user.record_id}`;

    // Token fallback
    const token = req.cookies?.auth_token || req.headers['authorization']?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.decode(token);
            if (decoded?.sub) return `user_${decoded.sub}`;
            if (decoded?.username) return `user_${decoded.username}`;
            if (decoded?.record_id) return `user_${decoded.record_id}`;
        } catch {
            // pass
        }
    }

    // Fallback to IP address
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                  req.socket?.remoteAddress || 
                  req.ip || 
                  '127.0.0.1';
    return `guest_${rawIp}`;
};

/**
 * Middleware that enforces the 470 Resident limit and protects the 30 Reserved Official slots
 */
export const concurrentUserGatekeeper = (req, res, next) => {
    // Exclude static assets, health checks, and diagnostics
    if (req.path.startsWith('/api/system/diagnostics') || req.path === '/lb/status' || req.method === 'OPTIONS') {
        return next();
    }

    const key = getClientSessionKey(req);
    const now = Date.now();
    const isExistingUser = activeUsers.has(key);
    const isOfficial = checkIsOfficialOrAdmin(req);

    if (activeUsers.size >= MAX_TOTAL_USERS && !isExistingUser) {
        console.warn(chalk.red.bold(`[GATEKEEPER 500+] System Full (${activeUsers.size} users). Queuing ${key}`));

        res.setHeader('Retry-After', '15');
        return res.status(503).json({
            status: 'BUSY',
            error: 'TOTAL_SERVER_CAPACITY_REACHED',
            title: 'Barangay System is Operating at Maximum Capacity (500 Users)',
            message: 'All 500 resident and administrative server spots are currently active. Please wait a moment while ongoing transactions conclude and try again shortly.',
            tagalogMessage: 'Puno na po ang kabuuang 500 spots ng sistema. Mangyaring maghintay ng ilang sandali habang natatapos ang mga kasalukuyang transaksyon.',
            retryAfterSeconds: 15,
            activeUsersCount: activeUsers.size,
            maxCapacity: MAX_TOTAL_USERS
        });
    }

    // If active count reaches 470+, block new RESIDENT sessions to reserve the remaining 30 spots for OFFICIALS.
    if (activeUsers.size >= MAX_RESIDENT_USERS && !isExistingUser && !isOfficial) {
        console.warn(chalk.yellow.bold(`[GATEKEEPER 470+] Resident Cap Reached (${activeUsers.size} users). Reserving performance slots for officials.`));

        res.setHeader('Retry-After', '15');
        return res.status(503).json({
            status: 'BUSY',
            error: 'RESIDENT_CAPACITY_REACHED',
            title: 'Barangay Resident Portal at Peak Capacity',
            message: 'The resident portal has reached its active concurrency limit (470 active users). Remaining server capacity is reserved for official barangay administration and emergency operations. Please wait a few moments and try again.',
            tagalogMessage: 'Kasalukuyang puno ang resident portal (470 active users). Nakalaan ang nalalabing kapasidad para sa mga opisyal na operasyon ng barangay. Mangyaring maghintay ng ilang sandali at subukan muli.',
            retryAfterSeconds: 15,
            activeUsersCount: activeUsers.size,
            residentCapacity: MAX_RESIDENT_USERS,
            reservedOfficialSlots: RESERVED_OFFICIAL_SLOTS
        });
    }

    // Record or update active session
    activeUsers.set(key, { lastSeen: now, isOfficial });
    next();
};

/**
 * Returns telemetry data about current active user capacity and reserved official slots
 */
export const getActiveUserStats = () => {
    let officialCount = 0;
    let residentCount = 0;

    for (const session of activeUsers.values()) {
        if (session.isOfficial) officialCount++;
        else residentCount++;
    }

    return {
        activeUsers: activeUsers.size,
        activeResidents: residentCount,
        activeOfficials: officialCount,
        maxTotalCapacity: MAX_TOTAL_USERS,
        residentCapacityCap: MAX_RESIDENT_USERS,
        reservedOfficialSlots: RESERVED_OFFICIAL_SLOTS,
        isResidentCapReached: activeUsers.size >= MAX_RESIDENT_USERS,
        isTotalCapReached: activeUsers.size >= MAX_TOTAL_USERS,
        capacityPercentage: Math.min(100, Math.round((activeUsers.size / MAX_TOTAL_USERS) * 100))
    };
};
