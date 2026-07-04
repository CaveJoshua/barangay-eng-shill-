import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import nodemailer from 'nodemailer'; // 🛡️ ADDED: Nodemailer Import
import { sendAutoMail } from '../lib/Mailer.js';
import { sendSms, normalizePhNumber } from '../lib/Sms.js';
import { RateLimiterMemory } from 'rate-limiter-flexible';

// =========================================================
// 🛡️ RATE LIMITERS (Tiered Token Bucket)
// =========================================================

const burstLimiter = new RateLimiterMemory({ points: 3, duration: 60, blockDuration: 60 });
const dailyLimiter = new RateLimiterMemory({ points: 10, duration: 60 * 60 * 24, blockDuration: 60 * 60 * 24 });

const otpStore = new Map();

// 🛡️ SECURITY HELPERS
const hashPassword = (plain) => plain ? bcrypt.hashSync(plain, 10) : null;

const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars[crypto.randomInt(0, chars.length)];
    }
    return result;
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

export const AccountManagementRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // 🧠 SMART LOOKUP HELPER 
    // =========================================================
    const findUserEmail = async (identifier) => {
        // --- 1. CHECK RESIDENTS ---
        const { data: resAuth } = await supabase
            .from('residents_account')
            .select('resident_id, username')
            .eq('username', identifier)
            .maybeSingle();

        if (resAuth) {
            const { data: resProfile } = await supabase.from('residents_records').select('email, first_name, contact_number').eq('record_id', resAuth.resident_id).maybeSingle();
            return resProfile ? { email: resProfile.email, contactNumber: resProfile.contact_number, firstName: resProfile.first_name, accountId: resAuth.resident_id, role: 'resident' } : null;
        }

        const { data: resProfileByEmail } = await supabase.from('residents_records').select('record_id, email, first_name, contact_number').eq('email', identifier).maybeSingle();
        if (resProfileByEmail) return { email: resProfileByEmail.email, contactNumber: resProfileByEmail.contact_number, firstName: resProfileByEmail.first_name, accountId: resProfileByEmail.record_id, role: 'resident' };

        // --- 2. CHECK OFFICIALS / ADMINS ---
        const { data: offAuth } = await supabase.from('officials_accounts').select('account_id, official_id, username').eq('username', identifier).maybeSingle();
        if (offAuth) {
            const { data: offProfile } = await supabase.from('officials').select('email, full_name, contact_number').eq('id', offAuth.official_id).maybeSingle();
            return offProfile ? { email: offProfile.email, contactNumber: offProfile.contact_number, firstName: offProfile.full_name, accountId: offAuth.account_id, role: 'official' } : null;
        }

        const { data: offProfileByEmail } = await supabase.from('officials').select('id, email, full_name, contact_number').eq('email', identifier).maybeSingle();
        if (offProfileByEmail) {
            const { data: offAuthByEmail } = await supabase.from('officials_accounts').select('account_id').eq('official_id', offProfileByEmail.id).maybeSingle();
            if (offAuthByEmail) return { email: offProfileByEmail.email, contactNumber: offProfileByEmail.contact_number, firstName: offProfileByEmail.full_name, accountId: offAuthByEmail.account_id, role: 'official' };
        }

        return null;
    };

    // =========================================================
    // 1. PUBLIC ENDPOINT: Request OTP
    // POST /api/accounts/request-otp
    // =========================================================
    router.post('/accounts/request-otp', async (req, res) => {
        try {
            const { identifier, useFallback = false, viaPhone = false } = req.body;
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
            const identifierNorm = identifier?.toLowerCase().trim();
            
            if (!identifierNorm) return res.status(400).json({ error: 'Identification required.' });

            const limitKey = `${clientIp}_${identifierNorm}`;
            try {
                await dailyLimiter.consume(limitKey, 1);
                await burstLimiter.consume(limitKey, 1);
            } catch (rejRes) {
                const secsToWait = Math.round(rejRes.msBeforeNext / 1000) || 60;
                return res.status(429).json({ error: `Too many requests. Please wait ${secsToWait} seconds.` });
            }

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(404).json({ error: 'Account not found. Please check your details.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            let destinationEmail = userData.email?.toLowerCase();
            let destinationPhone = null;

            if (viaPhone) {
                destinationPhone = normalizePhNumber(userData.contactNumber);
                if (!destinationPhone) return res.status(400).json({ error: 'No valid phone number registered for this account.' });
            } else if (useFallback) {
                const { data: hallData } = await supabase.from('officials').select('email').eq('position', 'Barangay Hall').limit(1).maybeSingle();
                if (hallData && hallData.email) destinationEmail = hallData.email.toLowerCase();
                else if (process.env.ROOT_EMAIL) destinationEmail = process.env.ROOT_EMAIL.toLowerCase();
                else return res.status(500).json({ error: 'System Error: Master Email is not configured.' });
            } else if (!destinationEmail) {
                return res.status(400).json({ error: 'No personal email registered. Please use the Fallback option.' });
            }

            const otpCode = generateSecureCode(6);
            otpStore.set(targetMapKey, { codeHash: hashOtp(otpCode), expires: Date.now() + 300000, attempts: 0 });

            // 📱 SMS CHANNEL — bypasses the email transports entirely
            if (viaPhone) {
                const smsSent = await sendSms(destinationPhone, `Barangay Engineer's Hill: Your password reset code is ${otpCode}. It expires in 5 minutes. Do not share this code.`);
                if (!smsSent) return res.status(500).json({ error: 'Failed to dispatch SMS. Verify the SMS provider is configured.' });
                return res.status(200).json({ success: true, message: 'Security code dispatched via SMS.' });
            }

            // Prepare Email Payload
            let subjectLine = useFallback ? "URGENT: Fallback Account Recovery Request" : "Password Reset Request";

            let emailMessage = useFallback
                ? `An emergency password reset was requested for <b>${userData.firstName}</b>.<br><br>The 5-Minute Security Code is: <br><br><span style="font-size: 24px; font-weight: bold; background: #f1f5f9; padding: 10px; letter-spacing: 4px;">${otpCode}</span><br><br>STRICTLY DO NOT SHARE THIS CODE WITH ANYONE TO PREVENT UNAUTHORIZED ACCESS AND COMPROMISE.`
                : `Hello <b>${userData.firstName}</b>,<br><br>A password reset was requested for your account. Your 5-Minute Security Code is:<br><br><span style="font-size: 24px; font-weight: bold; background: #f1f5f9; padding: 10px; letter-spacing: 4px;">${otpCode}</span><br><br>If you did not request this, please secure your account immediately.`;

            let isSent = false;

            // 📩 ATTEMPT 1: Primary Mailer (Resend API)
            try {
                isSent = await sendAutoMail(destinationEmail, subjectLine, "ACCOUNT RECOVERY", emailMessage);
            } catch (resendErr) {
                console.warn("[MAILER] Resend API failed, preparing to use fallback...", resendErr.message);
            }

            // 🔁 ATTEMPT 2: Fallback Mailer (Nodemailer SMTP)
            if (!isSent) {
                // Failsafe check: ensures you don't crash if SMTP env vars aren't set yet
                if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
                    try {
                        const transporter = nodemailer.createTransport({
                            host: process.env.SMTP_HOST,
                            port: process.env.SMTP_PORT || 587,
                            secure: process.env.SMTP_PORT == 465,
                            auth: {
                                user: process.env.SMTP_USER,
                                pass: process.env.SMTP_PASS,
                            },
                        });

                        const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@engineer-hill.gov.ph";

                        await transporter.sendMail({
                            from: `"Barangay Engineer's Hill" <${smtpFrom}>`,
                            to: destinationEmail,
                            subject: subjectLine,
                            html: `
                                <div style="font-family: sans-serif; max-width: 600px; margin: auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
                                    <h2 style="color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px;">ACCOUNT RECOVERY</h2>
                                    <p style="font-size: 16px; color: #34495e; line-height: 1.6;">${emailMessage}</p>
                                </div>
                            `
                        });

                        isSent = true;
                        console.log(`[MAILER] Nodemailer successfully sent fallback email to ${destinationEmail}`);
                    } catch (smtpErr) {
                        console.error("[MAILER ERROR] Nodemailer fallback also failed:", smtpErr.message);
                    }
                } else {
                    console.warn("[MAILER WARNING] Nodemailer fallback skipped: SMTP credentials are not configured in environment variables.");
                }
            }

            // Final gate check
            if (!isSent) return res.status(500).json({ error: 'Failed to dispatch email via Resend API and SMTP fallback.' });

            return res.status(200).json({ success: true, message: 'Security code dispatched.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 2. PUBLIC ENDPOINT: Verify OTP
    // POST /api/accounts/verify-otp
    // =========================================================
    router.post('/accounts/verify-otp', async (req, res) => {
        try {
            const { identifier, otp } = req.body;
            const identifierNorm = identifier?.toLowerCase().trim();

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(400).json({ error: 'Invalid verification target.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored) return res.status(400).json({ error: 'No active code found.' });
            if (Date.now() > stored.expires) {
                otpStore.delete(targetMapKey);
                return res.status(400).json({ error: 'Code has expired.' });
            }

            if (hashOtp((otp || '').trim()) !== stored.codeHash) {
                stored.attempts += 1;
                if (stored.attempts >= 3) {
                    otpStore.delete(targetMapKey);
                    return res.status(429).json({ error: 'Too many failed attempts.' });
                }
                return res.status(400).json({ error: `Invalid code. ${3 - stored.attempts} attempts remaining.` });
            }

            stored.verified = true;
            return res.status(200).json({ success: true, message: 'Identity verified.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 3. PUBLIC ENDPOINT: Public Reset
    // POST /api/accounts/public-reset
    // =========================================================
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { identifier, otp, newPassword } = req.body;
            const identifierNorm = identifier?.toLowerCase().trim();

            if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored || !stored.verified) return res.status(400).json({ error: 'OTP not verified or expired.' });

            if (userData.role === 'official') {
                const { error } = await supabase.from('officials_accounts').update({ password: hashPassword(newPassword) }).eq('account_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
            } else {
                const { error } = await supabase.from('residents_account').update({ password: hashPassword(newPassword) }).eq('resident_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
                await supabase.from('residents_account').update({ requires_reset: false }).eq('resident_id', userData.accountId);
            }

            otpStore.delete(targetMapKey);
            return res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });

    // =========================================================
    // 4. AUTHENTICATED RESET (Admin Dashboard / First-time reset)
    // PATCH /api/accounts/reset/:accountId
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

            if (isAdmin && !isSelf) {
                if (!otp) return res.status(400).json({ error: 'Security verification code is required.' });

                let targetMapKey = null;

                const { data: resAccRow } = await supabase.from('residents_account').select('resident_id').eq('account_id', targetId).maybeSingle();

                if (resAccRow?.resident_id) {
                    const { data: resRecord } = await supabase.from('residents_records').select('email').eq('record_id', resAccRow.resident_id).maybeSingle();
                    targetMapKey = resRecord?.email || resAccRow.resident_id;
                } else {
                    const { data: offAuth } = await supabase.from('officials_accounts').select('official_id').eq('account_id', targetId).maybeSingle();
                    if (offAuth) {
                        const { data: offData } = await supabase.from('officials').select('email').eq('id', offAuth.official_id).maybeSingle();
                        targetMapKey = offData?.email ? offData.email : targetId;
                    }
                }

                if (!targetMapKey) return res.status(404).json({ error: 'Target account corrupted.' });

                const mapKey = String(targetMapKey).toLowerCase();
                const stored = otpStore.get(mapKey);
                if (!stored) return res.status(400).json({ error: 'No active verification code found.' });
                if (Date.now() > stored.expires) {
                    otpStore.delete(mapKey);
                    return res.status(400).json({ error: 'Verification code expired.' });
                }
                if (hashOtp(otp.trim()) !== stored.codeHash) {
                    stored.attempts += 1;
                    if (stored.attempts >= 3) otpStore.delete(mapKey);
                    return res.status(401).json({ error: 'Invalid verification code.' });
                }
                otpStore.delete(mapKey);
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
};