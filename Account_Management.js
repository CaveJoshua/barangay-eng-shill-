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
        // A. Search by Username
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

        // B. Search by Email
        const { data: resProfileByEmail } = await supabase
            .from('residents_records')
            .select('record_id, email, first_name')
            .eq('email', identifier)
            .maybeSingle();

        if (resProfileByEmail) {
            return { email: resProfileByEmail.email, firstName: resProfileByEmail.first_name, accountId: resProfileByEmail.record_id, role: 'resident' };
        }

        // --- 2. CHECK OFFICIALS / ADMINS ---
        // A. Search by Username
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

        // B. Search by Email
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
        // If they typed something that doesn't exist in any of the 4 places above.
        return null;
    };

    // =========================================================
    // 1. GENERATE & SEND SECURE OTP (Public / Residents / Admins)
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { email } = req.body; 
            if (!email) return res.status(400).json({ error: 'Identification required.' });
            
            // The input can be a username OR an email, so we clean it up
            const identifier = email.toLowerCase().trim();

            // 🛡️ RATE LIMITING
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const limitKey = `${clientIp}_${identifier}`;

            try {
                await dailyLimiter.consume(limitKey, 1);
                await burstLimiter.consume(limitKey, 1);
            } catch (rejRes) {
                const secsToWait = Math.round(rejRes.msBeforeNext / 1000) || 60;
                return res.status(429).json({ 
                    error: `Too many requests. Please wait ${secsToWait} seconds before trying again.` 
                });
            }

            // Let the Smart Lookup figure out who this is
            const userData = await findUserEmail(identifier);
            
            // 🛡️ REJECT: Return an explicit 404 error if the account does not exist
            if (!userData || !userData.email) {
                return res.status(404).json({ error: 'Account not found. Please check your details.' });
            }

            const targetEmail = userData.email.toLowerCase();
            const otpCode = generateSecureCode(6);
            
            otpStore.set(targetEmail, { 
                code: otpCode, 
                expires: Date.now() + 300000, // 5 minutes
                attempts: 0
            });

            const emailMessage = `
                Hello <b>${userData.firstName}</b>,<br><br>
                A password reset was requested for your account.<br><br>
                Your 5-Minute Security Code is:<br>
                <h1 style="color: #27ae60; letter-spacing: 6px; font-family: monospace; background: #f4f4f4; padding: 15px; border-radius: 8px; display: inline-block;">${otpCode}</h1><br>
                <p><i>Note: This code is case-sensitive.</i></p>
                If you did not request this, please secure your account immediately.
            `;

            const isSent = await sendAutoMail(userData.email, "Password Reset Request", "ACCOUNT RECOVERY", emailMessage);

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
            
            const targetEmail = userData.email.toLowerCase();
            const stored = otpStore.get(targetEmail);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetEmail);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetEmail); 
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
  // 3. CORE: PASSWORD RESET (Restricted: SUPERADMIN OR SELF)
  // =========================================================
  router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
      try {
          const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
          const loggedInUserId = req.user?.account_id || req.user?.sub; 
          const targetId = req.params.accountId;

          // 🛡️ SECURITY GATEKEEPER:
          const isSuperAdmin = userRole === 'superadmin';
          const isSelf = String(loggedInUserId) === String(targetId);

          if (!isSuperAdmin && !isSelf) {
              return res.status(403).json({ error: 'Access Denied. You can only reset your own password.' });
          }

          const { password } = req.body;
          if (!password) return res.status(400).json({ error: 'New password is required.' });

          const securePass = hashPassword(password);

          // Try updating resident first
          const { data: resData } = await supabase
              .from('residents_account')
              .update({ 
                  password: securePass,
                  requires_reset: false
              }) 
              .or(`account_id.eq.${targetId},resident_id.eq.${targetId}`)
              .select();

          if (resData && resData.length > 0) {
              return res.json({ success: true, message: 'Password updated successfully.' });
          }

          // If superadmin, try updating official
          if (isSuperAdmin) {
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
          console.error("❌ [CRITICAL RESET ERROR]:", err.message);
          res.status(500).json({ error: 'Database synchronization failed.' });
      }
  });

    // =========================================================
    // 4. PUBLIC: RESET PASSWORD VIA OTP
    // =========================================================
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { email, otp, newPassword } = req.body;
            const identifier = email?.toLowerCase().trim();
            
            const userData = await findUserEmail(identifier);
            if (!userData || !userData.email) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetEmail = userData.email.toLowerCase();
            const stored = otpStore.get(targetEmail);

            if (!stored) return res.status(400).json({ error: 'No active code found. Please request a new one.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetEmail);
                return res.status(400).json({ error: 'Code has expired. Please request a new one.' });
            }

            if (stored.code !== otp.trim()) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetEmail); 
                    return res.status(429).json({ error: 'Too many failed attempts. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            // 🛡️ UPDATE THE CORRECT TABLE BASED ON "WHO IS WHO"
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

            otpStore.delete(targetEmail);

            res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (err) {
            console.error("Public Reset Error:", err.message);
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });
};