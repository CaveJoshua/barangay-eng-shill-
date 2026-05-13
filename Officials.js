import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logActivity } from './Auditlog.js'; 
import { sendAutoMail } from './Mailer.js'; 

// ==========================================
// 🛡️ 1. SECURITY: ZERO TRUST RBAC
// ==========================================
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
        
        if (!userRole || !allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: `Security Policy Violation: Requires [${allowedRoles.join(', ')}].` 
            });
        }
        next();
    };
};

// ==========================================
// 🏷️ 2. UTILITIES
// ==========================================
const getRolePrefix = (position) => {
    const pos = position.toLowerCase();
    if (pos.includes('barangay hall') || pos.includes('super admin')) return 'bh'; 
    if (pos.includes('punong')) return 'pb';         
    if (pos.includes('secretary')) return 'bs';
    if (pos.includes('treasurer')) return 'bt';
    if (pos.includes('kagawad')) return 'bk';
    if (pos.includes('sk')) return 'sk';
    if (pos.includes('health worker')) return 'bhw';
    if (pos.includes('nutrition scholar')) return 'bns';
    return 'staff';
};

const getInitials = (fullName) => {
    if (!fullName) return 'x';
    // Removes special characters like ' from "Engineer's" to keep initials clean
    return fullName
        .trim()
        .replace(/[^a-zA-Z\s]/g, '') 
        .split(/\s+/)
        .map(word => word.charAt(0))
        .join('')
        .toLowerCase();
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

    // --- 🛡️ REQUEST MASTER OTP ---
    router.post('/officials/request-otp', authenticateToken, checkSessionRole(['barangayhall', 'admin', 'superadmin']), async (req, res) => {
        try {
            const { email } = req.body;
            if (!email || !email.includes('@')) return res.status(400).json({ error: "Valid Gmail required." });

            const otpCode = generateSecureCode(6);
            const traceId = crypto.randomUUID();

            masterOtpStore.set(traceId, {
                code: otpCode,
                email: email.toLowerCase().trim(),
                expires: Date.now() + 300000, // 5 mins
                attempts: 0
            });

            const emailBody = `
                <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                    <h2 style="color: #2563eb;">Master Authorization Code</h2>
                    <p>Use the code below to authorize the Barangay Hall Master Account.</p>
                    <h1 style="background: #f8fafc; padding: 15px; text-align: center; letter-spacing: 5px; color: #d97706;">${otpCode}</h1>
                    <p style="color: #64748b; font-size: 12px;">Trace ID: ${traceId}</p>
                </div>
            `;

            await sendAutoMail(email, "🔒 Master Account Verification", "SECURITY SYSTEM", emailBody);
            
            res.status(200).json({ success: true, trace_id: traceId });
        } catch (err) {
            res.status(500).json({ error: "Handshake failure." });
        }
    });

    // --- 👔 ADD OFFICIAL & AUTHORIZE ---
    router.post('/officials', authenticateToken, checkSessionRole(['barangayhall', 'admin', 'superadmin']), async (req, res) => {
        try {
            // 🛡️ THE FIX: Destructure 'email' separately from 'full_name'
            const { full_name, position, term_start, term_end, status, contact_number, otp, trace_id, email } = req.body;
            const isBarangayHall = position === 'Barangay Hall';

            if (isBarangayHall) {
                if (!otp || !trace_id || !email) return res.status(400).json({ error: 'Verification data missing.' });

                const record = masterOtpStore.get(trace_id);
                
                // 🛡️ THE FIX: Check OTP against the 'email' field, not 'full_name'
                if (!record || record.email !== email.toLowerCase().trim()) {
                    return res.status(403).json({ error: 'Invalid security handshake.' });
                }
                if (Date.now() > record.expires) {
                    masterOtpStore.delete(trace_id);
                    return res.status(400).json({ error: 'Code expired.' });
                }
                if (record.code !== otp.toUpperCase().trim()) {
                    record.attempts += 1;
                    if (record.attempts >= 3) masterOtpStore.delete(trace_id);
                    return res.status(401).json({ error: 'Invalid code.' });
                }
                masterOtpStore.delete(trace_id);
            }

            // Create Official Profile
            const { data: profile, error: profileError } = await supabase
                .from('officials')
                .insert([{
                    full_name, // Saves as "Barangay Engineer's Hill" for Hall mode
                    position,
                    term_start: isBarangayHall ? null : (term_start || null),
                    term_end: isBarangayHall ? null : (term_end || null), 
                    status: status || 'Active',
                    contact_number: isBarangayHall ? null : contact_number
                }])
                .select().single();

            if (profileError) throw profileError;

            // Generate Credentials
            const prefix = getRolePrefix(position); 
            const initials = getInitials(full_name); // Results in 'beh' for "Barangay Engineer's Hill"
            
            const { count } = await supabase.from('officials_accounts').select('*', { count: 'exact', head: true });
            const generatedId = `${initials}${String((count || 0) + 1).padStart(3, '0')}`; 
            const finalUsername = `${generatedId}@${prefix}.officials.eng-hill.brg.ph`; 
            
            let plainPassword = "";
            // Super Admin and Punong Barangay get 'superadmin' role
            let systemRole = (isBarangayHall || position.toLowerCase().includes('punong')) ? 'superadmin' : 'admin';

            if (isBarangayHall) {
                plainPassword = `${generatedId}123456`; // beh001123456
            } else {
                const firstName = full_name.trim().split(/\s+/)[0].toLowerCase();
                plainPassword = `${firstName}123456`;
            }

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

            await logActivity(supabase, req.user?.username || 'System', 'AUTHORIZE_OFFICIAL', `Granted ${position} access to ${full_name}`);

            // Send Credentials if it's the Master Account
            if (isBarangayHall) {
                const welcomeMsg = `
                    <h2>System Authorized</h2>
                    <p><b>Account:</b> ${full_name}</p>
                    <p><b>Username:</b> ${finalUsername}</p>
                    <p><b>Password:</b> ${plainPassword}</p>
                    <p style="color: red;">Update password upon first login.</p>
                `;
                await sendAutoMail(email, "🔒 System Credentials: Barangay Hall", "PORTAL AUTH", welcomeMsg);
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
    router.put('/officials/:id', authenticateToken, checkSessionRole(['barangayhall', 'admin', 'superadmin']), async (req, res) => {
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
    router.delete('/officials/:id', authenticateToken, checkSessionRole(['barangayhall', 'superadmin']), async (req, res) => {
        try { 
            const { id } = req.params; 
            const { data: official } = await supabase.from('officials').select('position').eq('id', id).single();
            
            if (official?.position === 'Barangay Hall') {
                return res.status(403).json({ error: 'System Lock: Master account cannot be archived.' });
            }
            
            await supabase.from('officials').update({ status: 'End of Term', term_end: new Date().toISOString().split('T')[0] }).eq('id', id); 
            res.json({ message: 'Personnel identity archived.' }); 
        } catch (err) { 
            res.status(400).json({ error: err.message }); 
        }
    });
};