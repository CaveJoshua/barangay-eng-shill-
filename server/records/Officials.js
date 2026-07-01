import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { logActivity } from '../lib/Auditlog.js'; 
import { sendAutoMail } from '../lib/Mailer.js'; 

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
    return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

const masterOtpStore = new Map();

// Only "Active" keeps an official's login alive. Everything else revokes access.
const ACTIVE_STATUSES = ['active'];
// Statuses a manager may assign from the directory Status dropdown.
const ASSIGNABLE_STATUSES = ['Active', 'Suspended', 'Resigned', 'End of Term'];

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
                codeHash: hashOtp(otpCode),
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
                if (hashOtp(otp.toUpperCase().trim()) !== record.codeHash) {
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
                    email: email ? email.toLowerCase().trim() : null, // 🛠️ FIX: persist email (was dropped → blank on Profile page)
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

            await logActivity(supabase, req.user?.username || 'System', 'AUTHORIZE_OFFICIAL', `Granted ${position} access to ${full_name}`, req);

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

    // --- 🔁 UPDATE STATUS (Punong Barangay / Superadmin / Barangay Hall) ---
    // The Punong Barangay can reassign an official's status here. Changing it ALSO
    // syncs the linked login account, so a Suspended/Resigned/End-of-Term official
    // loses admin access on their next session refresh — the system "immediately
    // knows" without waiting for a term to lapse. Setting it back to Active restores
    // access. Punong Barangay carries the 'superadmin' role (see getRolePrefix/login).
    router.patch('/officials/:id/status', authenticateToken, checkSessionRole(['barangayhall', 'superadmin']), async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (!status || !ASSIGNABLE_STATUSES.map(s => s.toLowerCase()).includes(String(status).toLowerCase())) {
                return res.status(400).json({ error: `Invalid status. Allowed: ${ASSIGNABLE_STATUSES.join(', ')}.` });
            }

            const { data: official, error: lookupErr } = await supabase
                .from('officials').select('position, full_name').eq('id', id).single();
            if (lookupErr || !official) return res.status(404).json({ error: 'Official not found.' });

            // The Barangay Hall master account is the system anchor — never lock it out.
            if (official.position === 'Barangay Hall') {
                return res.status(403).json({ error: 'System Lock: Master account status cannot be changed.' });
            }

            const isActive = ACTIVE_STATUSES.includes(String(status).toLowerCase());

            // 1. Update the official profile.
            const { data: updated, error: updErr } = await supabase
                .from('officials').update({ status }).eq('id', id).select().single();
            if (updErr) throw updErr;

            // 2. Sync the linked login account so access reflects the new status.
            const { error: acctErr } = await supabase
                .from('officials_accounts')
                .update({ status: isActive ? 'Active' : 'Inactive' })
                .eq('official_id', id);
            if (acctErr) console.warn('[STATUS SYNC] Account access sync failed:', acctErr.message);

            await logActivity(supabase, req.user?.username || 'System', 'UPDATE_OFFICIAL_STATUS', `Set ${official.full_name} → ${status}`, req);
            res.json(updated);
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