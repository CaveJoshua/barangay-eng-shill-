import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logActivity } from '../lib/Auditlog.js';
import { sendAutoMail } from '../lib/Mailer.js';
import { sendSms, normalizePhNumber } from '../lib/Sms.js';
import { broadcastRealtimeEvent } from '../lib/WebSocketServer.js';

// Generates a cryptographically random temporary password
const generateTempPassword = () => crypto.randomBytes(12).toString('base64url');

// =========================================================
// 🔐 ACCOUNT-VERIFICATION OTP STORE (in-memory, same pattern as
// Profile.js/Officials.js OTP flows). Keyed by the resident's record_id.
// =========================================================
const verifyOtpStore = new Map();

const generateVerifyCode = (length = 6) => {
    const chars = '0123456789'; // numeric-only: typing it back from a phone must be easy
    return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

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
        sssIdNumber: val.sssIdNumber || val.sss_id_number,
        philhealthIdNumber: val.philhealthIdNumber || val.philhealth_id_number,
        otherIdNumber: val.otherIdNumber || val.other_id_number,
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
    sssIdNumber: phIdString(20),
    philhealthIdNumber: phIdString(20),
    otherIdNumber: phIdString(30),
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
// 🔗 LINKED HASH-CHAIN (derived — no schema change, J-CVE-101203)
// Each resident is a block ordered by record_id. A block's hash folds
// in the PREVIOUS block's hash, so tampering / reordering / deletion
// breaks every block after it. The chain is recalculated on demand
// (so edits naturally re-chain) and the head is anchored into audit_logs
// to also detect record deletion.
// =========================================================
const GENESIS_PREV = '0'.repeat(64);

const computeBlockHash = (prevHash, dataHash, recordId) =>
    crypto.createHash('sha256').update(`${prevHash}|${dataHash}|${recordId}`).digest('hex');

const buildResidentChain = (records) => {
    const ordered = [...records].sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));

    let prevHash = GENESIS_PREV;
    let compromised = 0;
    let unverified = 0;

    const blocks = ordered.map((r, index) => {
        const expected = generateGenesisHash(r.first_name, r.middle_name, r.last_name, r.dob);
        const stored = r.genesis_hash || null;
        const dataStatus = !stored ? 'unverified' : (stored === expected ? 'valid' : 'compromised');
        if (dataStatus === 'compromised') compromised++;
        if (dataStatus === 'unverified') unverified++;

        // Fold the STORED data hash into the chain; a tampered field changes
        // `expected` (surfacing as 'compromised') while `stored` stays put.
        const dataHash = stored || expected;
        const blockHash = computeBlockHash(prevHash, dataHash, r.record_id);

        const block = { index, record_id: r.record_id, prev_hash: prevHash, data_hash: dataHash, block_hash: blockHash, data_status: dataStatus };
        prevHash = blockHash;
        return block;
    });

    return { blocks, head: prevHash, total: blocks.length, compromised, unverified };
};

// Reads the most recently anchored chain head from the audit log.
const getAnchoredHead = async (supabase) => {
    const { data } = await supabase
        .from('audit_logs')
        .select('details, timestamp')
        .eq('action', 'LEDGER_ANCHOR')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!data) return null;

    // `details` is the logActivity envelope { message, ... }; the message holds "head=<hash>".
    let text = data.details;
    try { text = JSON.parse(data.details)?.message ?? data.details; } catch { /* legacy plain string */ }
    const m = String(text).match(/head=([a-f0-9]{64})/i);
    return m ? { head: m[1], at: data.timestamp } : null;
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
// Checks full name, contact number, email, and every government ID
// independently. excludeId: pass the record_id when updating so the
// record doesn't collide with itself.
//
// Full-name matching is never a hard block — two real people (parent and
// child, coincidental namesakes, or a genuine duplicate entry) can share a
// full name, and staff accept that risk in exchange for never blocking a
// real namesake. A name match ALWAYS comes back as a non-blocking ADVISORY,
// even when the DOB also matches.
//
// Contact number, email, and each of the 8 government ID fields (voter,
// PWD, 4Ps, solo parent, senior, SSS, PhilHealth, Other) are hard blocks,
// checked GLOBALLY across every resident — not scoped to name matches.
//
// Returns { collisions, advisories } — only `collisions` should block a save.
// =========================================================
const checkDuplicates = async (supabase, {
    firstName, middleName, lastName, dob, contact_number, email,
    voterIdNumber, pwdIdNumber, fourPsIdNumber, soloParentIdNumber, seniorIdNumber,
    sssIdNumber, philhealthIdNumber, otherIdNumber
}, excludeId = null) => {
    const collisions = [];
    const advisories = [];

    const normFirst = (firstName || '').trim().toLowerCase();
    const normLast = (lastName || '').trim().toLowerCase();
    const normMiddle = (middleName || '').trim().toLowerCase();
    const normDob = (dob || '').trim();

    // ── 5a. True Identity Check (Full Name + Date of Birth Collision) ──
    // A resident is a definite DUPLICATE if they have the exact same First Name,
    // Last Name, and Date of Birth in the barangay registry.
    // If they have the same name but DIFFERENT DOB, they are legitimate namesakes
    // (Senior/Junior, relatives, or namesakes in the barangay) -> ADVISORY.
    if (normFirst && normLast) {
        const { data: nameMatches } = await supabase
            .from('residents_records')
            .select('record_id, first_name, middle_name, last_name, dob')
            .ilike('last_name', normLast)
            .ilike('first_name', normFirst)
            .neq('activity_status', 'Archived');

        if (nameMatches?.length) {
            for (const match of nameMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                const existingMiddle = (match.middle_name || '').trim().toLowerCase();
                // If middle name is provided on both and does not match, they are different individuals
                if (normMiddle && existingMiddle && normMiddle !== existingMiddle) continue;

                const label = `${match.first_name} ${match.middle_name || ''} ${match.last_name}`.replace(/\s+/g, ' ').trim();
                const existingDob = (match.dob || '').trim();

                // If Date of Birth matches (and both are non-empty), this is an identical person!
                if (normDob && existingDob && normDob === existingDob) {
                    collisions.push({
                        field: 'full_name',
                        message: `Duplicate resident: "${label}" with date of birth ${normDob} is already registered in Barangay Engineer's Hill.`
                    });
                } else {
                    advisories.push({
                        field: 'full_name',
                        message: `Note: another resident named "${label}" is already registered (Birthdate: ${existingDob || 'N/A'}).`
                    });
                }
            }
        }
    }

    // ── 5b. Contact Number Match — SMART HOUSEHOLD / SHARED NUMBER CHECK ──
    // In Philippine communities, multiple family members frequently share a mobile phone.
    // - If no number is provided, skip cleanly.
    // - If phone matches a resident with the SAME name -> COLLISION (Duplicate Account).
    // - If phone matches a resident with a DIFFERENT name -> ADVISORY ONLY (Shared household number allowed).
    const safePhone = (contact_number || '').trim().replace(/\s+/g, '');
    if (safePhone && safePhone !== 'N/A' && safePhone !== 'NONE' && safePhone.length >= 7) {
        const { data: phoneMatches } = await supabase
            .from('residents_records')
            .select('record_id, first_name, middle_name, last_name, dob, contact_number')
            .eq('contact_number', safePhone)
            .neq('activity_status', 'Archived');

        if (phoneMatches?.length) {
            for (const match of phoneMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                const matchFirst = (match.first_name || '').trim().toLowerCase();
                const matchLast = (match.last_name || '').trim().toLowerCase();
                const matchDob = (match.dob || '').trim();

                const isSamePerson = (matchFirst === normFirst && matchLast === normLast) ||
                                     (normDob && matchDob && normDob === matchDob && matchLast === normLast);

                if (isSamePerson) {
                    collisions.push({
                        field: 'contact_number',
                        message: `Contact number "${safePhone}" is already registered under your name (${match.first_name} ${match.last_name}). Duplicate account is not allowed.`
                    });
                } else {
                    advisories.push({
                        field: 'contact_number',
                        message: `Notice: Contact number "${safePhone}" is shared with registered resident ${match.first_name} ${match.last_name}.`
                    });
                }
            }
        }
    }

    // ── 5c. Email Match — SMART HOUSEHOLD / PERSONAL CHECK ──
    const safeEmail = (email || '').trim().toLowerCase();
    if (safeEmail && safeEmail.includes('@')) {
        const { data: emailMatches } = await supabase
            .from('residents_records')
            .select('record_id, first_name, last_name, dob, email')
            .ilike('email', safeEmail)
            .neq('activity_status', 'Archived');

        if (emailMatches?.length) {
            for (const match of emailMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                const matchFirst = (match.first_name || '').trim().toLowerCase();
                const matchLast = (match.last_name || '').trim().toLowerCase();

                if (matchFirst === normFirst && matchLast === normLast) {
                    collisions.push({
                        field: 'email',
                        message: `Email "${safeEmail}" is already registered to you (${match.first_name} ${match.last_name}). Duplicate account is not allowed.`
                    });
                } else {
                    advisories.push({
                        field: 'email',
                        message: `Notice: Email "${safeEmail}" is shared with registered resident ${match.first_name} ${match.last_name}.`
                    });
                }
            }
        }
    }

    // ── 5d. Government ID Match — HARD BLOCK (GLOBAL) ──
    // National government IDs are strictly 1:1 per citizen.
    const idChecks = [
        ['voter_id_number', voterIdNumber, 'Voter ID'],
        ['pwd_id_number', pwdIdNumber, 'PWD ID'],
        ['four_ps_id_number', fourPsIdNumber, '4Ps ID'],
        ['solo_parent_id_number', soloParentIdNumber, 'Solo Parent ID'],
        ['senior_id_number', seniorIdNumber, 'Senior Citizen ID'],
        ['sss_id_number', sssIdNumber, 'SSS ID'],
        ['philhealth_id_number', philhealthIdNumber, 'PhilHealth ID'],
        ['other_id_number', otherIdNumber, 'Other ID'],
    ].filter(([, val]) => val && String(val).trim() !== '');

    for (const [column, rawVal, label] of idChecks) {
        const val = String(rawVal).trim().toUpperCase();
        const { data: idMatches } = await supabase
            .from('residents_records')
            .select(`record_id, first_name, last_name, ${column}`)
            .eq(column, val)
            .neq('activity_status', 'Archived');

        if (idMatches?.length) {
            for (const match of idMatches) {
                if (excludeId && match.record_id === excludeId) continue;
                collisions.push({
                    field: column,
                    message: `${label} "${val}" is already registered to ${match.first_name} ${match.last_name}.`
                });
            }
        }
    }

    return { collisions, advisories };
};

// 🛡️ DEFINED DATA HANDLERS (Matches Frontend restrictions)
const DATA_HANDLERS = ['superadmin', 'admin', 'barangaysecretary', 'secretary', 'barangayhall', 'bhw', 'barangayhealthworker'];

export const ResidentsRecordRouter = (router, supabase, authenticateToken) => {

    // =========================================================
    // ✅ ACCOUNT VERIFICATION — the resident proves they own the
    // email OR phone number on their record. Public endpoints (the
    // resident isn't logged in yet during credential distribution).
    // Channel is THEIR choice: 'email' (nodemailer/Resend) or 'sms'.
    // =========================================================

    // Resolve a resident from a username / email / contact number, without
    // ever revealing to the caller which of those exist in the registry.
    const findResidentForVerification = async (identifier) => {
        const needle = String(identifier || '').trim();
        if (!needle) return null;

        if (needle.includes('@') && needle.includes('.brg.ph')) {
            const { data: acct } = await supabase.from('residents_account')
                .select('resident_id').ilike('username', needle).maybeSingle();
            if (acct) {
                const { data: rec } = await supabase.from('residents_records')
                    .select('record_id, first_name, last_name, email, contact_number')
                    .eq('record_id', acct.resident_id).maybeSingle();
                return rec;
            }
            return null;
        }

        if (needle.includes('@')) {
            const { data: rec } = await supabase.from('residents_records')
                .select('record_id, first_name, last_name, email, contact_number')
                .ilike('email', needle).neq('activity_status', 'Archived').maybeSingle();
            return rec;
        }

        const phone = String(needle).replace(/\D/g, '');
        if (phone.length >= 10) {
            const { data: rec } = await supabase.from('residents_records')
                .select('record_id, first_name, last_name, email, contact_number')
                .eq('contact_number', phone.startsWith('63') ? `0${phone.slice(2)}` : phone)
                .neq('activity_status', 'Archived').maybeSingle();
            return rec;
        }
        return null;
    };

    // STEP 1 — request a code on the channel of the resident's choice.
    router.post('/residents/verify/request', async (req, res) => {
        try {
            const { identifier, channel } = req.body;
            if (!identifier || !['email', 'sms'].includes(channel)) {
                return res.status(400).json({ error: "identifier and channel ('email' | 'sms') are required." });
            }

            // Anti-enumeration: same response whether or not the account exists.
            const genericOk = { success: true, message: 'If the account exists, a verification code has been sent.' };

            const resident = await findResidentForVerification(identifier);
            if (!resident) return res.status(200).json(genericOk);

            // 60s cooldown per resident so the endpoint can't be used to spam texts.
            const existing = verifyOtpStore.get(resident.record_id);
            if (existing && Date.now() < existing.cooldown) {
                return res.status(429).json({ error: 'Please wait before requesting another code.' });
            }

            const code = generateVerifyCode(6);
            verifyOtpStore.set(resident.record_id, {
                codeHash: hashOtp(code),
                expires: Date.now() + 5 * 60 * 1000,
                cooldown: Date.now() + 60 * 1000,
                attempts: 0,
            });

            let delivered = false;
            if (channel === 'email' && resident.email) {
                delivered = await sendAutoMail(
                    resident.email,
                    'Resident Account Verification Code',
                    'Account Verification',
                    `Hello <b>${resident.first_name}</b>,<br><br>
                     Your Smart Barangay verification code is:<br><br>
                     <h1 style="background:#f8fafc;padding:15px;text-align:center;letter-spacing:6px;color:#d97706;">${code}</h1>
                     This code expires in 5 minutes. If you did not request it, ignore this email.`
                );
            } else if (channel === 'sms' && resident.contact_number) {
                delivered = await sendSms(
                    resident.contact_number,
                    `Smart Barangay verification code: ${code}. Valid for 5 minutes. - Brgy Engineer's Hill`
                );
            }

            if (!delivered) verifyOtpStore.delete(resident.record_id);
            // Same generic body either way — a failed provider shouldn't leak
            // which channel/contact details a record has.
            return res.status(200).json(genericOk);
        } catch (err) {
            console.error('[VERIFY REQUEST ERROR]', err.message);
            res.status(500).json({ error: 'Verification request failed.' });
        }
    });

    // STEP 2 — confirm the code; marks the login account verified.
    router.post('/residents/verify/confirm', async (req, res) => {
        try {
            const { identifier, otp } = req.body;
            if (!identifier || !otp) return res.status(400).json({ error: 'identifier and otp are required.' });

            const resident = await findResidentForVerification(identifier);
            const record = resident && verifyOtpStore.get(resident.record_id);
            if (!record) return res.status(400).json({ error: 'Invalid or expired verification session.' });

            if (Date.now() > record.expires) {
                verifyOtpStore.delete(resident.record_id);
                return res.status(400).json({ error: 'Code expired. Request a new one.' });
            }
            if (hashOtp(String(otp).trim()) !== record.codeHash) {
                record.attempts += 1;
                if (record.attempts >= 3) verifyOtpStore.delete(resident.record_id);
                return res.status(401).json({ error: 'Invalid verification code.' });
            }

            verifyOtpStore.delete(resident.record_id);

            // Persist the confirmation (needs `is_verified` boolean on residents_account).
            const { error: updErr } = await supabase.from('residents_account')
                .update({ is_verified: true }).eq('resident_id', resident.record_id);
            if (updErr) console.warn('[VERIFY] Could not persist is_verified:', updErr.message);

            logActivity(supabase, 'PUBLIC_VERIFY', 'RESIDENT_VERIFIED', resident.record_id, req).catch(() => {});
            res.json({ success: true, message: 'Account ownership confirmed.' });
        } catch (err) {
            console.error('[VERIFY CONFIRM ERROR]', err.message);
            res.status(500).json({ error: 'Verification failed.' });
        }
    });

    // REBUILD LEDGER — re-sign every block's data hash, then rebuild the linked
    // chain and ANCHOR the new head into the audit log (so deletion is detectable).
    router.post('/residents/ledger/rebuild',
        [authenticateToken, authorizeRoles(['superadmin', 'admin'])],
        async (req, res) => {
            try {
                const { data: all, error } = await supabase.from('residents_records').select('*');
                if (error) throw error;
                for (const r of all) {
                    const h = generateGenesisHash(r.first_name, r.middle_name, r.last_name, r.dob);
                    await supabase.from('residents_records').update({ genesis_hash: h }).eq('record_id', r.record_id);
                    r.genesis_hash = h; // keep the in-memory copy fresh for the chain build
                }

                const chain = buildResidentChain(all);
                await logActivity(
                    supabase,
                    req.user?.username || 'SYSTEM',
                    'LEDGER_ANCHOR',
                    `Re-signed & anchored linked chain head=${chain.head};blocks=${chain.total}`,
                    req
                ).catch(() => {});

                res.json({ message: "Global chain re-signed & anchored.", head: chain.head, blocks: chain.total });
            } catch (err) { res.status(500).json({ error: err.message }); }
        }
    );

    // VERIFY LEDGER — recompute the linked chain on demand and compare its head
    // against the last anchored head. Detects tampering (per-block) AND
    // deletion/reordering (head vs anchor mismatch).
    router.get('/residents/ledger/verify',
        [authenticateToken, authorizeRoles(['superadmin', 'admin'])],
        async (req, res) => {
            try {
                const { data: all, error } = await supabase
                    .from('residents_records')
                    .select('record_id, first_name, middle_name, last_name, dob, genesis_hash');
                if (error) throw error;

                const chain = buildResidentChain(all);
                const anchor = await getAnchoredHead(supabase);

                res.json({
                    head: chain.head,
                    total: chain.total,
                    compromised: chain.compromised,
                    unverified: chain.unverified,
                    anchored_head: anchor?.head || null,
                    anchored_at: anchor?.at || null,
                    head_matches_anchor: anchor ? anchor.head === chain.head : null,
                    blocks: chain.blocks
                });
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

                // 🔒 ANTI-DUPLICATE GATE — runs before any insert. Only `collisions`
                // (same person, per DOB/ID evidence) blocks; `advisories` (likely a
                // genuine namesake) are surfaced to the caller but never block.
                const { collisions, advisories } = await checkDuplicates(supabase, {
                    firstName: r.firstName,
                    middleName: r.middleName,
                    lastName: r.lastName,
                    dob: r.dob,
                    contact_number: r.contact_number,
                    email: r.email,
                    voterIdNumber: r.voterIdNumber,
                    pwdIdNumber: r.pwdIdNumber,
                    fourPsIdNumber: r.fourPsIdNumber,
                    soloParentIdNumber: r.soloParentIdNumber,
                    seniorIdNumber: r.seniorIdNumber,
                    sssIdNumber: r.sssIdNumber,
                    philhealthIdNumber: r.philhealthIdNumber,
                    otherIdNumber: r.otherIdNumber
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
                    sss_id_number: r.sssIdNumber || null,
                    philhealth_id_number: r.philhealthIdNumber || null,
                    other_id_number: r.otherIdNumber || null,
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

                    logActivity(supabase, req.user.username, 'RESIDENT_CREATED', profile.record_id, req).catch(() => {});

                    // 📨 ACCOUNT-CONFIRMATION (fire-and-forget) — the registration form asks
                    // BEFORE creating the account where the resident wants their credentials:
                    // their Gmail or their phone number (confirmationChannel: 'email'|'sms').
                    // Whichever channel is chosen but unusable falls back to the other, so
                    // credentials are never silently lost. A dead sender never blocks
                    // registration.
                    const channel = String(r.confirmationChannel || 'email').toLowerCase();
                    const sendCredsEmail = () => sendAutoMail(
                        profile.email,
                        'Your Smart Barangay Resident Account',
                        'Welcome to Barangay Engineer\'s Hill',
                        `Hello <b>${profile.first_name} ${profile.last_name}</b>,<br><br>
                         A resident account has been created for you in the Smart Barangay system.<br><br>
                         <b>Username:</b> ${username}<br>
                         <b>Temporary Password:</b> ${tempPass}<br><br>
                         You will be asked to set your own password on first login.
                         If you did not expect this account, please contact the Barangay Hall.`
                    );
                    const sendCredsSms = () => sendSms(
                        profile.contact_number,
                        `Smart Barangay: your resident account is ready. Username: ${username} Temp password: ${tempPass} (change it on first login). - Brgy Engineer's Hill`
                    );

                    if (channel === 'sms' && profile.contact_number) {
                        sendCredsSms().then(ok => {
                            if (!ok && profile.email) return sendCredsEmail();
                        }).catch(() => {});
                    } else if (profile.email) {
                        sendCredsEmail().then(ok => {
                            if (!ok && profile.contact_number) return sendCredsSms();
                        }).catch(() => {});
                    } else if (profile.contact_number) {
                        sendCredsSms().catch(() => {});
                    }

                    // Real-time broadcast for live dashboard and resident updates
                    broadcastRealtimeEvent('RESIDENTS_UPDATED', { action: 'CREATED', record_id: profile.record_id });
                    broadcastRealtimeEvent('STATS_UPDATED');

                    // Non-blocking heads-up (e.g. a same-named but distinct resident
                    // already on file) rides along on the success response.
                    res.status(201).json(advisories.length ? { ...profile, advisories } : profile);
                } catch (aErr) {
                    await supabase.from('residents_records').delete().eq('record_id', profile.record_id);
                    throw new Error("Rollback: Account creation failed.");
                }
            } catch (err) { res.status(500).json({ error: err.message }); }
        }
    );

    // =========================================================
    // 🔐 OTP-GATED RESIDENT REGISTRATION — used ONLY by the manual "+Add
    // Residents" admin form. CSV bulk import keeps using POST /residents
    // directly above; gating hundreds of rows behind individual one-time
    // codes isn't practical for a bulk workflow, and nothing here changes
    // that path.
    //
    // Flow: request-code validates + duplicate-checks + rate-limits + sends
    // a code, holding the ENTIRE validated payload server-side until
    // confirm-code verifies the code and performs the actual creation. The
    // client never gets to re-supply the payload at confirm time, so it
    // can't be tampered with between steps.
    // =========================================================
    const REGISTRATION_OTP_TTL_MS = 5 * 60 * 1000;
    const REGISTRATION_OTP_COOLDOWN_MS = 60 * 1000;
    const REGISTRATION_OTP_DAILY_CAP = 5;

    router.post('/residents/register/request-code',
        [authenticateToken, authorizeRoles(DATA_HANDLERS), validatePayload(residentSchema)],
        async (req, res) => {
            try {
                const r = req.body;
                const channel = String(r.confirmationChannel || 'email').toLowerCase();
                if (!['email', 'sms'].includes(channel)) {
                    return res.status(400).json({ error: "channel must be 'email' or 'sms'." });
                }

                const identifier = channel === 'email'
                    ? String(r.email || '').trim().toLowerCase()
                    : String(r.contact_number || '').trim();

                if (!identifier) {
                    return res.status(400).json({
                        error: `No ${channel === 'email' ? 'email address' : 'contact number'} provided to send the code to.`
                    });
                }

                // 🔒 ANTI-DUPLICATE GATE — same rule as POST /residents; don't burn
                // a code send on a registration that would be rejected anyway.
                const { collisions, advisories } = await checkDuplicates(supabase, {
                    firstName: r.firstName, middleName: r.middleName, lastName: r.lastName, dob: r.dob,
                    contact_number: r.contact_number, email: r.email,
                    voterIdNumber: r.voterIdNumber, pwdIdNumber: r.pwdIdNumber, fourPsIdNumber: r.fourPsIdNumber,
                    soloParentIdNumber: r.soloParentIdNumber, seniorIdNumber: r.seniorIdNumber,
                    sssIdNumber: r.sssIdNumber, philhealthIdNumber: r.philhealthIdNumber, otherIdNumber: r.otherIdNumber
                });
                if (collisions.length > 0) {
                    return res.status(409).json({
                        error: 'Duplicate Detected',
                        message: 'This record conflicts with an existing identity in the registry.',
                        collisions
                    });
                }

                // Housekeeping — drop stale rows so the table doesn't grow unbounded.
                await supabase.from('resident_registration_otp')
                    .delete()
                    .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

                // 🔒 RATE LIMIT — max 5 sends/day per identifier, 60s cooldown.
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const { count: sentToday } = await supabase.from('resident_registration_otp')
                    .select('*', { count: 'exact', head: true })
                    .eq('identifier', identifier)
                    .gte('created_at', todayStart.toISOString());

                if ((sentToday || 0) >= REGISTRATION_OTP_DAILY_CAP) {
                    return res.status(429).json({
                        error: `Daily code limit reached (${REGISTRATION_OTP_DAILY_CAP}/day) for this ${channel === 'email' ? 'email' : 'number'}. Try again tomorrow.`
                    });
                }

                const { data: lastSend } = await supabase.from('resident_registration_otp')
                    .select('created_at')
                    .eq('identifier', identifier)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (lastSend && Date.now() - new Date(lastSend.created_at).getTime() < REGISTRATION_OTP_COOLDOWN_MS) {
                    return res.status(429).json({ error: 'Please wait before requesting another code.' });
                }

                const code = generateVerifyCode(6);
                const { data: row, error: insertErr } = await supabase.from('resident_registration_otp').insert([{
                    identifier, channel,
                    code_hash: hashOtp(code),
                    payload: r,
                    created_by: req.user.username,
                    expires_at: new Date(Date.now() + REGISTRATION_OTP_TTL_MS).toISOString(),
                }]).select('id').single();
                if (insertErr) throw insertErr;

                let delivered = false;
                if (channel === 'email') {
                    delivered = await sendAutoMail(
                        identifier,
                        'Verify Resident Registration',
                        'Account Verification',
                        `A Smart Barangay staff member is registering <b>${r.firstName} ${r.lastName}</b> for a resident account using this email.<br><br>
                         Verification code:<br><br>
                         <h1 style="background:#f8fafc;padding:15px;text-align:center;letter-spacing:6px;color:#d97706;">${code}</h1>
                         This code expires in 5 minutes. If you did not expect this, ignore this email.`
                    );
                } else {
                    delivered = await sendSms(
                        identifier,
                        `Smart Barangay: verification code ${code} to confirm the resident account being created for ${r.firstName} ${r.lastName}. Valid 5 minutes. - Brgy Engineer's Hill`
                    );
                }

                if (!delivered) {
                    await supabase.from('resident_registration_otp').delete().eq('id', row.id);
                    return res.status(502).json({
                        error: `Failed to send the code via ${channel === 'email' ? 'email' : 'SMS'}. Try the other channel.`
                    });
                }

                return res.status(200).json({
                    success: true,
                    sessionId: row.id,
                    expiresInSec: REGISTRATION_OTP_TTL_MS / 1000,
                    advisories: advisories.length ? advisories : undefined
                });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        }
    );

    router.post('/residents/register/confirm-code',
        [authenticateToken, authorizeRoles(DATA_HANDLERS)],
        async (req, res) => {
            try {
                const { sessionId, code } = req.body;
                if (!sessionId || !code) return res.status(400).json({ error: 'sessionId and code are required.' });

                const { data: pending } = await supabase.from('resident_registration_otp')
                    .select('*').eq('id', sessionId).maybeSingle();
                if (!pending) return res.status(400).json({ error: 'Invalid or expired verification session.' });

                if (Date.now() > new Date(pending.expires_at).getTime()) {
                    await supabase.from('resident_registration_otp').delete().eq('id', sessionId);
                    return res.status(400).json({ error: 'Code expired. Request a new one.' });
                }

                if (hashOtp(String(code).trim()) !== pending.code_hash) {
                    const attempts = pending.attempts + 1;
                    if (attempts >= 3) {
                        await supabase.from('resident_registration_otp').delete().eq('id', sessionId);
                        return res.status(429).json({ error: 'Too many failed attempts. Request a new code.' });
                    }
                    await supabase.from('resident_registration_otp').update({ attempts }).eq('id', sessionId);
                    return res.status(401).json({ error: `Invalid code. ${3 - attempts} attempts remaining.` });
                }

                const r = pending.payload;

                // 🔒 Final safety net — another admin could have registered a
                // colliding phone/email/ID in the minutes since the code was sent.
                const { collisions, advisories } = await checkDuplicates(supabase, {
                    firstName: r.firstName, middleName: r.middleName, lastName: r.lastName, dob: r.dob,
                    contact_number: r.contact_number, email: r.email,
                    voterIdNumber: r.voterIdNumber, pwdIdNumber: r.pwdIdNumber, fourPsIdNumber: r.fourPsIdNumber,
                    soloParentIdNumber: r.soloParentIdNumber, seniorIdNumber: r.seniorIdNumber,
                    sssIdNumber: r.sssIdNumber, philhealthIdNumber: r.philhealthIdNumber, otherIdNumber: r.otherIdNumber
                });
                if (collisions.length > 0) {
                    await supabase.from('resident_registration_otp').delete().eq('id', sessionId);
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
                    sss_id_number: r.sssIdNumber || null,
                    philhealth_id_number: r.philhealthIdNumber || null,
                    other_id_number: r.otherIdNumber || null,
                    activity_status: r.activityStatus || 'Active'
                }]).select().single();
                if (pErr) throw pErr;

                try {
                    const f = profile.first_name[0] || '';
                    const m = profile.middle_name ? profile.middle_name[0] : '';
                    const l = profile.last_name[0] || '';
                    const rand = crypto.randomInt(100, 999);
                    const username = `${f}${m}${l}${rand}@residents.eng-hill.brg.ph`.toLowerCase();
                    const tempPass = generateTempPassword();
                    const pass = await bcrypt.hash(tempPass, 12);

                    const { error: acctErr } = await supabase.from('residents_account').insert([{
                        resident_id: profile.record_id,
                        username,
                        password: pass,
                        role: 'resident',
                        status: 'Active',
                        requires_reset: true,
                        is_verified: true  // ownership of the channel was just proven
                    }]);
                    if (acctErr) throw acctErr;

                    logActivity(supabase, req.user.username, 'RESIDENT_CREATED', profile.record_id, req).catch(() => {});

                    // 📨 Welcome message — fires ONLY now, after confirmation, on the
                    // same channel the code was sent to. Replaces the old
                    // fire-and-forget send that happened immediately at creation.
                    const welcomeHtml = `Hello <b>${profile.first_name} ${profile.last_name}</b>,<br><br>
                         Welcome to the Smart Barangay system! Your resident account has been created and verified.<br><br>
                         <b>Username:</b> ${username}<br>
                         <b>Temporary Password:</b> ${tempPass}<br><br>
                         You will be asked to set your own password on first login.`;
                    const welcomeSms = `Smart Barangay: welcome! Your account is ready. Username: ${username} Temp password: ${tempPass} (change it on first login). - Brgy Engineer's Hill`;

                    if (pending.channel === 'sms') {
                        await sendSms(profile.contact_number, welcomeSms).catch(() => {});
                    } else {
                        await sendAutoMail(profile.email, "Welcome to Barangay Engineer's Hill", "Welcome to Barangay Engineer's Hill", welcomeHtml).catch(() => {});
                    }

                    await supabase.from('resident_registration_otp').delete().eq('id', sessionId);
                    broadcastRealtimeEvent('RESIDENTS_UPDATED', { action: 'CREATED', record_id: profile.record_id });
                    broadcastRealtimeEvent('STATS_UPDATED');
                    res.status(201).json(advisories.length ? { ...profile, advisories } : profile);
                } catch (aErr) {
                    await supabase.from('residents_records').delete().eq('record_id', profile.record_id);
                    await supabase.from('resident_registration_otp').delete().eq('id', sessionId).catch(() => {});
                    throw new Error('Rollback: Account creation failed.');
                }
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
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
                const { collisions, advisories } = await checkDuplicates(supabase, {
                    firstName: r.firstName,
                    middleName: r.middleName,
                    lastName: r.lastName,
                    dob: r.dob,
                    contact_number: r.contact_number,
                    email: r.email,
                    voterIdNumber: r.voterIdNumber,
                    pwdIdNumber: r.pwdIdNumber,
                    fourPsIdNumber: r.fourPsIdNumber,
                    soloParentIdNumber: r.soloParentIdNumber,
                    seniorIdNumber: r.seniorIdNumber,
                    sssIdNumber: r.sssIdNumber,
                    philhealthIdNumber: r.philhealthIdNumber,
                    otherIdNumber: r.otherIdNumber
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
                    sss_id_number: r.sssIdNumber || null,
                    philhealth_id_number: r.philhealthIdNumber || null,
                    other_id_number: r.otherIdNumber || null,
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

                logActivity(supabase, req.user.username, 'IDENTITY_REPLACED', recordId, req).catch(() => {});
                broadcastRealtimeEvent('RESIDENTS_UPDATED', { action: 'UPDATED', record_id: recordId });
                broadcastRealtimeEvent('STATS_UPDATED');
                res.json(advisories.length ? { ...data[0], advisories } : data[0]);
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

                logActivity(supabase, req.user.username, 'RESIDENT_ARCHIVED', req.params.id, req).catch(() => {});
                broadcastRealtimeEvent('RESIDENTS_UPDATED', { action: 'ARCHIVED', record_id: req.params.id });
                broadcastRealtimeEvent('STATS_UPDATED');
                res.json({ success: true });
            } catch (err) { res.status(500).json({ error: "Archiving failed." }); }
        }
    );
};