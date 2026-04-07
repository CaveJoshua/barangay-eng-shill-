// IPS.js
import chalk from 'chalk';
import { logActivity } from './Auditlog.js'; // Assumes you have your existing Audit logger

/**
 * THE REGULATOR (Zero Trust IPS)
 * Intercepts malicious behavior, resolves real client IPs behind proxies,
 * and logs intrusion attempts directly to the database.
 */
export const IPS = async (req, res, next, idsReport, supabase) => {
    // 1. ROBUST IP EXTRACTION (Proxy/Cloudflare Safe)
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    // If multiple IPs are forwarded, the first one is the original client
    const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';

    const requestedUrl = req.originalUrl;
    const method = req.method;
    const incidentId = `INC-${Date.now().toString().slice(-6)}`; // Generates a short trace ID

    // 2. SOFT LOCK (The Challenge)
    if (idsReport.level === 'CHALLENGE') {
        console.log(
            chalk.bgYellow.black(' [IPS CHALLENGE] ') + 
            chalk.yellow(` Soft-locking ${ip} on ${method} ${requestedUrl}. Awaiting CAPTCHA.`)
        );
        
        // Non-blocking Audit Log to Supabase
        if (supabase) {
            logActivity(
                supabase, 
                'SYSTEM_FIREWALL', 
                'IPS_CHALLENGE', 
                `Suspicious behavior from IP: ${ip} targeting ${requestedUrl}. Incident ID: ${incidentId}`
            ).catch(err => console.error("Failed to log IPS event:", err.message));
        }

        return res.status(428).json({ 
            error: 'HUMAN_VERIFICATION_REQUIRED',
            message: 'Our security system detected unusual behavior. Please complete verification to continue.',
            incident_id: incidentId
        });
    }

    // 3. HARD BLOCK (The Guillotine)
    if (idsReport.level === 'CRITICAL') {
        console.log(
            chalk.bgRed.white(' [IPS CRITICAL] ') + 
            chalk.red(` Hard-blocking ${ip} on ${method} ${requestedUrl}. Reason: ${idsReport.reason || 'Malicious Payload'}`)
        );

        // Non-blocking Audit Log to Supabase
        if (supabase) {
            logActivity(
                supabase, 
                'SYSTEM_FIREWALL', 
                'IPS_BLOCK', 
                `Critical intrusion prevented from IP: ${ip} targeting ${requestedUrl}. Reason: ${idsReport.reason}. Incident ID: ${incidentId}`
            ).catch(err => console.error("Failed to log IPS event:", err.message));
        }

        return res.status(403).json({ 
            error: 'INTRUSION_PREVENTED',
            message: 'Your request was blocked by the security firewall.',
            incident_id: incidentId
        });
    }

    // 4. SAFE - LET THEM PASS
    next();
};