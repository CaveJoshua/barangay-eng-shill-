import bcrypt from 'bcryptjs';
import { sendAutoMail } from './Mailer.js'; 

// --- OTP Memory Storage ---
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
    // 🧠 SMART LOOKUP HELPER
    // =========================================================
    const findUserEmail = async (identifier) => {
        const { data: account } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (account) {
            const { data: record } = await supabase
                .from('residents_records')
                .select('email, first_name')
                .eq('record_id', account.resident_id)
                .maybeSingle();
            return record ? { email: record.email, firstName: record.first_name, accountId: account.resident_id } : null;
        }

        const { data: recordByEmail } = await supabase
            .from('residents_records')
            .select('record_id, email, first_name')
            .eq('email', identifier)
            .maybeSingle();

        if (recordByEmail) {
            return { email: recordByEmail.email, firstName: recordByEmail.first_name, accountId: recordByEmail.record_id };
        }
        
        return null;
    };

    // =========================================================
    // 1. GENERATE & SEND SECURE OTP (Public / Residents)
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { email } = req.body; 
            if (!email) return res.status(400).json({ error: 'Identification required.' });
            const identifier = email.toLowerCase().trim();

            const userData = await findUserEmail(identifier);
            if (!userData || !userData.email) {
                return res.status(200).json({ success: true, message: 'If account exists, code sent.' });
            }

            const targetEmail = userData.email.toLowerCase();

            const existingCode = otpStore.get(targetEmail);
            if (existingCode && Date.now() < existingCode.cooldownLimit) {
                return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
            }

            const otpCode = generateSecureCode(6);
            
            otpStore.set(targetEmail, { 
                code: otpCode, 
                expires: Date.now() + 300000, // 5 minutes
                attempts: 0,
                cooldownLimit: Date.now() + 60000 // 60 seconds
            });

            const emailMessage = `
                Hello <b>${userData.firstName || 'Resident'}</b>,<br><br>
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
    // 2. VERIFY OTP (Public / Residents)
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
  // 3. CORE: PASSWORD RESET (Restricted: SUPERADMIN OR THE USER THEMSELVES)
  // =========================================================
  router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
      try {
          const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
          const loggedInUserId = req.user?.account_id || req.user?.sub; // ID from the JWT
          const targetId = req.params.accountId;

          // 🛡️ SECURITY GATEKEEPER:
          // Allow if the user is a Superadmin OR if the user is changing THEIR OWN password
          const isSuperAdmin = userRole === 'superadmin';
          const isSelf = String(loggedInUserId) === String(targetId);

          if (!isSuperAdmin && !isSelf) {
              return res.status(403).json({ error: 'Access Denied. You can only reset your own password.' });
          }

          const { password } = req.body;
          if (!password) return res.status(400).json({ error: 'New password is required.' });

          const securePass = hashPassword(password);

          // Update the Residents Account
          const { data: resData, error: resErr } = await supabase
              .from('residents_account')
              .update({ 
                  password: securePass,
                  requires_reset: false // Automatically clear the first-time login flag
              }) 
              .or(`account_id.eq.${targetId},resident_id.eq.${targetId}`)
              .select();

          if (resData && resData.length > 0) {
              return res.json({ success: true, message: 'Password updated successfully.' });
          }

          // If not a resident, try Officials (only if Superadmin)
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
    // 4. PUBLIC: RESET PASSWORD VIA OTP (Public / Residents)
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
                    return res.status(429).json({ error: 'Too many failed attempts. Code destroyed. Request a new one.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

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

            otpStore.delete(targetEmail);

            res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (err) {
            console.error("Public Reset Error:", err.message);
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });
};