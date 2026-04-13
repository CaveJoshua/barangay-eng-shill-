import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // 🛡️ NEW: Native Node module for cryptographic hashing
import { z } from 'zod';
import { logActivity } from './Auditlog.js'; 

// =========================================================
// 🛡️ 1. ZOD SCHEMA VALIDATION
// =========================================================

// THE GENESIS SCHEMA (Used only for Initial Registration)
const residentCreationSchema = z.object({
    FIRST_NAME: z.string().min(2, "First name must be at least 2 characters"),
    LAST_NAME: z.string().min(2, "Last name must be at least 2 characters"),
    MIDDLE_NAME: z.string().optional().nullable(),
    DOB: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date format" }),
    SEX: z.enum(['Male', 'Female', 'Other']).optional(),
    BIRTH_PLACE: z.string().optional().nullable(),
    BIRTH_COUNTRY: z.string().optional().nullable(),
    // Temporal fields allowed on creation
    EMAIL: z.string().email("Invalid email format").optional().nullable(),
    CONTACT_NUMBER: z.string().transform(val => val.replace(/\D/g, '')).optional().nullable(),
}).passthrough();

// THE TEMPORAL SCHEMA (Used for Updates)
// 🚨 Notice how First Name, Last Name, DOB, and Sex are completely omitted. 
// If a client tries to send them in a PUT request, Zod will strip them out.
const residentUpdateSchema = z.object({
    EMAIL: z.string().email("Invalid email format").optional().nullable(),
    CONTACT_NUMBER: z.string().transform(val => val.replace(/\D/g, '')).optional().nullable(),
    CURRENT_ADDRESS: z.string().optional().nullable(),
    PUROK: z.string().optional().nullable(),
    CIVIL_STATUS: z.string().optional().nullable(),
    EDUCATION: z.string().optional().nullable(),
    EMPLOYMENT: z.string().optional().nullable(),
    EMPLOYMENT_STATUS: z.string().optional().nullable(),
    OCCUPATION: z.string().optional().nullable(),
    RELIGION: z.string().optional().nullable(),
    // IDs and Flags
    IS_VOTER: z.boolean().optional(),
    IS_PWD: z.boolean().optional(),
    IS_4PS: z.boolean().optional(),
    IS_SOLO_PARENT: z.boolean().optional(),
    IS_SENIOR_CITIZEN: z.boolean().optional(),
    IS_IP: z.boolean().optional(),
}).passthrough();

// Middleware to enforce Zod validation
const validatePayload = (schema) => (req, res, next) => {
    try {
        req.body = schema.parse(req.body);
        next();
    } catch (error) {
        return res.status(400).json({
            error: "Validation Failed",
            details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
        });
    }
};

// =========================================================
// 🛡️ 2. CRYPTOGRAPHIC IDENTITY ENGINE
// =========================================================
const generateGenesisHash = (fName, mName, lName, dob) => {
    // Normalizing data to prevent accidental hash mismatches due to casing
    const normalizedString = `${fName?.trim().toLowerCase()}|${mName?.trim().toLowerCase()}|${lName?.trim().toLowerCase()}|${dob}`.replace(/\s+/g, '');
    return crypto.createHash('sha256').update(normalizedString).digest('hex');
};

// =========================================================
// 🛡️ 3. ZERO TRUST RBAC MIDDLEWARE
// =========================================================
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.user_role || req.user?.role;
        
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase())) {
            console.warn(`[RBAC REJECTED] Role: ${userRole}, Path: ${req.path}`);
            return res.status(403).json({ 
                error: 'Forbidden', 
                message: 'Security Policy: Insufficient Permissions.' 
            });
        }
        next();
    };
};

export const ResidentsRecordRouter = (router, supabase, authenticateToken) => {
    
    // =========================================================
    // 🧠 4. SMARTER ANTI-DUPLICATE ENGINE
    // =========================================================
    const checkDuplicates = async (payload, excludeRecordId = null) => {
        const email = payload.EMAIL?.trim().toLowerCase();
        const phone = payload.CONTACT_NUMBER; 
        const fName = payload.FIRST_NAME?.trim().toLowerCase();
        const lName = payload.LAST_NAME?.trim().toLowerCase();
        const mName = payload.MIDDLE_NAME?.trim().toLowerCase() || '';

        const orConditions = [];
        if (email) orConditions.push(`email.ilike.${email}`);
        if (phone) orConditions.push(`contact_number.eq.${phone}`);
        if (fName && lName) orConditions.push(`and(first_name.ilike.${fName},last_name.ilike.${lName})`);

        if (orConditions.length === 0) return null; 

        let query = supabase.from('residents_records')
            .select('record_id, email, contact_number, first_name, middle_name, last_name')
            .neq('activity_status', 'Archived')
            .or(orConditions.join(','));

        if (excludeRecordId) query = query.neq('record_id', excludeRecordId);

        const { data, error } = await query;
        if (error) throw new Error(`Database Error: ${error.message}`);
        if (!data || data.length === 0) return null; 

        for (const record of data) {
            if (email && record.email?.toLowerCase() === email) {
                return `The email address '${payload.EMAIL}' is already in use.`;
            }
            if (phone && record.contact_number?.replace(/\D/g, '') === phone) {
                return `The contact number '${payload.CONTACT_NUMBER}' is already registered.`;
            }
            if (fName && lName && 
                record.first_name?.toLowerCase() === fName && 
                record.last_name?.toLowerCase() === lName) {
                
                const dbMiddle = record.middle_name?.toLowerCase() || '';
                if (dbMiddle === mName) {
                    return `A resident named ${payload.FIRST_NAME} ${payload.LAST_NAME} already exists.`;
                }
            }
        }
        return null;
    };

    // =========================================================
    // ROUTES
    // =========================================================
    
    // FETCH ALL
    router.get('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('residents_records')
                .select('*')
                .neq('activity_status', 'Archived')
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            res.status(200).json(data);
        } catch (err) {
            console.error("Fetch Error:", err.message);
            res.status(500).json({ error: "Failed to retrieve residents list." });
        }
    });

    // FETCH SINGLE
    router.get('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { data, error } = await supabase.from('residents_records').select('*').eq('record_id', req.params.id).single(); 
            if (error) throw error;

            // 🛡️ Data Integrity Check: Verify Hash matches Current Data
            const currentHash = generateGenesisHash(data.first_name, data.middle_name, data.last_name, data.dob);
            if (data.genesis_hash && data.genesis_hash !== currentHash) {
                 console.error(`[SECURITY ALERT] Identity tamper detected on record ${data.record_id}`);
                 // Note: You can choose to alert the admin here or append a warning flag to the response
            }

            res.status(200).json(data);
        } catch (err) {
            res.status(404).json({ error: 'Identity not found.' });
        }
    });

    // POST: CREATION (IMMUTABLE GENESIS)
    router.post('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentCreationSchema), async (req, res) => {
        try {
            const r = req.body;

            const duplicateError = await checkDuplicates(r);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

            // 🛡️ Generate the Immutable Identity Hash
            const genesisHash = generateGenesisHash(r.FIRST_NAME, r.MIDDLE_NAME, r.LAST_NAME, r.DOB);

            // Step A: Insert Profile
            const { data: profile, error: profileError } = await supabase
                .from('residents_records')
                .insert([{
                    first_name: r.FIRST_NAME, 
                    middle_name: r.MIDDLE_NAME,
                    last_name: r.LAST_NAME,
                    sex: r.SEX,
                    dob: r.DOB,
                    birth_country: r.BIRTH_COUNTRY || 'PHILIPPINES',
                    birth_province: r.BIRTH_PROVINCE,
                    birth_city: r.BIRTH_CITY,
                    birth_place: r.BIRTH_PLACE, 
                    genesis_hash: genesisHash, // 👈 NOTE: You must add 'genesis_hash' (text) to your Supabase table
                    // Temporal Fields
                    nationality: r.NATIONALITY,
                    religion: r.RELIGION,
                    contact_number: r.CONTACT_NUMBER, 
                    email: r.EMAIL,
                    current_address: r.CURRENT_ADDRESS,
                    purok: r.PUROK,
                    civil_status: r.CIVIL_STATUS, 
                    education: r.EDUCATION,
                    employment: r.EMPLOYMENT,
                    employment_status: r.EMPLOYMENT_STATUS,
                    occupation: r.OCCUPATION,
                    is_voter: r.IS_VOTER,
                    is_pwd: r.IS_PWD,
                    is_4ps: r.IS_4PS,
                    is_solo_parent: r.IS_SOLO_PARENT,
                    is_senior_citizen: r.IS_SENIOR_CITIZEN,
                    is_ip: r.IS_IP,
                    voter_id_number: r.VOTER_ID_NUMBER, 
                    pwd_id_number: r.PWD_ID_NUMBER,
                    solo_parent_id_number: r.SOLO_PARENT_ID_NUMBER,
                    senior_id_number: r.SENIOR_ID_NUMBER,
                    four_ps_id_number: r.FOUR_PS_ID_NUMBER,
                    activity_status: 'Active'
                }])
                .select().single();

            if (profileError) throw profileError;

            // Step B: Auto-generate secure credentials
            const username = `${profile.first_name[0]}${(profile.middle_name?.[0] || '')}${profile.last_name[0]}${Math.floor(100+Math.random()*900)}@residents.eng-hill.brg.ph`.toLowerCase();
            const rawPassword = `${profile.first_name.toLowerCase().replace(/\s/g, '')}123456`;
            const hashedPassword = bcrypt.hashSync(rawPassword, 10);

            const { error: accError } = await supabase.from('residents_account').insert([{
                resident_id: profile.record_id,
                username: username,
                password: hashedPassword,
                role: 'resident',
                status: 'Active'
            }]);

            if (accError) console.error("Auto-Account Failed:", accError.message);

            logActivity(supabase, req.user.username, 'RESIDENT_CREATED', `Added: ${profile.first_name} ${profile.last_name} | Hash: ${genesisHash.substring(0, 8)}...`).catch(console.error);

            res.status(201).json({ profile, account: { username, password: rawPassword } });

        } catch (err) {
            console.error("Registration Failure:", err.message);
            res.status(500).json({ error: err.message || "System failed to register resident." });
        }
    });

    // PUT: UPDATE (STRICTLY TEMPORAL)
    // 🛡️ Notice we use residentUpdateSchema, which strips out First Name, Last Name, and DOB.
    router.put('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentUpdateSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;

            const duplicateError = await checkDuplicates(r, id);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

            // Create updates object directly from validated Zod payload
            const updates = {
                contact_number: r.CONTACT_NUMBER,
                email: r.EMAIL,
                current_address: r.CURRENT_ADDRESS,
                purok: r.PUROK,
                civil_status: r.CIVIL_STATUS,
                education: r.EDUCATION,
                employment: r.EMPLOYMENT,
                employment_status: r.EMPLOYMENT_STATUS,
                occupation: r.OCCUPATION,
                religion: r.RELIGION,
                is_voter: r.IS_VOTER,
                is_pwd: r.IS_PWD,
                is_4ps: r.IS_4PS,
                is_solo_parent: r.IS_SOLO_PARENT,
                is_senior_citizen: r.IS_SENIOR_CITIZEN,
                is_ip: r.IS_IP,
                voter_id_number: r.VOTER_ID_NUMBER,
                pwd_id_number: r.PWD_ID_NUMBER,
                solo_parent_id_number: r.SOLO_PARENT_ID_NUMBER,
                senior_id_number: r.SENIOR_ID_NUMBER,
                four_ps_id_number: r.FOUR_PS_ID_NUMBER,
            };

            // Clean undefined values
            Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

            const { data, error } = await supabase.from('residents_records').update(updates).eq('record_id', id).select();
            if (error) throw error;
            
            logActivity(supabase, req.user.username, 'RESIDENT_UPDATED', `Updated Temporal Data for ID: ${id}`).catch(console.error);
            res.json(data[0]);
        } catch (err) {
            console.error("Update Error:", err.message);
            res.status(500).json({ error: "Failed to update record." });
        }
    });

    // DELETE: ARCHIVE
    router.delete('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const { error } = await supabase.from('residents_records').update({ activity_status: 'Archived' }).eq('record_id', req.params.id);
            if (error) throw error;

            logActivity(supabase, req.user.username, 'RESIDENT_ARCHIVED', `Archived ID: ${req.params.id}`).catch(console.error);
            res.json({ message: 'Identity Archived Successfully' });
        } catch (err) {
            res.status(500).json({ error: "Archive failed." });
        }
    });
};