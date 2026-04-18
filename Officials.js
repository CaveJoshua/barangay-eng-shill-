import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logActivity } from './Auditlog.js'; 
import { sendAutoMail } from './Mailer.js'; // 🛡️ Using your proven central mailer

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
// 🏷️ 2. UTILITIES
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

const masterOtpStore = new Map();

// ==========================================
// 🚀 3. MAIN ROUTER EXPORT
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

    // --- 🛡️ REQUEST MASTER OTP (Step 1: Gmail -> Code) ---
    router.post('/officials/request-otp', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try {
            const { email } = req.body;
            if (!email || !email.includes('@')) return res.status(400).json({ error: "Valid Gmail is required for Master Account verification." });

            const otpCode = generateSecureCode(6);
            const traceId = crypto.randomUUID();

            masterOtpStore.set(traceId, {
                code: otpCode,
                email: email.toLowerCase().trim(),
                expires: Date.now() + 600000, // 10 mins
                attempts: 0
            });

            // 📧 DISPATCH CODE
            const emailBody = `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                    <h2 style="color: #2563eb;">Master Authorization Code</h2>
                    <p>Use the code below to authorize <b>${email}</b> as the Super Admin.</p>
                    <h1 style="background: #f8fafc; padding: 15px; text-align: center; letter-spacing: 5px; color: #d97706;">${otpCode}</h1>
                    <p style="color: #64748b; font-size: 12px;">This code expires in 10 minutes. Trace ID: ${traceId}</p>
                </div>
            `;

            const sent = await sendAutoMail(email, "🔒 Master Account Verification", "SECURITY SYSTEM", emailBody);
            
            // 💡 FAIL-SAFE: If Gmail blocks the script, log it to the console so you can still finish the setup!
            if (!sent) {
                console.warn(`⚠️ [MAILER_FAILURE]: Could not send to ${email}. Check your connection.`);
                console.log(`✅ [DEVELOPER_BYPASS]: YOUR VERIFICATION CODE IS: ${otpCode}`);
            }

            res.status(200).json({ 
                success: true, 
                trace_id: traceId,
                message: sent ? "Code sent to Gmail." : "System Handshake Active. Check server console for code." 
            });
        } catch (err) {
            res.status(500).json({ error: "Logical handshake failure." });
        }
    });

    // --- 👔 ADD OFFICIAL & AUTHORIZE (Step 2: Code -> Account) ---
    router.post('/officials', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try {
            const { full_name, position, term_start, term_end, status, contact_number, otp, trace_id } = req.body;
            const isSuperAdmin = position === 'Super Admin';

            // 🛡️ LOGICAL HANDSHAKE VALIDATION
            if (isSuperAdmin) {
                if (!otp || !trace_id) return res.status(400).json({ error: 'Verification code required for Master Account.' });

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
                masterOtpStore.delete(trace_id); // Verification successful
            }

            // 1. Insert Identity Ledger
            const { data: profile, error: profileError } = await supabase
                .from('officials')
                .insert([{
                    full_name,
                    position,
                    term_start: isSuperAdmin ? null : (term_start || null),
                    term_end: isSuperAdmin ? null : (term_end || null), 
                    status: status || 'Active',
                    contact_number: isSuperAdmin ? null : contact_number
                }])
                .select().single();

            if (profileError) throw profileError;

            // 2. Generate Credentials
            let finalUsername = "";
            let plainPassword = "";
            let systemRole = isSuperAdmin ? 'superadmin' : (position.toLowerCase().includes('punong') ? 'superadmin' : 'admin');

            if (isSuperAdmin) {
                finalUsername = full_name.toLowerCase().trim();
                plainPassword = `${finalUsername.split('@')[0]}123456`;
            } else {
                const nameParts = profile.full_name.trim().split(/\s+/);
                const prefix = getRolePrefix(position); 
                const initials = nameParts.map(n => n[0].toLowerCase()).join('').substring(0, 3);
                
                const { count } = await supabase.from('officials_accounts').select('*', { count: 'exact', head: true });
                finalUsername = `${initials}${String((count || 0) + 1).padStart(3, '0')}@${prefix}.officials.brg.ph`;
                plainPassword = `${nameParts[0].toLowerCase()}123456`;
            }

            // 3. Create Secure Account
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

            // 4. Activity Logging
            await logActivity(supabase, req.user?.username || 'System', 'AUTHORIZE_OFFICIAL', `Granted ${position} access to ${full_name}`);

            // 5. Dispatch Welcome Email (Only for Super Admin)
            if (isSuperAdmin) {
                const welcomeMsg = `
                    <h2>Welcome to the System Portal</h2>
                    <p>Your Super Admin account has been authorized.</p>
                    <p><b>Username:</b> ${finalUsername}</p>
                    <p><b>Password:</b> ${plainPassword}</p>
                    <p style="color: red;">Log in immediately and update your password.</p>
                `;
                await sendAutoMail(full_name, "🔒 System Authorized: Super Admin Credentials", "PORTAL AUTH", welcomeMsg);
            }

            res.status(201).json({ 
                ...profile, 
                account: { username: finalUsername, password: plainPassword } 
            });

        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // --- UPDATE OFFICIAL ---
    router.put('/officials/:id', authenticateToken, checkSessionRole(['superadmin', 'admin']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const updates = req.body;
            const { data, error } = await supabase.from('officials').update(updates).eq('id', id).select(); 
            if (error) throw error; 
            res.json(data[0]); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });

    // --- ARCHIVE OFFICIAL ---
    router.delete('/officials/:id', authenticateToken, checkSessionRole(['superadmin']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { data: official } = await supabase.from('officials').select('position').eq('id', id).single();
            
            if (official?.position === 'Super Admin') {
                return res.status(403).json({ error: 'System Lock: Master account cannot be archived.' });
            }
            
            await supabase.from('officials').update({ status: 'End of Term', term_end: new Date().toISOString().split('T')[0] }).eq('id', id); 
            res.json({ message: 'Personnel identity archived.' }); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });
};