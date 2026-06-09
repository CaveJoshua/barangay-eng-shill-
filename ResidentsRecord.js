import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logActivity } from './Auditlog.js';

// Generates a cryptographically random temporary password
const generateTempPassword = () => crypto.randomBytes(12).toString('base64url');

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
        birthCountry: val.birthCountry || val.birth_country || val.BIRTH_COUNTRY,
        birthProvince: val.birthProvince || val.birth_province || val.BIRTH_PROVINCE,
        birthCity: val.birthCity || val.birth_city || val.BIRTH_CITY,
        birthPlace: val.birthPlace || val.birth_place || val.BIRTH_PLACE,
        nationality: val.nationality || val.NATIONALITY,
        voterIdNumber: val.voterIdNumber || val.voter_id_number,
        pwdIdNumber: val.pwdIdNumber || val.pwd_id_number,
        fourPsIdNumber: val.fourPsIdNumber || val.four_ps_id_number,
        soloParentIdNumber: val.soloParentIdNumber || val.solo_parent_id_number,
        seniorIdNumber: val.seniorIdNumber || val.senior_id_number,
        activityStatus: val.activityStatus || val.activity_status || 'Active'
    };
};

const csvBoolean = z.preprocess((val) => {
    if (typeof val === 'string') return val.trim().toLowerCase() === 'true';
    return Boolean(val);
}, z.boolean().optional());

const safeString = z.coerce.string().trim().optional().nullable().or(z.literal(''));
const phIdString = (maxLength) => z.coerce.string().trim().max(maxLength, `Maximum of ${maxLength} characters allowed`).optional().nullable().or(z.literal(''));

// =========================================================
// 🛡️ 2. ZOD SCHEMA (BULK IMPORT SAFE)
// =========================================================
const residentSchema = z.preprocess(normalizePayload, z.object({
    firstName: z.coerce.string().trim().min(1, "First name is required"),
    lastName: z.coerce.string().trim().min(1, "Last name is required"),
    middleName: safeString,
    dob: z.preprocess((val) => {
        if (!val || typeof val !== 'string' || val.trim() === '') return null;
        return !isNaN(Date.parse(val)) ? val : null;
    }, z.string().nullable().optional()),
    sex: safeString,
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
    voterIdNumber: phIdString(25),
    pwdIdNumber: phIdString(25),
    fourPsIdNumber: phIdString(20),
    soloParentIdNumber: phIdString(25),
    seniorIdNumber: phIdString(20),
    activityStatus: safeString
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
// 🛡️ 4. STRICT AUTHORIZATION MIDDLEWARE
// =========================================================
const authorizeRoles = (allowedRoles) => {
    return (req, res, next) => {
        const role = (req.user?.user_role || req.user?.role || '').toLowerCase().replace(/\s+/g, '');
        if (!allowedRoles.includes(role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Insufficient clearance. Required roles: ${allowedRoles.join(', ')}`
            });
        }
        next();
    };
};

// =========================================================
// 🔒 5. ANTI-DUPLICATE ENGINE
// Checks full name, contact number, and email independently.
// excludeId: pass the record_id when updating so the record
//            doesn't collide with itself.
// Returns an array of collision objects, empty if clean.
// =========================================================
const checkDuplicates = async (supabase, { firstName, middleName, lastName, contact_number, email }, excludeId = null) => {
    const collisions = [];

    // ── 5a. Full Name Match (case-insensitive, trims whitespace) ──
    // Strategy: pull candidates by last_name first (indexed), then
    // compare first + middle in JS to avoid ilike performance hits
    // on large tables.
    const { data: nameMatches } = await supabase
        .from('residents_records')
        .select('record_id, first_name, middle_name, last_name')
        .ilike('last_name', lastName.trim())
        .ilike('first_name', firstName.trim())
        .neq('activity_status', 'Archived'); // Archived records are excluded from collision

    if (nameMatches?.length) {
        const normMiddle = (middleName || '').trim().toLowerCase();
        for (const match of nameMatches) {
            if (excludeId && match.record_id === excludeId) continue;
            const existingMiddle = (match.middle_name || '').trim().toLowerCase();
            // Treat blank vs blank as a match; treat blank vs non-blank as distinct
            if (existingMiddle === normMiddle) {
                collisions.push({
                    field: 'full_name',
                    message: `A resident named "${match.first_name} ${match.middle_name || ''} ${match.last_name}".trim() already exists in the registry.`
                });
            }
        }
    }

    // ── 5b. Contact Number Match ──
    const safePhone = (contact_number || '').trim().replace(/\s+/g, '');
    if (safePhone) {
        const { data: phoneMatches } = await supabase
            .from('residents_records')
            .select('record_id, first_name, last_name, contact_number')
            .eq('contact_number', safePhone)
            .neq('activity_status', 'Archived');

        if (phoneMatches?.length) {
            for (const match of phoneMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                collisions.push({
                    field: 'contact_number',
                    message: `Contact number "${safePhone}" is already registered to ${match.first_name} ${match.last_name}.`
                });
            }
        }
    }

    // ── 5c. Email Match ──
    const safeEmail = (email || '').trim().toLowerCase();
    if (safeEmail && safeEmail.includes('@')) {
        const { data: emailMatches } = await supabase
            .from('residents_records')
            .select('record_id, first_name, last_name, email')
            .ilike('email', safeEmail)
            .neq('activity_status', 'Archived');

        if (emailMatches?.length) {
            for (const match of emailMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                collisions.push({
                    field: 'email',
                    message: `Email "${safeEmail}" is already registered to ${match.first_name} ${match.last_name}.`
                });
            }
        }
    }

    return collisions;
};

// 🛡️ DEFINED DATA HANDLERS (Matches Frontend restrictions)
const DATA_HANDLERS = ['superadmin', 'admin', 'barangaysecretary', 'secretary', 'barangayhall', 'bhw', 'barangayhealthworker'];

export const ResidentsRecordRouter = (router, supabase, authenticateToken) => {

    // REBUILD LEDGER
    router.post('/residents/ledger/rebuild',
        [authenticateToken, authorizeRoles(['superadmin', 'admin'])],
        async (req, res) => {
            try {
                const { data: all, error } = await supabase.from('residents_records').select('*');
                if (error) throw error;
                for (const r of all) {
                    const h = generateGenesisHash(r.first_name, r.middle_name, r.last_name, r.dob);
                    await supabase.from('residents_records').update({ genesis_hash: h }).eq('record_id', r.record_id);
                }
                res.json({ message: "Global chain re-signed successfully." });
            } catch (err) { res.status(500).json({ error: err.message }); }
        }
    );

    // GET: 👁️ VIEW ONLY (Globally accessible to logged-in officials)
    router.get('/residents',
        [authenticateToken],
        async (req, res) => {
            try {
                const { data, error } = await supabase.from('residents_records').select('*').order('last_name', { ascending: true });
                if (error) throw error;
                res.status(200).json(data.map(r => ({ ...r, integrity_status: verifyIntegrity(r) })));
            } catch (err) { res.status(500).json({ error: "Data retrieval failed." }); }
        }
    );

    // POST: 🛡️ CREATE RESIDENT (Locked to Data Handlers)
    router.post('/residents',
        [authenticateToken, authorizeRoles(DATA_HANDLERS), validatePayload(residentSchema)],
        async (req, res) => {
            try {
                const r = req.body;

                // 🔒 ANTI-DUPLICATE GATE — runs before any insert
                const collisions = await checkDuplicates(supabase, {
                    firstName: r.firstName,
                    middleName: r.middleName,
                    lastName: r.lastName,
                    contact_number: r.contact_number,
                    email: r.email
                });

                if (collisions.length > 0) {
                    return res.status(409).json({
                        error: 'Duplicate Detected',
                        message: 'This record conflicts with an existing identity in the registry.',
                        collisions
                    });
                }

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
                    voter_id_number: r.voterIdNumber || null,
                    pwd_id_number: r.pwdIdNumber || null,
                    four_ps_id_number: r.fourPsIdNumber || null,
                    solo_parent_id_number: r.soloParentIdNumber || null,
                    senior_id_number: r.seniorIdNumber || null,
                    activity_status: r.activityStatus || 'Active'
                }]).select().single();

                if (pErr) throw pErr;

                try {
                    // 🎯 CREATE ASSOCIATED ACCOUNT
                    const f = profile.first_name[0] || '';
                    const m = profile.middle_name ? profile.middle_name[0] : '';
                    const l = profile.last_name[0] || '';
                    const rand = crypto.randomInt(100, 999);

                    const username = `${f}${m}${l}${rand}@residents.eng-hill.brg.ph`.toLowerCase();
                    const tempPass = generateTempPassword();
                    const pass = await bcrypt.hash(tempPass, 12);

                    await supabase.from('residents_account').insert([{
                        resident_id: profile.record_id,
                        username,
                        password: pass,
                        role: 'resident',
                        status: 'Active',
                        requires_reset: true  // forces password change on first login
                    }]);

                    logActivity(supabase, req.user.username, 'RESIDENT_CREATED', profile.record_id).catch(() => {});
                    res.status(201).json(profile);
                } catch (aErr) {
                    await supabase.from('residents_records').delete().eq('record_id', profile.record_id);
                    throw new Error("Rollback: Account creation failed.");
                }
            } catch (err) { res.status(500).json({ error: err.message }); }
        }
    );

    // PUT: 🛡️ UPDATE RESIDENT & ACCOUNT STATUS (Locked to Data Handlers)
    router.put('/residents/:id',
        [authenticateToken, authorizeRoles(DATA_HANDLERS), validatePayload(residentSchema)],
        async (req, res) => {
            try {
                const r = req.body;
                const recordId = req.params.id;

                // 🔒 ANTI-DUPLICATE GATE — excludes the current record from its own collision check
                const collisions = await checkDuplicates(supabase, {
                    firstName: r.firstName,
                    middleName: r.middleName,
                    lastName: r.lastName,
                    contact_number: r.contact_number,
                    email: r.email
                }, recordId);

                if (collisions.length > 0) {
                    return res.status(409).json({
                        error: 'Duplicate Detected',
                        message: 'The updated data conflicts with an existing identity in the registry.',
                        collisions
                    });
                }

                const newHash = generateGenesisHash(r.firstName, r.middleName, r.lastName, r.dob);

                const updates = {
                    first_name: r.firstName,
                    middle_name: r.middleName,
                    last_name: r.lastName,
                    sex: r.sex,
                    dob: r.dob,
                    genesis_hash: newHash,
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
                    birth_country: r.birthCountry,
                    birth_province: r.birthProvince,
                    birth_city: r.birthCity,
                    birth_place: r.birthPlace,
                    nationality: r.nationality,
                    voter_id_number: r.voterIdNumber || null,
                    pwd_id_number: r.pwdIdNumber || null,
                    four_ps_id_number: r.fourPsIdNumber || null,
                    solo_parent_id_number: r.soloParentIdNumber || null,
                    senior_id_number: r.seniorIdNumber || null,
                    activity_status: r.activityStatus
                };

                const { data, error } = await supabase.from('residents_records').update(updates).eq('record_id', recordId).select();
                if (error) throw error;

                // 🛡️ THE GHOST PROTOCOL: Synchronize the Resident's Account Status
                let accountStatus = 'Active';
                if (['Deceased', 'Relocated', 'Archived', 'Inactive'].includes(r.activityStatus)) {
                    accountStatus = 'Archived';
                }

                await supabase.from('residents_account')
                    .update({ status: accountStatus })
                    .eq('resident_id', recordId);

                logActivity(supabase, req.user.username, 'IDENTITY_REPLACED', recordId).catch(() => {});
                res.json(data[0]);
            } catch (err) { res.status(500).json({ error: "Identity replacement failed." }); }
        }
    );

    // DELETE: 🛡️ ARCHIVE RECORD & DEACTIVATE ACCOUNT (Locked to Data Handlers)
    router.delete('/residents/:id',
        [authenticateToken, authorizeRoles(DATA_HANDLERS)],
        async (req, res) => {
            try {
                await supabase.from('residents_records').update({ activity_status: 'Archived' }).eq('record_id', req.params.id);
                await supabase.from('residents_account').update({ status: 'Archived' }).eq('resident_id', req.params.id);

                logActivity(supabase, req.user.username, 'RESIDENT_ARCHIVED', req.params.id).catch(() => {});
                res.json({ success: true });
            } catch (err) { res.status(500).json({ error: "Archiving failed." }); }
        }
    );
};