import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { logActivity } from './Auditlog.js'; 

// =========================================================
// 🛡️ 1. ZOD SCHEMA VALIDATION
// Ensures incoming payloads are strictly typed and safe
// =========================================================
const residentSchema = z.object({
    FIRST_NAME: z.string().min(2, "First name must be at least 2 characters"),
    LAST_NAME: z.string().min(2, "Last name must be at least 2 characters"),
    MIDDLE_NAME: z.string().optional().nullable(),
    EMAIL: z.string().email("Invalid email format").optional().nullable(),
    // Standardizes phone numbers to only contain digits
    CONTACT_NUMBER: z.string().transform(val => val.replace(/\D/g, '')).optional().nullable(),
    SEX: z.enum(['Male', 'Female', 'Other']).optional(),
    DOB: z.string().refine((date) => !isNaN(Date.parse(date)), { message: "Invalid date format" }),
    // Add other expected fields here as z.string().optional()
}).passthrough(); // passthrough allows fields not explicitly defined above to still pass

// Middleware to enforce Zod validation
const validatePayload = (schema) => (req, res, next) => {
    try {
        // We overwrite req.body with the sanitized/validated Zod output
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
// 🛡️ 2. ZERO TRUST RBAC MIDDLEWARE
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
    // 🧠 3. SMARTER ANTI-DUPLICATE ENGINE (Single-Pass)
    // =========================================================
    const checkDuplicates = async (payload, excludeRecordId = null) => {
        // 1. Data Normalization
        const email = payload.EMAIL?.trim().toLowerCase();
        const phone = payload.CONTACT_NUMBER; // Already sanitized by Zod to numbers only
        const fName = payload.FIRST_NAME?.trim().toLowerCase();
        const lName = payload.LAST_NAME?.trim().toLowerCase();
        const mName = payload.MIDDLE_NAME?.trim().toLowerCase() || '';

        // 2. Build Dynamic OR Query for Supabase
        const orConditions = [];
        if (email) orConditions.push(`email.ilike.${email}`);
        if (phone) orConditions.push(`contact_number.eq.${phone}`);
        if (fName && lName) orConditions.push(`and(first_name.ilike.${fName},last_name.ilike.${lName})`);

        if (orConditions.length === 0) return null; // Nothing to check

        // 3. Execute Single Network Request
        let query = supabase.from('residents_records')
            .select('record_id, email, contact_number, first_name, middle_name, last_name')
            .neq('activity_status', 'Archived')
            .or(orConditions.join(','));

        if (excludeRecordId) query = query.neq('record_id', excludeRecordId);

        const { data, error } = await query;
        if (error) throw new Error(`Database Error during duplicate check: ${error.message}`);
        if (!data || data.length === 0) return null; // Clean!

        // 4. In-Memory Hardcoded Sieve (O(N) where N is very small)
        for (const record of data) {
            // Check Email
            if (email && record.email?.toLowerCase() === email) {
                return `The email address '${payload.EMAIL}' is already in use.`;
            }
            // Check Phone (comparing sanitized to sanitized)
            if (phone && record.contact_number?.replace(/\D/g, '') === phone) {
                return `The contact number '${payload.CONTACT_NUMBER}' is already registered.`;
            }
            // Check Name (Strict evaluation including middle name)
            if (fName && lName && 
                record.first_name?.toLowerCase() === fName && 
                record.last_name?.toLowerCase() === lName) {
                
                const dbMiddle = record.middle_name?.toLowerCase() || '';
                if (dbMiddle === mName) {
                    const midDisplay = mName ? ` ${payload.MIDDLE_NAME} ` : ' ';
                    return `A resident named ${payload.FIRST_NAME}${midDisplay}${payload.LAST_NAME} already exists.`;
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
            res.status(200).json(data);
        } catch (err) {
            res.status(404).json({ error: 'Identity not found.' });
        }
    });

    // POST: INSERT WITH ZOD VALIDATION
    router.post('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentSchema), async (req, res) => {
        try {
            const r = req.body;

            // 🚨 ENGINE: Smart Anti-Duplicate Check
            const duplicateError = await checkDuplicates(r);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

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

            logActivity(supabase, req.user.username, 'RESIDENT_CREATED', `Added: ${profile.first_name} ${profile.last_name}`).catch(console.error);

            res.status(201).json({ profile, account: { username, password: rawPassword } });

        } catch (err) {
            console.error("Registration Failure:", err.message);
            res.status(500).json({ error: err.message || "System failed to register resident." });
        }
    });

    // PUT: UPDATE WITH ZOD VALIDATION
    router.put('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), validatePayload(residentSchema), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;

            // 🚨 ENGINE: Smart Anti-Duplicate Check (Exclude current ID)
            const duplicateError = await checkDuplicates(r, id);
            if (duplicateError) return res.status(409).json({ error: duplicateError });

            // Create updates object directly from validated Zod payload
            const updates = {
                first_name: r.FIRST_NAME,
                middle_name: r.MIDDLE_NAME,
                last_name: r.LAST_NAME,
                sex: r.SEX,
                dob: r.DOB,
                contact_number: r.CONTACT_NUMBER,
                email: r.EMAIL,
                // ... map the rest of your properties exactly as done in the POST route
            };

            // Clean undefined values
            Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

            const { data, error } = await supabase.from('residents_records').update(updates).eq('record_id', id).select();
            if (error) throw error;
            
            logActivity(supabase, req.user.username, 'RESIDENT_UPDATED', `Updated ID: ${id}`).catch(console.error);
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