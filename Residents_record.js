import bcrypt from 'bcryptjs';
import { logActivity } from './Auditlog.js'; 

/**
 * ZERO TRUST RBAC MIDDLEWARE
 * Pulls the role from the decrypted JWT (req.user) instead of the untrusted headers.
 */
const checkSessionRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = req.user?.user_role || req.user?.role;
        
        if (!userRole || !allowedRoles.includes(userRole.toLowerCase())) {
            console.log(`[RBAC REJECTED] Role: ${userRole}, Path: ${req.path}`);
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
    // 🛡️ ANTI-DUPLICATE HELPER
    // Checks for existing Email, Phone, or Name. Ignores Archived records.
    // =========================================================
    const checkDuplicates = async (payload, excludeRecordId = null) => {
        const email = (payload.EMAIL || payload.email)?.trim();
        const phone = (payload.CONTACT_NUMBER || payload.CONTACTNUMBER || payload.contact_number)?.trim();
        const fName = (payload.FIRST_NAME || payload.FIRSTNAME || payload.first_name)?.trim();
        const lName = (payload.LAST_NAME || payload.LASTNAME || payload.last_name)?.trim();
        const mName = (payload.MIDDLE_NAME || payload.MIDDLENAME || payload.middle_name)?.trim() || '';

        // 1. Check Email
        if (email) {
            let query = supabase.from('residents_records').select('record_id').eq('email', email).neq('activity_status', 'Archived');
            if (excludeRecordId) query = query.neq('record_id', excludeRecordId);
            const { data } = await query;
            if (data && data.length > 0) return "This Email Address is already registered to an active resident.";
        }

        // 2. Check Phone Number
        if (phone) {
            let query = supabase.from('residents_records').select('record_id').eq('contact_number', phone).neq('activity_status', 'Archived');
            if (excludeRecordId) query = query.neq('record_id', excludeRecordId);
            const { data } = await query;
            if (data && data.length > 0) return "This Contact Number is already registered to an active resident.";
        }

        // 3. Check Exact Full Name Match (First + Middle + Last)
        if (fName && lName) {
            let query = supabase.from('residents_records')
                .select('record_id')
                .ilike('first_name', fName)
                .ilike('last_name', lName)
                .neq('activity_status', 'Archived');
            
            // Only check middle name if it was provided
            if (mName) query = query.ilike('middle_name', mName);
            
            if (excludeRecordId) query = query.neq('record_id', excludeRecordId);
            
            const { data } = await query;
            if (data && data.length > 0) return `A resident named ${fName} ${lName} is already registered.`;
        }

        return null; // Clean! No duplicates found.
    };

    // =========================================================
    // 1. FETCH ALL (Excludes Archived)
    // =========================================================
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
            console.error("Fetch Residents Error:", err.message);
            res.status(500).json({ error: "Failed to retrieve residents list." });
        }
    });

    // =========================================================
    // 2. FETCH SINGLE
    // =========================================================
    router.get('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff', 'resident']), async (req, res) => {
        try {
            const { id } = req.params;
            const { data, error } = await supabase
                .from('residents_records')
                .select('*')
                .eq('record_id', id)
                .single(); 

            if (error) {
                if (error.code === 'PGRST116') return res.status(404).json({ error: 'Identity not found.' });
                throw error;
            }
            res.status(200).json(data);
        } catch (err) {
            res.status(500).json({ error: "Database lookup failed." });
        }
    });

    // =========================================================
    // 3. POST: INSERT + AUTO-ACCOUNT CREATION
    // =========================================================
    router.post('/residents', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const r = req.body;

            // 🚨 ANTI-DUPLICATE CHECK
            const duplicateError = await checkDuplicates(r);
            if (duplicateError) {
                return res.status(409).json({ error: duplicateError });
            }

            // Step A: Insert Profile (Aligned with Frontend Model)
            const { data: profile, error: profileError } = await supabase
                .from('residents_records')
                .insert([{
                    first_name: r.FIRST_NAME || r.FIRSTNAME, 
                    middle_name: r.MIDDLE_NAME || r.MIDDLENAME,
                    last_name: r.LAST_NAME || r.LASTNAME,
                    sex: r.SEX,
                    dob: r.DOB,
                    birth_country: r.BIRTH_COUNTRY || r.BIRTHCOUNTRY || 'PHILIPPINES',
                    birth_province: r.BIRTH_PROVINCE || r.BIRTHPROVINCE,
                    birth_city: r.BIRTH_CITY || r.BIRTHCITY,
                    birth_place: r.BIRTH_PLACE || r.BIRTHPLACE, 
                    nationality: r.NATIONALITY,
                    religion: r.RELIGION,
                    contact_number: r.CONTACT_NUMBER || r.CONTACTNUMBER, 
                    email: r.EMAIL,
                    current_address: r.CURRENT_ADDRESS || r.CURRENTADDRESS,
                    purok: r.PUROK,
                    civil_status: r.CIVIL_STATUS || r.CIVILSTATUS, 
                    education: r.EDUCATION,
                    employment: r.EMPLOYMENT,
                    employment_status: r.EMPLOYMENT_STATUS || r.EMPLOYMENTSTATUS,
                    occupation: r.OCCUPATION,
                    is_voter: r.IS_VOTER || r.ISVOTER,
                    is_pwd: r.IS_PWD || r.ISPWD,
                    is_4ps: r.IS_4PS || r.IS4PS,
                    is_solo_parent: r.IS_SOLO_PARENT || r.ISSOLOPARENT,
                    is_senior_citizen: r.IS_SENIOR_CITIZEN || r.ISSENIORCITIZEN,
                    is_ip: r.IS_IP || r.ISIP,
                    voter_id_number: r.VOTER_ID_NUMBER || r.VOTERIDNUMBER, 
                    pwd_id_number: r.PWD_ID_NUMBER || r.PWDIDNUMBER,
                    solo_parent_id_number: r.SOLO_PARENT_ID_NUMBER || r.SOLOPARENTIDNUMBER,
                    senior_id_number: r.SENIOR_ID_NUMBER || r.SENIORIDNUMBER,
                    four_ps_id_number: r.FOUR_PS_ID_NUMBER || r.FOURPSIDNUMBER,
                    activity_status: 'Active'
                }])
                .select().single();

            if (profileError) throw profileError;

            // Step B: Auto-generate secure credentials
            const f = profile.first_name[0].toLowerCase();
            const m = (profile.middle_name ? profile.middle_name[0] : '').toLowerCase();
            const l = profile.last_name[0].toLowerCase();
            
            const username = `${f}${m}${l}${Math.floor(100+Math.random()*900)}@residents.eng-hill.brg.ph`;
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

            // Step C: Log the creation
            logActivity(supabase, req.user.username, 'RESIDENT_CREATED', `Added: ${profile.first_name} ${profile.last_name}`)
                .catch(e => console.error("Logging failed:", e.message));

            res.status(201).json({ profile, account: { username, password: rawPassword } });

        } catch (err) {
            console.error("Registration Engine Failure:", err.message);
            res.status(500).json({ error: "System failed to register resident." });
        }
    });

    // =========================================================
    // 4. PUT: UPDATE (Fully Expanded & Aligned)
    // =========================================================
    router.put('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin', 'staff']), async (req, res) => {
        try {
            const { id } = req.params;
            const r = req.body;

            // 🚨 ANTI-DUPLICATE CHECK (Excludes the user being edited)
            const duplicateError = await checkDuplicates(r, id);
            if (duplicateError) {
                return res.status(409).json({ error: duplicateError });
            }

            const updates = {
                first_name: r.FIRST_NAME || r.first_name,
                middle_name: r.MIDDLE_NAME || r.middle_name,
                last_name: r.LAST_NAME || r.last_name,
                sex: r.SEX || r.sex,
                dob: r.DOB || r.dob,
                birth_country: r.BIRTH_COUNTRY || r.birth_country,
                birth_province: r.BIRTH_PROVINCE || r.birth_province,
                birth_city: r.BIRTH_CITY || r.birth_city,
                birth_place: r.BIRTH_PLACE || r.birth_place,
                nationality: r.NATIONALITY || r.nationality,
                religion: r.RELIGION || r.religion,
                contact_number: r.CONTACT_NUMBER || r.contact_number,
                email: r.EMAIL || r.email,
                current_address: r.CURRENT_ADDRESS || r.current_address,
                purok: r.PUROK || r.purok,
                civil_status: r.CIVIL_STATUS || r.civil_status,
                education: r.EDUCATION || r.education,
                employment: r.EMPLOYMENT || r.employment,
                employment_status: r.EMPLOYMENT_STATUS || r.employment_status,
                occupation: r.OCCUPATION || r.occupation,
                is_voter: r.IS_VOTER ?? r.is_voter,
                is_pwd: r.IS_PWD ?? r.is_pwd,
                is_4ps: r.IS_4PS ?? r.is_4ps,
                is_solo_parent: r.IS_SOLO_PARENT ?? r.is_solo_parent,
                is_senior_citizen: r.IS_SENIOR_CITIZEN ?? r.is_senior_citizen,
                is_ip: r.IS_IP ?? r.is_ip,
                voter_id_number: r.VOTER_ID_NUMBER || r.voter_id_number,
                pwd_id_number: r.PWD_ID_NUMBER || r.pwd_id_number,
                solo_parent_id_number: r.SOLO_PARENT_ID_NUMBER || r.solo_parent_id_number,
                senior_id_number: r.SENIOR_ID_NUMBER || r.senior_id_number,
                four_ps_id_number: r.FOUR_PS_ID_NUMBER || r.four_ps_id_number,
                activity_status: r.ACTIVITY_STATUS || r.activity_status
            };

            // Clean undefined values
            Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

            const { data, error } = await supabase
                .from('residents_records')
                .update(updates)
                .eq('record_id', id)
                .select();

            if (error) throw error;
            
            logActivity(supabase, req.user.username, 'RESIDENT_UPDATED', `Updated ID: ${id}`)
                .catch(e => console.error("Logging failed:", e.message));

            res.json(data[0]);
        } catch (err) {
            console.error("Update Identity Error:", err.message);
            res.status(500).json({ error: "Failed to update record." });
        }
    });

    // =========================================================
    // 5. DELETE: ARCHIVE (Soft Delete)
    // =========================================================
    router.delete('/residents/:id', authenticateToken, checkSessionRole(['admin', 'superadmin']), async (req, res) => {
        try {
            // Updates activity_status to "Archived" instead of permanently deleting
            const { error } = await supabase
                .from('residents_records')
                .update({ activity_status: 'Archived' }) 
                .eq('record_id', req.params.id);

            if (error) throw error;

            logActivity(supabase, req.user.username, 'RESIDENT_ARCHIVED', `Archived ID: ${req.params.id}`)
                .catch(e => console.error("Logging failed:", e.message));

            res.json({ message: 'Identity Archived Successfully' });
        } catch (err) {
            res.status(500).json({ error: "Archive failed." });
        }
    });
};