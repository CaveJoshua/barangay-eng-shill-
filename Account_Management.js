import bcrypt from 'bcryptjs';
import { sendAutoMail } from './Mailer.js'; 
import { RateLimiterMemory } from 'rate-limiter-flexible';

// =========================================================
// 🛡️ RATE LIMITERS (Tiered Token Bucket)
// =========================================================

// TIER 1: Burst Limiter (Max 3 requests per 60 seconds)
const burstLimiter = new RateLimiterMemory({
    points: 3,           
    duration: 60,        
    blockDuration: 60,   
});

// TIER 2: Daily Limiter (Max 10 requests per 24 hours)
const dailyLimiter = new RateLimiterMemory({
    points: 10,          
    duration: 60 * 60 * 24, 
    blockDuration: 60 * 60 * 24, 
});

// --- OTP Memory Storage (For the Codes) ---
const otpStore = new Map();

// 🛡️ SECURITY HELPER 1: Hash Passwords
const hashPassword = (plain) => {
    if (!plain) return null;
    return bcrypt.hashSync(plain, 10);
};

// 🛡️ SECURITY HELPER 2: Generate Alphanumeric Code 
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

export const AccountManagementRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 🧠 SMART LOOKUP HELPER (The Ultimate "Who is Who" Search)
    // =========================================================
    const findUserEmail = async (identifier) => {
        
        // --- 1. CHECK RESIDENTS ---
        const { data: resAuth } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (resAuth) {
            const { data: resProfile } = await supabase
                .from('residents_records')
                .select('email, first_name')
                .eq('record_id', resAuth.resident_id)
                .maybeSingle();
            return resProfile ? { email: resProfile.email, firstName: resProfile.first_name, accountId: resAuth.resident_id, role: 'resident' } : null;
        }

        const { data: resProfileByEmail } = await supabase
            .from('residents_records')
            .select('record_id, email, first_name')
            .eq('email', identifier)
            .maybeSingle();

        if (resProfileByEmail) {
            return { email: resProfileByEmail.email, firstName: resProfileByEmail.first_name, accountId: resProfileByEmail.record_id, role: 'resident' };
        }

        // --- 2. CHECK OFFICIALS / ADMINS ---
        const { data: offAuth } = await supabase
            .from('officials_accounts')
            .select('account_id, official_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (offAuth) {
            const { data: offProfile } = await supabase
                .from('officials')
                .select('email, full_name')
                .eq('id', offAuth.official_id)
                .maybeSingle();
            return offProfile ? { email: offProfile.email, firstName: offProfile.full_name, accountId: offAuth.account_id, role: 'official' } : null;
        }

        const { data: offProfileByEmail } = await supabase
            .from('officials')
            .select('id, email, full_name')
            .eq('email', identifier)
            .maybeSingle();

        if (offProfileByEmail) {
            const { data: offAuthByEmail } = await supabase
                .from('officials_accounts')
                .select('account_id')
                .eq('official_id', offProfileByEmail.id)
                .maybeSingle();
            if (offAuthByEmail) {
                return { email: offProfileByEmail.email, firstName: offProfileByEmail.full_name, accountId: offAuthByEmail.account_id, role: 'official' };
            }
        }

        // --- 3. NOT FOUND ---
        return null;
    };

    // =========================================================
    // 1. GENERATE & SEND SECURE OTP
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { email, useFallback } = req.body; 
            if (!email) return res.status(400).json({ error: 'Identification required.' });
            
            const identifier = email.toLowerCase().trim();

            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const limitKey = `${clientIp}_${identifier}`;

            try {
                await dailyLimiter.consume(limitKey, 1);
                await burstLimiter.consume(limitKey, 1);
            } catch (rejRes) {
                const secsToWait = Math.round(rejRes.msBeforeNext / 1000) || 60;
                return res.status(429).json({ error: `Too many requests. Please wait ${secsToWait} seconds.` });
            }

            const userData = await findUserEmail(identifier);
            
            // 🛡️ THE FIX: Only fail if the user flat out does not exist in the DB
            if (!userData) {
                return res.status(404).json({ error: 'Account not found. Please check your details.' });
            }

            // 🛡️ THE FIX: Dynamic mapping. If no email exists, attach the OTP to the Account ID instead.
            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            let destinationEmail = userData.email?.toLowerCase();

            // 🛡️ ZERO-TRUST FALLBACK LOGIC
            if (useFallback) {
                const { data: hallData } = await supabase
                    .from('officials')
                    .select('email')
                    .eq('position', 'Barangay Hall')
                    .limit(1)
                    .maybeSingle();

                if (hallData && hallData.email) {
                    destinationEmail = hallData.email.toLowerCase();
                } else if (process.env.ROOT_ADMIN_EMAIL) {
                    // Ultimate Lifeline if the DB record is corrupted/missing an email
                    destinationEmail = process.env.ROOT_ADMIN_EMAIL.toLowerCase();
                } else {
                    return res.status(500).json({ error: 'System Error: Master Email is not configured.' });
                }
            } else if (!destinationEmail) {
                // If they have no email and didn't select fallback, block them gracefully
                return res.status(400).json({ error: 'No personal email registered. Please use the Barangay Hall Master Email (Fallback) option.' });
            }

            const otpCode = generateSecureCode(6);
            
            // Map the OTP securely to the target user
            otpStore.set(targetMapKey, { 
                code: otpCode, 
                expires: Date.now() + 300000, // 5 minutes
                attempts: 0
            });

            // 📩 DYNAMIC EMAIL TEMPLATES
            let emailMessage = '';
            let subjectLine = '';

            if (useFallback) {
                subjectLine = "URGENT: Fallback Account Recovery Request";
                emailMessage = `
                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                        <h2 style="color: #d97706; margin-top: 0;">Emergency Password Reset Request</h2>
                        <p>A user has requested an emergency password reset using the Master Fallback system.</p>
                        <p><b>Target User:</b> ${userData.firstName} (${identifier})</p>
                        <p><b>Account Role:</b> ${userData.role.toUpperCase()}</p>
                        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
                        <p>Their 5-Minute Security Code is:</p>
                        <h1 style="background: #fef3c7; padding: 15px; text-align: center; letter-spacing: 6px; color: #b45309; border-radius: 8px;">${otpCode}</h1>
                        <p style="color: #64748b; font-size: 12px;">Only share this code after physically verifying the identity of the requester.</p>
                    </div>
                `;
            } else {
                subjectLine = "Password Reset Request";
                emailMessage = `
                    Hello <b>${userData.firstName}</b>,<br><br>
                    A password reset was requested for your account.<br><br>
                    Your 5-Minute Security Code is:<br>
                    <h1 style="color: #27ae60; letter-spacing: 6px; font-family: monospace; background: #f4f4f4; padding: 15px; border-radius: 8px; display: inline-block;">${otpCode}</h1><br>
                    <p><i>Note: This code is case-sensitive.</i></p>
                    If you did not request this, please secure your account immediately.
                `;
            }

            const isSent = await sendAutoMail(destinationEmail, subjectLine, "ACCOUNT RECOVERY", emailMessage);

            if (isSent) {
                return res.status(200).json({ success: true, message: 'Security code dispatched.' });
            } else {
                return res.status(500).json({ error: 'Failed to dispatch email.' });
            }

        } catch (err) {
            console.error("❌ [OTP SYSTEM ERROR]:", err.message);
            res.status(500).json({ error: 'System error.' });
        }
    });

    // =========================================================
    // 2. VERIFY OTP
    // =========================================================
    router.post('/accounts/verify-otp', async (req, res) => {
        try {
            const { email, otp } = req.body;
            const identifier = email?.toLowerCase().trim();
            
            const userData = await findUserEmail(identifier);
            if (!userData) return res.status(400).json({ error: 'Invalid verification target.' });
            
            // 🛡️ Map checks against the dynamic key
            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetMapKey);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetMapKey); 
                    return res.status(429).json({ error: 'Too many failed attempts. Code destroyed. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            res.status(200).json({ success: true, message: 'Identity verified.' });
        } catch (err) {
            res.status(500).json({ error: 'Verification failed.' });
        }
    });

    // =========================================================
    // 3. CORE: PASSWORD RESET (Restricted: ADMIN DASHBOARD VIA OTP)
    // =========================================================
    router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
            const loggedInUserId = req.user?.account_id || req.user?.sub; 
            const targetId = req.params.accountId;

            const adminRoles = ['superadmin', 'punongbarangay', 'barangaysecretary', 'barangayhall'];
            const isAdmin = adminRoles.includes(userRole);
            const isSelf = String(loggedInUserId) === String(targetId);

            if (!isAdmin && !isSelf) {
                return res.status(403).json({ error: 'Access Denied. You lack permissions.' });
            }

            const { password, otp } = req.body;
            if (!password) return res.status(400).json({ error: 'New password is required.' });

            // 🛡️ ENFORCE OTP
            if (isAdmin && !isSelf) {
                if (!otp) return res.status(400).json({ error: 'Security verification code is required.' });

                let targetMapKey = null;
                
                const { data: resData } = await supabase.from('residents_records').select('email').eq('record_id', targetId).maybeSingle();
                if (resData) {
                    targetMapKey = resData.email || targetId;
                } else {
                    const { data: offAuth } = await supabase.from('officials_accounts').select('official_id').eq('account_id', targetId).maybeSingle();
                    if (offAuth) {
                        const { data: offData } = await supabase.from('officials').select('email').eq('id', offAuth.official_id).maybeSingle();
                        targetMapKey = offData?.email ? offData.email : targetId;
                    }
                }

                if (!targetMapKey) return res.status(404).json({ error: 'Target account corrupted.' });

                const stored = otpStore.get(String(targetMapKey).toLowerCase());
                if (!stored) return res.status(400).json({ error: 'No active verification code found.' });
                if (Date.now() > stored.expires) {
                    otpStore.delete(String(targetMapKey).toLowerCase());
                    return res.status(400).json({ error: 'Verification code expired.' });
                }
                if (stored.code !== otp.trim()) {
                    stored.attempts += 1;
                    if (stored.attempts >= 3) otpStore.delete(String(targetMapKey).toLowerCase());
                    return res.status(401).json({ error: 'Invalid verification code.' });
                }
                otpStore.delete(String(targetMapKey).toLowerCase());
            }

            const securePass = hashPassword(password);

            const { data: resData } = await supabase
                .from('residents_account')
                .update({ password: securePass, requires_reset: false }) 
                .or(`account_id.eq.${targetId},resident_id.eq.${targetId}`)
                .select();

            if (resData && resData.length > 0) {
                return res.json({ success: true, message: 'Password updated successfully.' });
            }

            if (isAdmin || isSelf) {
                const { data: offData } = await supabase
                    .from('officials_accounts')
                    .update({ password: securePass })
                    .eq('account_id', targetId)
                    .select();
                
                if (offData && offData.length > 0) {
                    return res.json({ success: true, message: 'Official password updated successfully.' });
                }
            }

            return res.status(404).json({ error: 'Account not found.' });

        } catch (err) {
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });

    // =========================================================
    // 4. PUBLIC: RESET PASSWORD VIA OTP (Login Page)
    // =========================================================
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { email, otp, newPassword } = req.body;
            const identifier = email?.toLowerCase().trim();
            
            const userData = await findUserEmail(identifier);
            if (!userData) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetMapKey);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetMapKey); 
                    return res.status(429).json({ error: 'Too many failed attempts. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            if (userData.role === 'official') {
                const { error: updateError } = await supabase
                    .from('officials_accounts')
                    .update({ password: hashPassword(newPassword) })
                    .eq('account_id', userData.accountId);
                if (updateError) throw updateError;
            } else {
                const { error: updateError } = await supabase
                    .from('residents_account')
                    .update({ password: hashPassword(newPassword) })
                    .eq('resident_id', userData.accountId);

                if (updateError) throw updateError;

                try {
                    await supabase.from('residents_account')
                        .update({ requires_reset: false })
                        .eq('resident_id', userData.accountId);
                } catch(ignoreErr) {}
            }

            otpStore.delete(targetMapKey);
            res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (err) {
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });
};