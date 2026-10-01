import crypto from 'crypto';
import chalk from 'chalk';
import { lockedIPs } from './IPS.js';
import { logActivity } from '../lib/Auditlog.js';

// Active puzzle challenges in memory: challengeId -> { targetX, targetY, imageUrl, ip, createdAt }
const activeChallenges = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Prune expired challenges every 30 seconds
setInterval(() => {
    const now = Date.now();
    for (const [id, ch] of activeChallenges.entries()) {
        if (now - ch.createdAt > CHALLENGE_TTL_MS) {
            activeChallenges.delete(id);
        }
    }
}, 30_000);

export const CaptchaRouter = (router, supabase) => {
    // 0. Initial Risk Evaluation (When user clicks "I am human" checkbox)
    router.post('/captcha/evaluate', async (req, res) => {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const ip = rawIp ? rawIp.split(',')[0].trim() : '127.0.0.1';
        const { forcePuzzle } = req.body || {};

        const isCurrentlyLocked = lockedIPs.has(ip);

        // Check persistent ban if supabase is available
        let isDbBanned = false;
        if (supabase) {
            try {
                const { data } = await supabase
                    .from('ip_bans')
                    .select('id')
                    .eq('ip_address', ip)
                    .gt('expires_at', new Date().toISOString())
                    .maybeSingle();
                if (data) isDbBanned = true;
            } catch {
                // non-fatal
            }
        }

        // Elevated/Critical Risk: Requires interactive slider puzzle
        if (isCurrentlyLocked || isDbBanned || forcePuzzle) {
            return res.status(200).json({
                success: true,
                riskLevel: isCurrentlyLocked ? 'LOCKED' : (isDbBanned ? 'PERSISTENT_BAN' : 'ELEVATED'),
                requiresPuzzle: true,
                reason: isCurrentlyLocked ? 'IP locked due to anomalous traffic' : 'Security step-up challenge required'
            });
        }

        // Low risk: verified directly via checkbox
        return res.status(200).json({
            success: true,
            riskLevel: 'LOW',
            requiresPuzzle: false,
            verified: true,
            message: 'Connection verified as human.'
        });
    });

    // Development/Testing Trigger: Simulate an anomalous threat to test the real firewall trigger
    router.post('/captcha/simulate-threat', (req, res) => {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const ip = rawIp ? rawIp.split(',')[0].trim() : '127.0.0.1';

        // Apply a temporary lock to trigger 428
        lockedIPs.set(ip, {
            unlocksAt: Date.now() + 5 * 60 * 1000,
            tier: 0,
            lockedAt: new Date().toISOString()
        });

        console.log(chalk.yellow(`[SIMULATE] Applied test firewall lock on ${ip}`));

        return res.status(428).json({
            error: 'HUMAN_VERIFICATION_REQUIRED',
            message: 'Connection flagged for security verification. Please complete challenge.',
            incident_id: 'SIMULATED_TEST'
        });
    });

    // 1. Generate a new puzzle challenge
    router.get('/captcha/challenge', (req, res) => {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const ip = rawIp ? rawIp.split(',')[0].trim() : '127.0.0.1';

        // Select one of the 15 safe landscape images
        const imageIndex = Math.floor(Math.random() * 15) + 1;
        const imageUrl = `/captcha/puzzle_${imageIndex}.jpg`;

        // Puzzle dimensions
        const width = 320;
        const height = 160;
        const pieceSize = 44;

        // Target coordinates for the jigsaw piece
        const targetX = Math.floor(Math.random() * (width - pieceSize - 80)) + 80; // between 80 and 196
        const targetY = Math.floor(Math.random() * (height - pieceSize - 40)) + 20; // between 20 and 96

        const challengeId = `ch_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;

        activeChallenges.set(challengeId, {
            targetX,
            targetY,
            imageUrl,
            ip,
            createdAt: Date.now()
        });

        return res.status(200).json({
            success: true,
            challengeId,
            imageUrl,
            targetX,
            targetY,
            width,
            height,
            pieceSize
        });
    });

    // 2. Verify puzzle alignment and unlock IP
    router.post('/captcha/verify', async (req, res) => {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const ip = rawIp ? rawIp.split(',')[0].trim() : '127.0.0.1';
        const { challengeId, userX, trail } = req.body || {};

        if (!challengeId) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CHALLENGE',
                message: 'Challenge identifier missing. Please refresh the puzzle.'
            });
        }

        const challenge = activeChallenges.get(challengeId);
        if (!challenge) {
            return res.status(400).json({
                success: false,
                error: 'CHALLENGE_EXPIRED',
                message: 'Puzzle session expired or invalid. Please try a new puzzle.'
            });
        }

        // Check horizontal placement alignment (±8px tolerance for human touch/mouse)
        const delta = Math.abs(Number(userX) - challenge.targetX);
        const isAligned = delta <= 8;

        // Verify trail characteristics if present (humans have non-zero drag movement duration)
        let isHumanMotion = true;
        if (Array.isArray(trail) && trail.length > 0) {
            const dragDuration = trail[trail.length - 1]?.t - trail[0]?.t;
            if (dragDuration !== undefined && dragDuration < 150) {
                // Unnaturally fast snap (< 150ms for slider)
                isHumanMotion = false;
            }
        }

        if (!isAligned || !isHumanMotion) {
            return res.status(400).json({
                success: false,
                error: 'PUZZLE_MISALIGNED',
                message: 'Puzzle piece not aligned. Please slide the piece precisely into the slot.'
            });
        }

        // Challenge successfully solved! Clean up.
        activeChallenges.delete(challengeId);

        // Remove IP lockout from memory
        lockedIPs.delete(ip);

        // Remove persistent ban from Supabase if configured
        if (supabase) {
            try {
                await supabase.from('ip_bans').delete().eq('ip_address', ip);
                await logActivity(
                    supabase,
                    'SYSTEM_FIREWALL',
                    'CAPTCHA_SOLVED',
                    `Human verification passed by IP ${ip} (accuracy: ${delta}px)`,
                    req
                );
            } catch (dbErr) {
                console.warn(chalk.dim('[CAPTCHA] Non-fatal DB ban cleanup error:'), dbErr.message);
            }
        }

        console.log(
            chalk.bgGreen.black.bold(' [CAPTCHA VERIFIED] ') +
            chalk.green(` IP ${ip} successfully unlocked via puzzle (Delta: ${delta}px)`)
        );

        return res.status(200).json({
            success: true,
            unlocked_ip: ip,
            message: 'Human verification confirmed. Connection restored.'
        });
    });
};