import bcrypt from 'bcryptjs';
import crypto from 'crypto'; // 🛡️ Native Node module for SHA-256 Hashing
import { z } from 'zod';
import { logActivity } from './Auditlog.js'; 

// =========================================================
// 🛡️ 1. ZOD SCHEMA VALIDATION (STRICT IMMUTABILITY)
// =========================================================

// GENESIS SCHEMA: Used only for Initial Registration
const residentCreationSchema = z.object({
    FIRST_NAME: z.string().min(2, "First name must be at least 2 characters"),
    LAST_NAME: z.string().min(2, "Last name must be at least 2 characters"),
    MIDDLE_NAME: z.string().optional().nullable(),
    DOB: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date format" }),
    SEX: z.enum(['Male', 'Female', 'Other']).optional(),
    // Temporal fields allowed on creation
    EMAIL: z.string().email("Invalid email format").optional().nullable(),
    CONTACT_NUMBER: z.string().transform(val => val.replace(/\D/g, '')).optional().nullable(),
}).passthrough();

// TEMPORAL SCHEMA: Used for Updates. 
// 🚨 CORE IDENTITY FIELDS (Name, DOB, Sex) ARE OMITTED TO ENSURE IMMUTABILITY.
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
    IS_VOTER: z.boolean().optional(),
    IS_PWD: z.boolean().optional(),
    IS_4PS: z.boolean().optional(),
    IS_SOLO_PARENT: z.boolean().optional(),
    IS_SENIOR_CITIZEN: z.boolean().optional(),
    IS_IP: z.boolean().optional(),
}).passthrough();

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
// 🛡️ 2. CRYPTOGRAPHIC IDENTITY UTILITIES
// =========================================================

// Generates a SHA-256 fingerprint of the resident's biological data
const generateGenesisHash = (fName, mName, lName, dob) => {
    const normalizedString = `${fName?.trim().toLowerCase()}|${mName?.trim().toLowerCase()}|${lName?.trim().toLowerCase()}|${dob}`.replace(/\s+/g, '');
    return crypto.createHash('sha256').update(normalizedString).digest('hex');
};

// Validates existing record against its stored hash
const verifyIntegrity = (record) => {
    if (!record.genesis_hash) return 'unverified';
    const currentHash = generateGenesisHash(record.first_name, record.middle_name, record.last_name, record.dob);
    return currentHash === record.genesis_hash ? 'valid' : 'compromised';
};

// =========================================================
// 🛡️ 3. RBAC MIDDLEWARE
// =========================================================
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.user_role || req.user?.role;
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase())) {
            return res.status(403).json({ error: 'Forbidden', message: 'Insufficient Permissions.' });
        }
        next();
    };
};

export const ResidentsRecordRouter = (router, supabase, authenticateToken) => {
    
    // 🧠 4. ANTI-DUPLICATE ENGINE (Preserved)
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

        let query = supabase.from('residents_records').select('*').neq('activity_status', 'Archived').or(orConditions.join(','));
        if (excludeRecordId) query = query.neq('record_id', excludeRecordId);

        const { data, error } = await query;
        if (error) throw new Error(`Database Error: ${error.message}`);
        if (!data || data.length === 0) return null; 

        for (const record of data) {
            if (email && record.email?.toLowerCase() === email) return `Email '${payload.EMAIL}' already in use.`;
            if (phone && record.contact_number?.replace(/\D/g, '') === phone) return `Phone '${payload.CONTACT_NUMBER}' already registered.`;
            if (fName && lName && record.first_name?.toLowerCase() === fName && record.last_name?.toLowerCase() === lName) {
                if ((record.middle_name?.toLowerCase() || '') === mName) return `Resident ${payload.FIRST_NAME} ${payload.LAST_NAME} already exists.`;
            }
        }
        return null;
    };

    // =========================================================
    // 🚀 INTEGRATED ROUTES
    // =========================================================

    // 🛠️ LEDGER BACKFILL: Secures legacy records that have no hash
    router.post('/residents/ledger/backfill', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const { data: legacy, error: fetchError } = await supabase.from('residents_records').select('*').is('genesis_hash', null);
            if (fetchError) throw fetchError;
            if (!legacy || legacy.length === 0) return res.json({ message: "Chain is already up to date." });

            for (const r of legacy) {
                const hash = generateGenesisHash(r.first_name, r.middle_name, r.last_name, r.dob);
                await supabase.from('residents_records').update({ genesis_hash: hash }).eq('record_id', r.record_id);
            }
            res.json({ message: `Successfully secured ${legacy.length} legacy blocks.` });
        } catch (err) {
            res.status(500).json({ error: "Backfill failed: " + err.message });
        }
    });

    // GET ALL: With Server-Side Integrity Audit
    router.get('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { data, error } = await supabase.from('residents_records').select('*').neq('activity_status', 'Archived').order('created_at', { ascending: false });
            if (error) throw error;

            const auditedData = data.map(record => ({
                ...record,
                integrity_status: verifyIntegrity(record) // 🛡️ Server-side audit result
            }));
            
            res.status(200).json(auditedData);
        } catch (err) {
            res.status(500).json({ error: "Failed to retrieve residents list." });
        }
    });

    // GET SINGLE: With Real-time Tamper Detection
    router.get('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { data, error } = await supabase.from('residents_records').select('*').eq('record_id', req.params.id).single(); 
            if (error) throw error;

            const status = verifyIntegrity(data);
            if (status === 'compromised') {
                console.error(`[SECURITY BREACH] Tamper detected on record: ${data.record_id}`);
            }

            res.status(200).json({ ...data, integrity_status: status });
        } catch (err) {
            res.status(404).json({ error: 'Identity not found.' });
        }
    });

    // POST: Create Resident with Genesis Block Hashing
    router.post('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentCreationSchema), async (req, res) => {
        try {
            const r = req.body;
            const duplicateError = await checkDuplicates(r);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

            // 🛡️ Create the Immutable Identity Hash
            const genesisHash = generateGenesisHash(r.FIRST_NAME, r.MIDDLE_NAME, r.LAST_NAME, r.DOB);

            const { data: profile, error: profileError } = await supabase.from('residents_records').insert([{
                first_name: r.FIRST_NAME, 
                middle_name: r.MIDDLE_NAME,
                last_name: r.LAST_NAME,
                sex: r.SEX,
                dob: r.DOB,
                genesis_hash: genesisHash, // 👈 Locked forever
                birth_country: r.BIRTH_COUNTRY || 'PHILIPPINES',
                birth_province: r.BIRTH_PROVINCE,
                birth_city: r.BIRTH_CITY,
                birth_place: r.BIRTH_PLACE, 
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
            }]).select().single();

            if (profileError) throw profileError;

            // Step B: Auto-Account Generation
            const username = `${profile.first_name[0]}${(profile.middle_name?.[0] || '')}${profile.last_name[0]}${Math.floor(100+Math.random()*900)}@residents.eng-hill.brg.ph`.toLowerCase();
            const rawPassword = `${profile.first_name.toLowerCase().replace(/\s/g, '')}123456`;
            const hashedPassword = bcrypt.hashSync(rawPassword, 10);

            await supabase.from('residents_account').insert([{
                resident_id: profile.record_id,
                username: username,
                password: hashedPassword,
                role: 'resident',
                status: 'Active'
            }]);

            logActivity(supabase, req.user.username, 'RESIDENT_CREATED', `Block Secured: ${profile.first_name} ${profile.last_name}`).catch(console.error);

            res.status(201).json({ profile, account: { username, password: rawPassword } });
        } catch (err) {
            res.status(500).json({ error: err.message || "Registration Failure." });
        }
    });

    // PUT: Update Temporal Data Only
    router.put('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentUpdateSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;
            const duplicateError = await checkDuplicates(r, id);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

            // 🛡️ Filter updates to keep biological data immutable
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

            Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

            const { data, error } = await supabase.from('residents_records').update(updates).eq('record_id', id).select();
            if (error) throw error;
            
            logActivity(supabase, req.user.username, 'RESIDENT_UPDATED', `Temporal sync: ${id}`).catch(console.error);
            res.json(data[0]);
        } catch (err) {
            res.status(500).json({ error: "Failed to update record." });
        }
    });

    // DELETE: Soft Archive
    router.delete('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            const { error } = await supabase.from('residents_records').update({ activity_status: 'Archived' }).eq('record_id', req.params.id);
            if (error) throw error;

            logActivity(supabase, req.user.username, 'RESIDENT_ARCHIVED', `Identity Frozen: ${req.params.id}`).catch(console.error);
            res.json({ message: 'Identity Archived Successfully' });
        } catch (err) {
            res.status(500).json({ error: "Archive failed." });
        }
    });
};