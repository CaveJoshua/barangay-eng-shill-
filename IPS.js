import chalk from 'chalk';
import { logActivity } from './Auditlog.js'; 
import { lockedIPs } from './captcha.js'; 

/**
 * THE REGULATOR (Zero Trust IPS)
 * Updated for better async handling and debug visibility.
 */
export const IPS = async (req, res, next, idsReport, supabase) => {
    // 1. ROBUST IP EXTRACTION
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';

    // DEBUG: This will prove the function is actually running
    // console.log(chalk.dim(` [DEBUG] IPS evaluating IP: ${ip} | Level: ${idsReport.level}`));

    const requestedUrl = req.originalUrl;
    const method = req.method;
    const incidentId = `INC-${Date.now().toString().slice(-6)}`;

    // 🚨 1.5 ENFORCED LOCK CHECK
    // If they are in the penalty box, don't let them do anything but verify
    if (lockedIPs.has(ip) && !requestedUrl.includes('/api/captcha/verify')) {
        return res.status(428).json({ 
            error: 'HUMAN_VERIFICATION_REQUIRED',
            message: 'You must complete verification to continue using the system.',
            incident_id: 'LOCKED'
        });
    }

    // 2. SOFT LOCK (The Challenge)
    if (idsReport.level === 'CHALLENGE') {
        // 🔒 LOCK THEM IN MEMORY
        lockedIPs.add(ip); 

        console.log(
            chalk.bgYellow.black(' [IPS CHALLENGE] ') + 
            chalk.yellow(` Soft-locking ${ip} on ${method} ${requestedUrl}. Awaiting CAPTCHA.`)
        );
        
        // Log to Supabase (We await this so the process doesn't die mid-log)
        if (supabase) {
            try {
                await logActivity(
                    supabase, 
                    'SYSTEM_FIREWALL', 
                    'IPS_CHALLENGE', 
                    `Suspicious behavior from IP: ${ip} targeting ${requestedUrl}. Incident ID: ${incidentId}`
                );
            } catch (err) {
                console.error("Supabase Log Failed:", err.message);
            }
        }

        // Send the "Trap" to the frontend
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

        if (supabase) {
            try {
                await logActivity(
                    supabase, 
                    'SYSTEM_FIREWALL', 
                    'IPS_BLOCK', 
                    `Critical intrusion prevented from IP: ${ip} targeting ${requestedUrl}. Reason: ${idsReport.reason}. Incident ID: ${incidentId}`
                );
            } catch (err) {
                console.error("Supabase Log Failed:", err.message);
            }
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