import chalk from 'chalk';

// We keep this exported so your IPS/Firewall doesn't crash if it tries to read it
export const lockedIPs = new Set(); 

export const CaptchaRouter = (router, supabase) => {
    
    // Auto-Approve ANY verification request
    router.post('/captcha/verify', (req, res) => {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
        const ip = rawIp ? rawIp.split(',')[0].trim() : 'UNKNOWN_IP';

        // Automatically remove the lock if the firewall accidentally triggers it
        if (lockedIPs.has(ip)) {
            lockedIPs.delete(ip);
            console.log(chalk.green(` [CAPTCHA DISABLED] IP auto-unlocked: ${ip}`));
        }

        // Always tell the frontend it was successful
        return res.status(200).json({ 
            success: true, 
            message: "CAPTCHA disabled. Auto-verified." 
        });
    });

    // Dummy challenge route just in case the frontend still tries to fetch it
    router.get('/captcha/challenge', (req, res) => {
        res.status(200).json({ challenge_id: "disabled" });
    });
};