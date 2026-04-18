import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logActivity } from './Auditlog.js';

// =========================================================
// 🛡️ 1. UNIVERSAL PAYLOAD NORMALIZER
// =========================================================
const normalizePayload = (val) => {
    if (typeof val !== 'object' || !val) return val;
    return {
        ...val,
        firstName: val.firstName || val.first_name || val.FIRST_NAME,
        lastName: val.lastName || val.last_name || val.LAST_NAME,
        middleName: val.middleName || val.middle_name || val.MIDDLE_NAME,
        dob: val.dob || val.DOB,
        sex: val.sex || val.SEX,
        email: val.email || val.EMAIL,
        contact_number: val.contact_number || val.contactNumber || val.CONTACT_NUMBER,
        purok: val.purok || val.PUROK,
        civilStatus: val.civilStatus || val.civil_status || val.CIVIL_STATUS,
        education: val.education || val.EDUCATION,
        employment: val.employment || val.EMPLOYMENT,
        employmentStatus: val.employmentStatus || val.employment_status || val.EMPLOYMENT_STATUS,
        occupation: val.occupation || val.OCCUPATION,
        religion: val.religion || val.RELIGION,
        isVoter: val.isVoter ?? val.is_voter ?? val.IS_VOTER,
        isPWD: val.isPWD ?? val.is_pwd ?? val.IS_PWD,
        is4Ps: val.is4Ps ?? val.is_4ps ?? val.IS_4PS,
        isSoloParent: val.isSoloParent ?? val.is_solo_parent ?? val.IS_SOLO_PARENT,
        isSeniorCitizen: val.isSeniorCitizen ?? val.is_senior_citizen ?? val.IS_SENIOR_CITIZEN,
        isIP: val.isIP ?? val.is_ip ?? val.IS_IP,
        birthCountry: val.birthCountry || val.birth_country || val.BIRTH_COUNTRY,
        birthProvince: val.birthProvince || val.birth_province || val.BIRTH_PROVINCE,
        birthCity: val.birthCity || val.birth_city || val.BIRTH_CITY,
        birthPlace: val.birthPlace || val.birth_place || val.BIRTH_PLACE,
        nationality: val.nationality || val.NATIONALITY,
    };
};

const csvBoolean = z.preprocess((val) => {
    if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
    return Boolean(val);
}, z.boolean().optional());

// Helper to handle messy CSV strings gracefully
const safeString = z.coerce.string().trim().optional().nullable().or(z.literal(''));

// =========================================================
// 🛡️ 2. ZOD SCHEMA (BULK IMPORT SAFE)
// =========================================================
const residentSchema = z.preprocess(normalizePayload, z.object({
    // Coerce to string to prevent crashes on numbers, relaxed min constraint
    firstName: z.coerce.string().trim().min(1, "First name is required"),
    lastName: z.coerce.string().trim().min(1, "Last name is required"),
    middleName: safeString,
    
    // If it's not a valid date, just make it null instead of crashing
    dob: z.preprocess((val) => {
        if (!val || typeof val !== 'string' || val.trim() === '') return null;
        return !isNaN(Date.parse(val)) ? val : null;
    }, z.string().nullable().optional()),
    
    sex: safeString,
    
    // Strip out "N/A" or invalid emails without crashing
    email: z.preprocess((val) => {
        if (typeof val === 'string' && !val.includes('@')) return null;
        return val;
    }, z.string().email().nullable().optional().or(z.literal(''))),
    
    contact_number: safeString,
    purok: safeString,
    civilStatus: safeString,
    education: safeString,
    employmentStatus: safeString,
    occupation: safeString,
    religion: safeString,
    
    isVoter: csvBoolean,
    isPWD: csvBoolean,
    is4Ps: csvBoolean,
    isSoloParent: csvBoolean,
    isSeniorCitizen: csvBoolean,
    isIP: csvBoolean,
}).passthrough());

const validatePayload = (schema) => (req, res, next) => {
    try {
        req.body = schema.parse(req.body);
        next();
    } catch (error) {
        return res.status(400).json({ error: "Validation Failed", details: error.errors });
    }
};

// =========================================================
// 🛡️ 3. CRYPTOGRAPHIC UTILITIES
// =========================================================
const generateGenesisHash = (fName, mName, lName, dob) => {
    const normalizedString = `${fName?.trim().toLowerCase()}|${mName?.trim().toLowerCase()}|${lName?.trim().toLowerCase()}|${dob}`.replace(/\s+/g, '');
    return crypto.createHash('sha256').update(normalizedString).digest('hex');
};

const verifyIntegrity = (record) => {
    if (!record.genesis_hash) return 'unverified';
    const currentHash = generateGenesisHash(record.first_name, record.middle_name, record.last_name, record.dob);
    return currentHash === record.genesis_hash ? 'valid' : 'compromised';
};

// =========================================================
// 🛡️ 4. STRICT AUTHENTICATION MIDDLEWARE
// =========================================================
const secure = (allowedRoles, authenticateToken) => {
    return (req, res, next) => {
        authenticateToken(req, res, () => {
            const role = (req.user?.user_role || req.user?.role || '').toLowerCase();
            if (!allowedRoles.includes(role)) {
                return res.status(403).json({ error: 'Forbidden', message: 'Insufficient clearance.' });
            }
            next();
        });
    };
};

export const ResidentsRecordRouter = (router, supabase, authenticateToken) => {
    
    // 🔗 GLOBAL REBUILD
    router.post('/residents/ledger/rebuild', secure(['admin', 'superadmin'], authenticateToken), async (req, res) => {
        try {
            const { data: all, error } = await supabase.from('residents_records').select('*');
            if (error) throw error;
            for (const r of all) {
                const h = generateGenesisHash(r.first_name, r.middle_name, r.last_name, r.dob);
                await supabase.from('residents_records').update({ genesis_hash: h }).eq('record_id', r.record_id);
            }
            res.json({ message: "Global chain re-signed successfully." });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // GET ALL
    router.get('/residents', secure(['admin', 'superadmin', 'staff'], authenticateToken), async (req, res) => {
        try {
            const { data, error } = await supabase.from('residents_records').select('*').neq('activity_status', 'Archived').order('last_name', { ascending: true });
            if (error) throw error;
            res.status(200).json(data.map(r => ({ ...r, integrity_status: verifyIntegrity(r) })));
        } catch (err) { res.status(500).json({ error: "Data retrieval failed." }); }
    });

    // POST: Create Resident + Account (FORMAT: jcb981@residents...)
    router.post('/residents', secure(['admin', 'superadmin', 'staff'], authenticateToken), validatePayload(residentSchema), async (req, res) => {
        try {
            const r = req.body;
            const hash = generateGenesisHash(r.firstName, r.middleName, r.lastName, r.dob);

            const { data: profile, error: pErr } = await supabase.from('residents_records').insert([{
                first_name: r.firstName, 
                middle_name: r.middleName || '',
                last_name: r.lastName,
                sex: r.sex || 'Other',
                dob: r.dob,
                genesis_hash: hash,
                birth_country: r.birthCountry || 'PHILIPPINES',
                birth_province: r.birthProvince || '',
                birth_city: r.birthCity || '',
                birth_place: r.birthPlace || '',
                nationality: r.nationality || 'FILIPINO',
                religion: r.religion || '',
                contact_number: r.contact_number || '', 
                email: r.email || '',
                current_address: r.currentAddress || '',
                purok: r.purok || '',
                civil_status: r.civilStatus || 'Single', 
                education: r.education || '',
                employment_status: r.employmentStatus || 'Unemployed',
                occupation: r.occupation || '',
                is_voter: !!r.isVoter,
                is_pwd: !!r.isPWD,
                is_4ps: !!r.is4Ps,
                is_solo_parent: !!r.isSoloParent,
                is_senior_citizen: !!r.isSeniorCitizen,
                is_ip: !!r.isIP,
                activity_status: 'Active'
            }]).select().single();

            if (pErr) throw pErr;

            try {
                // 🎯 FORMAT: jcb981@residents (Initials: John Celino Bocoboc)
                const f = profile.first_name[0] || '';
                const m = profile.middle_name ? profile.middle_name[0] : '';
                const l = profile.last_name[0] || '';
                const rand = Math.floor(100 + Math.random() * 899);
                
                const username = `${f}${m}${l}${rand}@residents.eng-hill.brg.ph`.toLowerCase();
                const pass = bcrypt.hashSync(`${profile.first_name.toLowerCase()}123456`, 10);
                
                await supabase.from('residents_account').insert([{ 
                    resident_id: profile.record_id, username, password: pass, role: 'resident', status: 'Active' 
                }]);
                
                logActivity(supabase, req.user.username, 'RESIDENT_CREATED', profile.record_id).catch(() => {});
                res.status(201).json(profile);
            } catch (aErr) {
                await supabase.from('residents_records').delete().eq('record_id', profile.record_id);
                throw new Error("Rollback: Account creation failed.");
            }
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // PUT: BREAK AND REPLACE THE BLOCK
    router.put('/residents/:id', secure(['admin', 'superadmin', 'staff'], authenticateToken), validatePayload(residentSchema), async (req, res) => {
        try {
            const r = req.body;
            // 🛡️ ENTIRE BLOCK REPLACED: New hash for the modified identity
            const newHash = generateGenesisHash(r.firstName, r.middleName, r.lastName, r.dob);

            const updates = {
                first_name: r.firstName,
                middle_name: r.middleName,
                last_name: r.lastName,
                sex: r.sex,
                dob: r.dob,
                genesis_hash: newHash, // 👈 THE NEW SIGNATURE
                contact_number: r.contact_number,
                email: r.email,
                current_address: r.currentAddress,
                purok: r.purok,
                civil_status: r.civilStatus,
                education: r.education,
                employment_status: r.employmentStatus,
                occupation: r.occupation,
                religion: r.religion,
                is_voter: r.isVoter,
                is_pwd: r.isPWD,
                is_4ps: r.is4Ps,
                is_solo_parent: r.isSoloParent,
                is_senior_citizen: r.isSeniorCitizen,
                is_ip: r.isIP,
                birth_country: r.birthCountry,
                birth_province: r.birthProvince,
                birth_city: r.birthCity,
                birth_place: r.birthPlace,
                nationality: r.nationality
            };

            const { data, error } = await supabase.from('residents_records').update(updates).eq('record_id', req.params.id).select();
            if (error) throw error;
            
            logActivity(supabase, req.user.username, 'IDENTITY_REPLACED', req.params.id).catch(() => {});
            res.json(data[0]);
        } catch (err) { res.status(500).json({ error: "Identity replacement failed." }); }
    });

    router.delete('/residents/:id', secure(['admin', 'superadmin'], authenticateToken), async (req, res) => {
        try {
            await supabase.from('residents_records').update({ activity_status: 'Archived' }).eq('record_id', req.params.id);
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: "Archiving failed." }); }
    });
};