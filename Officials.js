import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { logActivity } from './Auditlog.js'; 

// ==========================================
// 🛡️ 1. SECURITY: ZERO TRUST RBAC
// ==========================================
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
        
        if (!userRole || !allowedRoles.includes(userRole)) {
            console.log(`[RBAC REJECTED] Attempted Role="${userRole}", Path=${req.path}`);
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: `Security Policy Violation: Requires [${allowedRoles.join(', ')}].` 
            });
        }
        
        req.validatedRole = userRole;
        next();
    };
};

// ==========================================
// 🏷️ 2. UTILITIES & HELPERS
// ==========================================
const getRolePrefix = (position) => {
    const pos = position.toLowerCase();
    if (pos.includes('super admin')) return 'master'; 
    if (pos.includes('punong')) return 'pb';         
    if (pos.includes('secretary')) return 'sec';
    if (pos.includes('treasurer')) return 'treas';
    if (pos.includes('kagawad')) return 'kag';
    if (pos.includes('sk')) return 'sk';
    return 'staff';
};

const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
};

// In-Memory store for verifying the Super Admin Gmail
const masterOtpStore = new Map();

// ==========================================
// 📧 3. MAILER LOGIC
// ==========================================
const sendVerificationEmail = async (targetEmail, otpCode) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) return false;
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: `"SmartBarangay System" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: '🔒 Verify Barangay Master Account',
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
                    <h2 style="color: #2563eb;">Master Account Verification</h2>
                    <p>A request was made to register this email as the system's Super Admin.</p>
                    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #cbd5e1; text-align: center;">
                        <p style="margin: 0; font-size: 1.2rem;">Verification Code:</p>
                        <h1 style="color: #d97706; letter-spacing: 4px; margin: 10px 0 0 0;">${otpCode}</h1>
                    </div>
                    <p style="color: #ef4444; font-size: 0.9em; font-weight: bold;">
                        ⚠️ If you did not initiate this action, ignore this email immediately.
                    </p>
                </div>
            `
        });
        return true;
    } catch (err) {
        return false;
    }
};

const sendCredentialsEmail = async (targetEmail, position, name, username, plainPassword) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) return false;
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD }
        });

        const isSuperAdmin = position === 'Super Admin';

        await transporter.sendMail({
            from: `"SmartBarangay System" <${process.env.EMAIL_USER}>`,
            to: targetEmail,
            subject: '🔒 System Access: Official Credentials',
            html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 25px; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; color: #1e293b;">
                    <h2 style="color: #2563eb;">SmartBarangay Identity Portal</h2>
                    <p>Authorization granted for role: <strong>${position}</strong>.</p>
                    <p>User Identity: ${isSuperAdmin ? 'BARANGAY MASTER' : name}</p>
                    
                    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #cbd5e1;">
                        <p style="margin: 0;"><strong>Username:</strong> <code style="color: #2563eb;">${username}</code></p>
                        <p style="margin: 10px 0 0 0;"><strong>Temporary Password:</strong> <code style="color: #2563eb;">${plainPassword}</code></p>
                    </div>
                    
                    <p style="color: #ef4444; font-size: 0.9em; font-weight: bold;">
                        ⚠️ SECURITY WARNING: Log in immediately and change this password in Profile Settings.
                    </p>
                </div>
            `
        });
        return true;
    } catch (error) {
        return false;
    }
};

// ==========================================
// 🚀 4. MAIN ROUTER EXPORT
// ==========================================
export const OfficialsRouter = (router, supabase, authenticateToken) => {

    // --- GET ALL OFFICIALS ---
    router.get('/officials', authenticateToken, async (req, res) => {
        try { 
            const { data, error } = await supabase
                .from('officials')
                .select('*')
                .order('position', { ascending: true }); 
            
            if (error) throw error; 
            res.json(data); 
        } catch (err) { 
            res.status(500).json({ error: err.message }); 
        }
    });

    // --- SMART PROFILE FETCH ---
    router.get('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            const trueId = req.user?.account_id || req.user?.record_id || req.user?.sub;
            const { data: account } = await supabase
                .from('officials_accounts')
                .select('official_id, role, username, theme_preference')
                .eq('account_id', trueId)
                .single();

            if (!account) return res.status(404).json({ error: "Account not found." });

            const { data: profile, error: profError } = await supabase
                .from('officials')
                .select('*')
                .eq('id', account.official_id)
                .single();

            if (profError || !profile) return res.status(404).json({ error: "Profile missing." });

            res.json({ 
                ...profile, 
                email: profile.email || account.username, 
                role: account.role,
                theme_preference: account.theme_preference 
            });
        } catch (err) {
            res.status(500).json({ error: "Server Error" });
        }
    });

    // --- 🛡️ REQUEST MASTER OTP ---
    router.post('/officials/request-otp', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try {
            const { email } = req.body;
            if (!email) return res.status(400).json({ error: "Email is required for Master Account verification." });

            const otpCode = generateSecureCode(6);
            const traceId = crypto.randomUUID();

            masterOtpStore.set(traceId, {
                code: otpCode,
                email: email.toLowerCase().trim(),
                expires: Date.now() + 300000, // 5 mins
                attempts: 0
            });

            const sent = await sendVerificationEmail(email, otpCode);
            if (!sent) throw new Error("Mailer failed to dispatch code.");

            res.status(200).json({ success: true, trace_id: traceId });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // --- ADD OFFICIAL & GENERATE ACCOUNT ---
    router.post('/officials', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try {
            const { full_name, position, term_start, term_end, status, contact_number, otp, trace_id } = req.body;
            const isSuperAdmin = position === 'Super Admin';

            // 🛡️ VERIFY OTP FOR SUPER ADMIN
            if (isSuperAdmin) {
                if (!otp || !trace_id) {
                    return res.status(400).json({ error: 'Verification code required for Master Account.' });
                }

                const record = masterOtpStore.get(trace_id);
                if (!record || record.email !== full_name.toLowerCase().trim()) {
                    return res.status(403).json({ error: 'Invalid or missing handshake session.' });
                }
                if (Date.now() > record.expires) {
                    masterOtpStore.delete(trace_id);
                    return res.status(400).json({ error: 'Verification code expired.' });
                }
                if (record.code !== otp.toUpperCase().trim()) {
                    record.attempts += 1;
                    if (record.attempts >= 3) masterOtpStore.delete(trace_id);
                    return res.status(401).json({ error: 'Invalid verification code.' });
                }

                // OTP Validated, destroy trace
                masterOtpStore.delete(trace_id);
            }

            // 1. Insert into Identity Table
            const { data: profile, error: profileError } = await supabase
                .from('officials')
                .insert([{
                    full_name, // Gmail if Super Admin
                    position,
                    term_start: isSuperAdmin ? null : (term_start || null),
                    term_end: isSuperAdmin ? null : (term_end || null), 
                    status: status || 'Active',
                    contact_number: isSuperAdmin ? null : contact_number
                }])
                .select().single();

            if (profileError) throw profileError;

            let finalUsername = "";
            let plainPassword = "";
            let systemRole = "";

            if (isSuperAdmin) {
                // 🏛️ MASTER BARANGAY HALL LOGIC
                finalUsername = full_name.toLowerCase().trim();
                const emailPrefix = finalUsername.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
                plainPassword = `${emailPrefix}123456`;
                systemRole = 'superadmin';
            } else {
                // 👔 STANDARD OFFICIAL LOGIC
                const nameParts = profile.full_name.trim().split(/\s+/);
                const firstName = nameParts[0].toLowerCase();
                const prefix = getRolePrefix(position); 

                const fI = nameParts[0] ? nameParts[0][0].toLowerCase() : 'x';
                const mI = nameParts.length >= 3 ? nameParts[1][0].toLowerCase() : 'x';
                const lI = nameParts[nameParts.length - 1][0].toLowerCase();
                const initials = `${fI}${mI}${lI}`;

                const { count } = await supabase.from('officials_accounts').select('*', { count: 'exact', head: true });
                finalUsername = `${initials}${String((count || 0) + 1).padStart(3, '0')}@${prefix}.officials.eng-hill.brg.ph`;
                
                plainPassword = `${firstName}123456`;
                systemRole = position.toLowerCase().includes('punong') ? 'superadmin' : 'admin';
            }

            // 2. Insert into Accounts Table
            const { error: accountError } = await supabase
                .from('officials_accounts')
                .insert([{
                    official_id: profile.id,
                    username: finalUsername,
                    password: bcrypt.hashSync(plainPassword, 10),
                    role: systemRole,
                    status: 'Active'
                }]);

            if (accountError) throw accountError;

            await logActivity(supabase, req.user?.username || 'System', 'ADD_OFFICIAL', `Authorized ${full_name} as ${position}`);

            // 3. Dispatch Email for Gmail Accounts
            let emailSent = false;
            if (isSuperAdmin) {
                emailSent = await sendCredentialsEmail(full_name, position, profile.full_name, finalUsername, plainPassword);
            }

            res.status(201).json({ 
                ...profile, 
                account: { 
                    username: finalUsername, 
                    password: plainPassword,
                    emailDelivered: emailSent 
                } 
            });

        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // --- UPDATE OFFICIAL ---
    router.put('/officials/:id', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { full_name, position, term_start, term_end, status, contact_number } = req.body; 
            const isSuperAdmin = position === 'Super Admin';
            
            const updates = { 
                full_name, 
                position, 
                term_start: isSuperAdmin ? null : (term_start || null), 
                term_end: isSuperAdmin ? null : (term_end || null), 
                status: status || 'Active', 
                contact_number: isSuperAdmin ? null : contact_number 
            };

            const { data, error } = await supabase.from('officials').update(updates).eq('id', id).select(); 

            if (error) throw error; 
            res.json(data[0]); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });

    // --- SOFT ARCHIVE (MASTER LOCK PROTECTION) ---
    router.delete('/officials/:id', authenticateToken, checkSessionRole(['superadmin']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { data: official } = await supabase.from('officials').select('position').eq('id', id).single();
            
            if (official?.position === 'Super Admin') {
                return res.status(403).json({ error: 'Lockout: The primary Barangay Hall account cannot be archived.' });
            }
            
            await supabase
                .from('officials')
                .update({ status: 'End of Term', term_end: new Date().toISOString().split('T')[0] })
                .eq('id', id); 
                
            res.json({ message: 'Personnel identity archived.' }); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });
};