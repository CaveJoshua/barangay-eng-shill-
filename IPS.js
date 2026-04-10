/**
 * ============================================================
 *  IPS.js — Intrusion Prevention System  [HARDENED v2.0]
 * ============================================================
 *  AUDIT FIXES APPLIED:
 *  [CRITICAL] lockedIPs Set replaced with TTL-Map (auto-expiry per IP)
 *  [CRITICAL] Duplicate code block removed (was pasted twice in original)
 *  [HIGH]     Graduated lockout tiers: 5min → 30min → 24hr per IP
 *  [HIGH]     Persistent ban escalation stored in Supabase (survives restart)
 *  [MEDIUM]   CHALLENGE response now includes Retry-After header (RFC 7231)
 *  [MEDIUM]   IP extracted from IDS report (single source of truth)
 *  [INFO]     All Supabase writes wrapped in non-fatal try/catch
 * ============================================================
 */

import chalk from 'chalk';
import { logActivity } from './Auditlog.js';

// ---------------------------------------------------------------------------
// TTL-based lock store  (replaces the plain Set that had no expiry)
// ---------------------------------------------------------------------------
//  Structure: Map<ip, { unlocksAt: number, tier: number }>
//  tier 0 → 5 min lock
//  tier 1 → 30 min lock
//  tier 2+ → 24 hr lock  (treat as near-permanent in-session)
// ---------------------------------------------------------------------------
const lockedIPs = new Map();

// Lockout durations per tier (milliseconds)
const LOCK_TIERS = [
    5  * 60 * 1000,   // tier 0 → 5 minutes
    30 * 60 * 1000,   // tier 1 → 30 minutes
    24 * 60 * 60 * 1000, // tier 2+ → 24 hours
];

const getTierDuration = (tier) => LOCK_TIERS[Math.min(tier, LOCK_TIERS.length - 1)];

// 🧹 Prune expired entries every 10 minutes (prevents memory leak)
setInterval(() => {
    const now = Date.now();
    for (const [ip, lock] of lockedIPs.entries()) {
        if (now >= lock.unlocksAt) lockedIPs.delete(ip);
    }
}, 10 * 60 * 1000);

// ---------------------------------------------------------------------------
// Helper — apply or escalate a lock for an IP
// ---------------------------------------------------------------------------
const applyLock = (ip) => {
    const existing = lockedIPs.get(ip);
    const tier     = existing ? Math.min(existing.tier + 1, LOCK_TIERS.length - 1) : 0;
    const duration = getTierDuration(tier);
    
    lockedIPs.set(ip, {
        unlocksAt: Date.now() + duration,
        tier,
        lockedAt: new Date().toISOString(),
    });

    return { tier, durationMs: duration, retryAfterSecs: Math.ceil(duration / 1000) };
};

// ---------------------------------------------------------------------------
// Helper — check if IP is currently locked (with auto-cleanup)
// ---------------------------------------------------------------------------
const isLocked = (ip) => {
    const lock = lockedIPs.get(ip);
    if (!lock) return null;
    if (Date.now() >= lock.unlocksAt) {
        lockedIPs.delete(ip);  // TTL expired — remove and allow
        return null;
    }
    return {
        remainingSecs: Math.ceil((lock.unlocksAt - Date.now()) / 1000),
        tier: lock.tier,
    };
};

// ---------------------------------------------------------------------------
// Persistent escalation check — consult Supabase for repeat offenders
// (survives server restarts; in-memory lock is the fast path)
// ---------------------------------------------------------------------------
const checkPersistentBan = async (ip, supabase) => {
    if (!supabase) return null;
    try {
        const { data } = await supabase
            .from('ip_bans')
            .select('tier, expires_at')
            .eq('ip_address', ip)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
        return data || null;
    } catch {
        return null; // DB failure should never block legitimate traffic
    }
};

const persistLock = async (ip, tier, supabase) => {
    if (!supabase) return;
    try {
        const expiresAt = new Date(Date.now() + getTierDuration(tier)).toISOString();
        await supabase
            .from('ip_bans')
            .upsert(
                { ip_address: ip, tier, expires_at: expiresAt, updated_at: new Date().toISOString() },
                { onConflict: 'ip_address' }
            );
    } catch (err) {
        console.error(chalk.dim('[IPS] Persist lock failed (non-fatal):'), err.message);
    }
};

// ---------------------------------------------------------------------------
// Main IPS export
// ---------------------------------------------------------------------------
export const IPS = async (req, res, next, idsReport, supabase) => {
    // Use the IP resolved by IDS (single source of truth)
    const ip           = idsReport.ip || req.ip || 'UNKNOWN_IP';
    const requestedUrl = req.originalUrl;
    const method       = req.method;
    const incidentId   = `INC-${Date.now().toString(36).toUpperCase()}`;

    // ── 1. ENFORCED LOCK CHECK (fast path — in-memory TTL) ────────────────
    const captchaVerifyPath = '/api/captcha/verify';
    const currentLock       = isLocked(ip);

    if (currentLock && !requestedUrl.includes(captchaVerifyPath)) {
        res.set('Retry-After', String(currentLock.remainingSecs));
        return res.status(428).json({
            error:      'HUMAN_VERIFICATION_REQUIRED',
            message:    `Access locked. Please complete verification. ${currentLock.remainingSecs}s remaining.`,
            incident_id: 'LOCKED',
        });
    }

    // ── 2. PERSISTENT BAN CHECK (survives restarts) ────────────────────────
    if (!requestedUrl.includes(captchaVerifyPath)) {
        const persistentBan = await checkPersistentBan(ip, supabase);
        if (persistentBan) {
            // Re-hydrate in-memory lock from DB record
            lockedIPs.set(ip, {
                unlocksAt: new Date(persistentBan.expires_at).getTime(),
                tier: persistentBan.tier,
            });
            const remaining = Math.ceil(
                (new Date(persistentBan.expires_at) - Date.now()) / 1000
            );
            res.set('Retry-After', String(Math.max(0, remaining)));
            return res.status(428).json({
                error:      'HUMAN_VERIFICATION_REQUIRED',
                message:    'Persistent security lock active. Complete verification to restore access.',
                incident_id: 'PERSISTENT_LOCK',
            });
        }
    }

    // ── 3. SOFT LOCK — Rate Limit Challenge ───────────────────────────────
    if (idsReport.level === 'CHALLENGE') {
        const { tier, retryAfterSecs } = applyLock(ip);
        await persistLock(ip, tier, supabase);

        console.log(
            chalk.bgYellow.black(' [IPS CHALLENGE] ') +
            chalk.yellow(
                ` Tier-${tier} lock on ${ip} for ${method} ${requestedUrl} | ${incidentId}`
            )
        );

        if (supabase) {
            try {
                await logActivity(
                    supabase,
                    'SYSTEM_FIREWALL',
                    'IPS_CHALLENGE',
                    `Tier-${tier} soft-lock: IP ${ip} targeting ${requestedUrl}. Reason: ${idsReport.reason}. ID: ${incidentId}`
                );
            } catch (err) {
                console.error(chalk.dim('[IPS] Audit log failed (non-fatal):'), err.message);
            }
        }

        res.set('Retry-After', String(retryAfterSecs));
        return res.status(428).json({
            error:      'HUMAN_VERIFICATION_REQUIRED',
            message:    'Unusual activity detected. Complete verification to continue.',
            incident_id: incidentId,
        });
    }

    // ── 4. HARD BLOCK — Malicious Payload ────────────────────────────────
    if (idsReport.level === 'CRITICAL') {
        console.log(
            chalk.bgRed.white(' [IPS CRITICAL] ') +
            chalk.red(
                ` Hard-block ${ip} | ${method} ${requestedUrl} | Reason: ${idsReport.reason} | ${incidentId}`
            )
        );

        if (supabase) {
            try {
                await logActivity(
                    supabase,
                    'SYSTEM_FIREWALL',
                    'IPS_BLOCK',
                    `Critical intrusion: IP ${ip} | ${requestedUrl} | Reason: ${idsReport.reason} | ${incidentId}`
                );
            } catch (err) {
                console.error(chalk.dim('[IPS] Audit log failed (non-fatal):'), err.message);
            }
        }

        // Hard blocks also get a persistent record for post-incident review
        await persistLock(ip, 2, supabase); // Immediately escalate to tier 2

        return res.status(403).json({
            error:      'INTRUSION_PREVENTED',
            message:    'Your request was blocked by the security firewall.',
            incident_id: incidentId,
        });
    }

    // ── 5. SAFE PASS ───────────────────────────────────────────────────────
    next();
};

// Export the map for the captcha route to call lockedIPs.delete(ip) on verify
export { lockedIPs };