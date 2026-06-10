import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { buildSchema, NoSchemaIntrospectionCustomRule } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';
import { logActivity } from './Auditlog.js';
import { sendAutoMail } from './Mailer.js';
import { RateLimiterMemory } from 'rate-limiter-flexible';

const ALL_SYSTEM_ROLES = [
    'superadmin', 'admin', 'staff', 'barangayhall', 
    'punongbarangay', 'barangaysecretary', 'secretary', 
    'kagawad', 'barangaykagawad', 
    'skchairperson', 'barangayskchairperson', 
    'treasurer', 'barangaytreasurer', 
    'bhw', 'barangayhealthworker', 
    'resident'
];

const otpStore = new Map();

const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

const otpRateLimiter = new RateLimiterMemory({ points: 3, duration: 60 * 10, blockDuration: 60 * 10 });

const deriveSystemRole = (position) => {
    if (!position) return 'resident';
    const posLower = position.toLowerCase();
    if (posLower.includes('punong') || posLower.includes('super admin') || posLower.includes('barangay hall')) return 'superadmin';
    if (posLower.includes('secretary')) return 'barangaysecretary';
    if (posLower.includes('treasurer')) return 'treasurer';
    if (posLower.includes('kagawad')) return 'kagawad';
    if (posLower.includes('sk') || posLower.includes('youth')) return 'skchairperson';
    if (posLower.includes('health worker') || posLower.includes('bhw')) return 'bhw';
    return 'staff';
};

const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
        if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ error: 'Forbidden', message: `Access Denied.` });
        }
        req.validatedRole = userRole.toLowerCase().trim();
        next();
    };
};

// ── ⚡ GRAPHQL SCHEMA DEFINITION ──
const profileSchema = buildSchema(`
  type Profile {
    id: String
    full_name: String
    username: String
    email: String
    contact_number: String
    role: String
    theme_preference: String
    avatar_url: String
  }

  type StandardResponse {
    success: Boolean!
    message: String
  }

  type Query { 
    getProfile: Profile 
  }

  type Mutation {
    # 🛡️ THE FIX: Returns the Profile object instantly so the frontend doesn't lag
    updateProfile(full_name: String, first_name: String, last_name: String, email: String, contact_number: String, phone: String, avatar_url: String): Profile!
    updateTheme(theme: String!): StandardResponse!
    changePassword(currentPassword: String!, newPassword: String!): StandardResponse!
    
    # 🛡️ OTP security migrated to GraphQL
    requestOtp(email: String!): StandardResponse!
    verifyOtp(email: String!, otp: String!): StandardResponse!
    publicReset(email: String!, otp: String!, newPassword: String!): StandardResponse!
  }
`);

// ── ⚡ GRAPHQL RESOLVERS ──
const profileResolvers = {
    // 1. GET PROFILE
    getProfile: async (args, context) => {
        const { req, supabase } = context;
        // Searches Token payload for ANY recognized identifier
        const targetId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.id || req.user?.sub;
        if (!targetId) throw new Error("Unauthorized");

        let { data: offAcc } = await supabase.from('officials_accounts').select('*').eq('account_id', targetId).maybeSingle();
        if (!offAcc) offAcc = (await supabase.from('officials_accounts').select('*').eq('official_id', targetId).maybeSingle()).data;

        if (offAcc) {
            const { data: profile } = await supabase.from('officials').select('*').eq('id', offAcc.official_id).maybeSingle();
            if (profile) return {
                id: profile.id, 
                full_name: profile.full_name, 
                username: offAcc.username,
                email: profile.email || '', 
                contact_number: profile.contact_number || '',
                role: deriveSystemRole(profile.position), 
                theme_preference: offAcc.theme_preference,
                avatar_url: profile.avatar_url || ''
            };
        }

        let { data: resAcc } = await supabase.from('residents_account').select('*').eq('account_id', targetId).maybeSingle();
        if (!resAcc) resAcc = (await supabase.from('residents_account').select('*').eq('resident_id', targetId).maybeSingle()).data;

        if (resAcc) {
            const { data: profile } = await supabase.from('residents_records').select('*').eq('record_id', resAcc.resident_id).maybeSingle();
            if (profile) return {
                id: profile.record_id, 
                full_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(), 
                username: resAcc.username,
                email: profile.email || '', 
                contact_number: profile.contact_number || '',
                role: 'resident', 
                theme_preference: resAcc.theme_preference || 'light',
                avatar_url: profile.avatar_url || ''
            };
        }
        throw new Error("Profile mapping failed.");
    },

    // 2. UPDATE PROFILE (Zero-Lag Fix + Image Saving)
    updateProfile: async (args, context) => {
        const { req, supabase } = context;
        const { full_name, first_name, last_name, email, contact_number, phone, avatar_url } = args;
        const targetId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.id || req.user?.sub;
        const safePhone = contact_number || phone;

        if (!targetId) throw new Error("Unauthorized");

        let { data: offAcc } = await supabase.from('officials_accounts').select('official_id, username, theme_preference').eq('account_id', targetId).maybeSingle();
        if (!offAcc) offAcc = (await supabase.from('officials_accounts').select('official_id, username, theme_preference').eq('official_id', targetId).maybeSingle()).data;

        if (offAcc) {
            const payload = { full_name, email, contact_number: safePhone };
            if (avatar_url) payload.avatar_url = avatar_url; // 🖼️ Base64 Image string mapped here
            
            const { data: updated } = await supabase.from('officials').update(payload).eq('id', offAcc.official_id).select().single();
            
            // 🛡️ Returns immediate data back to frontend
            return {
                id: updated.id,
                full_name: updated.full_name,
                username: offAcc.username,
                email: updated.email || '',
                contact_number: updated.contact_number || '',
                role: deriveSystemRole(updated.position),
                theme_preference: offAcc.theme_preference,
                avatar_url: updated.avatar_url || ''
            };
        }

        let { data: resAcc } = await supabase.from('residents_account').select('resident_id, username, theme_preference').eq('account_id', targetId).maybeSingle();
        if (!resAcc) resAcc = (await supabase.from('residents_account').select('resident_id, username, theme_preference').eq('resident_id', targetId).maybeSingle()).data;

        if (resAcc) {
            const payload = {
                first_name: first_name || full_name?.split(' ')[0], 
                last_name: last_name || full_name?.split(' ').slice(1).join(' '),
                email: email, 
                contact_number: safePhone 
            };
            if (avatar_url) payload.avatar_url = avatar_url;

            const { data: updated } = await supabase.from('residents_records').update(payload).eq('record_id', resAcc.resident_id).select().single();
            
            return {
                id: updated.record_id,
                full_name: `${updated.first_name || ''} ${updated.last_name || ''}`.trim(),
                username: resAcc.username,
                email: updated.email || '',
                contact_number: updated.contact_number || '',
                role: 'resident',
                theme_preference: resAcc.theme_preference || 'light',
                avatar_url: updated.avatar_url || ''
            };
        }
        throw new Error("Update target not found.");
    },

    // 3. UPDATE THEME
    updateTheme: async ({ theme }, context) => {
        const { req, supabase } = context;
        const targetId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.id || req.user?.sub;
        
        const { data: offAcc } = await supabase.from('officials_accounts').update({ theme_preference: theme }).eq('account_id', targetId).select().maybeSingle();
        if (offAcc) return { success: true, message: "Theme saved." };
        
        await supabase.from('residents_account').update({ theme_preference: theme }).eq('account_id', targetId);
        return { success: true, message: "Theme saved." };
    },

    // 4. CHANGE PASSWORD
    changePassword: async ({ currentPassword, newPassword }, { req, supabase }) => {
        // 🛡️ Server-side strength floor (J-CVE-101203) — don't trust the client alone.
        if (!newPassword || newPassword.length < 8) throw new Error("New password must be at least 8 characters.");

        const targetId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.id || req.user?.sub;
        let { data: acc } = await supabase.from('officials_accounts').select('*').eq('account_id', targetId).maybeSingle();
        if (!acc) acc = (await supabase.from('residents_account').select('*').eq('account_id', targetId).maybeSingle()).data;

        if (!acc || !bcrypt.compareSync(currentPassword, acc.password)) throw new Error("Security mismatch.");
        
        const table = acc.official_id ? 'officials_accounts' : 'residents_account';
        await supabase.from(table).update({ password: bcrypt.hashSync(newPassword, 10) }).eq('account_id', acc.account_id);
        return { success: true, message: "Secure update complete." };
    },

    // 5. GRAPHQL: REQUEST OTP
    requestOtp: async ({ email }, { supabase, req }) => {
        if (!email || !email.includes('@')) throw new Error("Valid email is required.");
        const targetEmail = email.toLowerCase().trim();

        const clientIp = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || 'unknown';
        try {
            await otpRateLimiter.consume(`${clientIp}_${targetEmail}`);
        } catch {
            throw new Error("Too many requests. Please wait before requesting another code.");
        }

        const { data: official } = await supabase.from('officials').select('id').eq('email', targetEmail).maybeSingle();
        const { data: resident } = await supabase.from('residents_records').select('record_id').eq('email', targetEmail).maybeSingle();

        if (!official && !resident) throw new Error("No system account linked to this email was found.");

        const otpCode = generateSecureCode(6);
        otpStore.set(targetEmail, { codeHash: hashOtp(otpCode), expires: Date.now() + 300000, attempts: 0 });

        const emailBody = `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                <h2 style="color: #1d4ed8;">Password Reset Authorization</h2>
                <p>Use the secure code below to reset the password for <b>${targetEmail}</b>.</p>
                <h1 style="background: #f8fafc; padding: 15px; text-align: center; letter-spacing: 5px; color: #d97706;">${otpCode}</h1>
                <p style="color: #64748b; font-size: 12px;">This code expires in exactly 5 minutes.</p>
            </div>
        `;

        await sendAutoMail(targetEmail, "Password Reset OTP", "SECURITY SYSTEM", emailBody);
        return { success: true, message: "OTP sent successfully." };
    },

    // 6. GRAPHQL: VERIFY OTP
    verifyOtp: async ({ email, otp }) => {
        const targetEmail = email.toLowerCase().trim();
        const record = otpStore.get(targetEmail);

        if (!record) throw new Error('Invalid or missing OTP session.');
        if (Date.now() > record.expires) {
            otpStore.delete(targetEmail);
            throw new Error('OTP code expired.');
        }
        if (hashOtp(otp.toUpperCase().trim()) !== record.codeHash) {
            record.attempts += 1;
            if (record.attempts >= 3) otpStore.delete(targetEmail);
            throw new Error('Invalid verification code.');
        }

        record.verified = true;
        return { success: true, message: "OTP Verified." };
    },

    // 7. GRAPHQL: PUBLIC RESET PASSWORD
    publicReset: async ({ email, otp, newPassword }, { supabase }) => {
        const targetEmail = email.toLowerCase().trim();
        const record = otpStore.get(targetEmail);

        if (!record || hashOtp(otp.toUpperCase().trim()) !== record.codeHash || Date.now() > record.expires) {
            throw new Error("Invalid or expired OTP session.");
        }

        const hashedNew = bcrypt.hashSync(newPassword, 10);
        let passwordUpdated = false;

        const { data: official } = await supabase.from('officials').select('id').eq('email', targetEmail).maybeSingle();
        if (official) {
            await supabase.from('officials_accounts').update({ password: hashedNew }).eq('official_id', official.id);
            passwordUpdated = true;
        } else {
            const { data: resident } = await supabase.from('residents_records').select('record_id').eq('email', targetEmail).maybeSingle();
            if (resident) {
                await supabase.from('residents_account').update({ password: hashedNew }).eq('resident_id', resident.record_id);
                passwordUpdated = true;
            }
        }

        if (!passwordUpdated) throw new Error("No system account linked to this email was found.");

        otpStore.delete(targetEmail);
        return { success: true, message: "Password reset completed via OTP." };
    }
};

export const ProfileRouter = (router, supabase, authenticateToken) => {
    // ── GRAPHQL ENDPOINT ──
    router.all('/graphql/profile', authenticateToken, (req, res) => {
        let userRole = req.user?.user_role || req.user?.role || req.user?.account_type || req.user?.type;
        if (!userRole && (req.user?.record_id || req.user?.resident_id || req.user?.sub)) userRole = 'resident';
        if (!userRole || !ALL_SYSTEM_ROLES.includes(userRole.toLowerCase().trim())) {
            return res.status(403).json({ errors: [{ message: 'Forbidden' }]});
        }
        return createHandler({ schema: profileSchema, rootValue: profileResolvers, context: () => ({ req, res, supabase }), validationRules: [NoSchemaIntrospectionCustomRule] })(req, res);
    });

    // ── REST GET FALLBACK (Maintains backward compatibility for Navbar/Sidebars) ──
    router.get('/officials/profile/:id', authenticateToken, async (req, res) => {
        try {
            const tokenId = req.user?.account_id || req.user?.official_id || req.user?.resident_id || req.user?.id || req.user?.sub;
            
            const { data: offAcc } = await supabase.from('officials_accounts').select('*, officials(*)').eq('account_id', tokenId).maybeSingle();
            if (offAcc) return res.json({ ...offAcc.officials, username: offAcc.username, email: offAcc.officials.email || '', role: deriveSystemRole(offAcc.officials.position) });
            
            const { data: resAcc } = await supabase.from('residents_account').select('*, residents_records(*)').eq('account_id', tokenId).maybeSingle();
            if (resAcc) return res.json({ ...resAcc.residents_records, username: resAcc.username, email: resAcc.residents_records.email || '', role: 'resident' });

            res.status(404).json({ error: "Not found" });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });
};