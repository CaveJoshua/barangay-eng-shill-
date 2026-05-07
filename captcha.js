// captcha.js
import chalk from 'chalk';
import { logActivity } from './Auditlog.js';

// 🔒 IN-MEMORY LOCK STORE
// This keeps track of all IPs that are currently required to solve a CAPTCHA.
export const lockedIPs = new Set(); 

// 🧹 MEMORY CLEANUP
// Automatically unlock IPs after 30 minutes to prevent permanent lockouts if they just leave
setInterval(() => {
    lockedIPs.clear();
    console.log(chalk.dim(' [SYS_CLEANUP] Cleared CAPTCHA memory locks.'));
}, 30 * 60 * 1000);

export const CaptchaRouter = (router, supabase) => {

    // ==========================================
    // VERIFY HUMAN ENDPOINT
    // ==========================================
    router.post('/captcha/verify', async (req, res) => {
        try {
            const { token } = req.body;
            
            // Extract IP exactly how the IPS does it
            const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
            const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';

            if (!token) {
                return res.status(400).json({ error: "Verification token missing." });
            }

            // 🛡️ TOKEN VERIFICATION
            // Note: In a production app, you would send this token to Google reCAPTCHA 
            // or Cloudflare Turnstile APIs to verify it. For now, we accept a local payload.
            if (token === 'human-verified-token') {
                
                // If they were locked, unlock them!
                if (lockedIPs.has(ip)) {
                    lockedIPs.delete(ip); // Remove the lock
                    
                    console.log(
                        chalk.bgGreen.black(' [CAPTCHA CLEARED] ') + 
                        chalk.green(` IP unlocked: ${ip}`)
                    );

                    if (supabase) {
                        await logActivity(
                            supabase, 
                            'SYSTEM_FIREWALL', 
                            'CAPTCHA_SOLVED', 
                            `IP ${ip} successfully verified as human.`
                        );
                    }
                }

                return res.status(200).json({ message: "Verification successful. Access restored." });
            } else {
                return res.status(403).json({ error: "Invalid verification token." });
            }
        } catch (err) {
            console.error("Captcha Error:", err.message);
            res.status(500).json({ error: "Server error during verification." });
        }
    });
};