# Resident OTP Registration, Duplicate-Rule Relaxation & Password Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate new resident-account creation behind a confirmed email/SMS code, relax duplicate detection so only phone/email/government-ID numbers block (never a name), and close the password-hardening gap that let an official account sit indefinitely on its auto-generated default password.

**Architecture:** Three independent-but-sequenced changes to the same Express + Supabase backend and React/TypeScript admin frontend: (1) a rewritten `checkDuplicates` in `ResidentsRecord.js` that both the OTP flow and the existing CRUD routes share; (2) two new OTP endpoints plus a two-stage `Resident_modal.tsx` UI; (3) a new shared `validateNewPassword` policy module wired into every password-set path, plus a `requires_reset` flag and forced-reset UI for officials mirroring the pattern residents already have.

**Tech Stack:** Express routers (function-injection pattern: `SomeRouter(router, supabase, authenticateToken)`), Supabase/Postgres (manual SQL, no migrations folder), React + TypeScript (Vite), bcryptjs, no test framework beyond a single hand-rolled `node diagnostic.test.js` script at the repo root.

## Global Constraints

- No `git push` at any point — all commits stay local on `feature/resident-otp-and-password-hardening`. Backup tag `backup/pre-otp-registration-2026-07-14` exists on `main` if anything needs reverting.
- This repo has no migrations folder — schema changes are run by hand in the Supabase SQL editor. The full SQL is already at `docs/superpowers/specs/2026-07-14-manual-sql.sql`; **it must be run against the actual database before Tasks 3 and 8 can be verified live** (the code will still typecheck/build without it, but the new endpoints will 500 until the table/column exist).
- This repo has no test runner (`jest`/`vitest`/`mocha` are absent from `package.json`). The one established testing convention is `diagnostic.test.js` at the repo root — a plain `node`-run script using `assert` that mirrors security-critical logic verbatim and asserts against it (`node diagnostic.test.js`). New pure-logic tests extend that file; DB-backed endpoint behavior is verified manually against the running dev server.
- Server entry point is `server.js` (`node server.js`, default port 8000); all API routes are mounted under `/api` (see `app.use('/api', dataRoutes)` in `server.js:200`). Frontend dev server is `npm run dev` (Vite, port 5173).
- Every router module follows the same pattern: `export const XRouter = (router, supabase, authenticateToken) => { router.post(...); ... }`, called once in `server/app.js`'s init block (lines 177–195) against one shared `router` instance. Adding a `router.post(...)` call inside an already-mounted module's function body requires **no** change to `server/app.js`.
- CSV bulk import (`data_backup.ts` → `POST /residents`) must keep working unmodified end-to-end — no OTP gating on that path, ever.

---

### Task 1: Rewrite `checkDuplicates` — name is advisory-only, ID numbers are checked globally

**Files:**
- Modify: `server/records/ResidentsRecord.js:228-346` (the entire `checkDuplicates` function)

**Interfaces:**
- Consumes: nothing new — same Supabase `residents_records` table already used.
- Produces: `checkDuplicates(supabase, { firstName, middleName, lastName, dob, contact_number, email, voterIdNumber, pwdIdNumber, fourPsIdNumber, soloParentIdNumber, seniorIdNumber, sssIdNumber, philhealthIdNumber, otherIdNumber }, excludeId = null) => Promise<{ collisions: Array<{field, message}>, advisories: Array<{field, message}> }>` — same signature and return shape as today, consumed unchanged by `POST /residents` (line 566), `PUT /residents/:id` (line 709), and the new Task 3 endpoints. `dob` is still accepted as a parameter for backward compatibility with callers but is no longer used to decide collisions.

Today, a full-name match combined with the same DOB (or a shared ID) hard-blocks as "same person." The new rule: **name never blocks**, full stop — it's always a non-blocking advisory. **Every government ID field is checked globally** (today it's only checked among records that already matched on name — two differently-named residents sharing an SSS number currently goes undetected).

- [ ] **Step 1: Replace the function body**

Replace `server/records/ResidentsRecord.js:228-346` (the full `checkDuplicates` function, from `const checkDuplicates = async (supabase, {` through the closing `};`) with:

```js
const checkDuplicates = async (supabase, {
    firstName, middleName, lastName, dob, contact_number, email,
    voterIdNumber, pwdIdNumber, fourPsIdNumber, soloParentIdNumber, seniorIdNumber,
    sssIdNumber, philhealthIdNumber, otherIdNumber
}, excludeId = null) => {
    const collisions = [];
    const advisories = [];

    // ── 5a. Full Name Match — ADVISORY ONLY. Never blocks, even when the DOB
    // or a government ID also matches — two records can legitimately be typed
    // in for the same name (or, per this policy, staff accept the risk of a
    // true duplicate slipping through in exchange for never blocking a real
    // namesake). Staff get a heads-up either way.
    const { data: nameMatches } = await supabase
        .from('residents_records')
        .select('record_id, first_name, middle_name, last_name')
        .ilike('last_name', lastName.trim())
        .ilike('first_name', firstName.trim())
        .neq('activity_status', 'Archived');

    if (nameMatches?.length) {
        const normMiddle = (middleName || '').trim().toLowerCase();
        for (const match of nameMatches) {
            if (excludeId && match.record_id === excludeId) continue;
            const existingMiddle = (match.middle_name || '').trim().toLowerCase();
            if (existingMiddle !== normMiddle) continue;

            const label = `${match.first_name} ${match.middle_name || ''} ${match.last_name}`.replace(/\s+/g, ' ').trim();
            advisories.push({
                field: 'full_name',
                message: `Note: another resident named "${label}" is already registered.`
            });
        }
    }

    // ── 5b. Contact Number Match — hard block, global (unchanged). ──
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

    // ── 5c. Email Match — hard block, global (unchanged). ──
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

    // ── 5d. Government ID Match — hard block, GLOBAL across every resident,
    // not just ones that already matched on name (this closes a real gap:
    // today two differently-named residents could share an SSS number
    // undetected). IDs are stored uppercased by the frontend (Resident_modal.tsx
    // uppercases every ID field on change), so `.eq()` against the uppercased
    // input is an exact, safe match — no `.ilike()` wildcard-injection risk
    // from a `%`/`_` character inside a real ID number.
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
```

- [ ] **Step 2: Typecheck / lint the backend file for syntax errors**

Run: `node --check server/records/ResidentsRecord.js`
Expected: no output (exit code 0). This only checks JS syntax validity, not runtime behavior — Step 3 covers that.

- [ ] **Step 3: Manual verification against the running dev server**

Start the server (`node server.js`) with valid `.env` values (Supabase URL/key, `SUPABASE_JWT_SECRET`, `ADMIN_GATE_KEY`). Log in as a data-handler role via the admin UI or `POST /api/admin/login` to get a valid `auth_token` cookie, then:

1. Create resident A (any name, DOB, no email/phone yet needed for this check).
2. Attempt to create resident B with the **same first+middle+last name and same DOB** as A. Expected: `201 Created` with an `advisories` array in the response body containing a `full_name` note — NOT a `409`.
3. Attempt to create resident C with a **different name** but the **same `contact_number`** as A. Expected: `409` with a `collisions` array containing a `contact_number` entry.
4. Attempt to create resident D with a **different name** but the **same `sssIdNumber`** as A (A must have one set). Expected: `409` with a `collisions` array containing an `sss_id_number` entry — this is the newly-closed gap; confirm it fails today (before this change) and blocks after.

- [ ] **Step 4: Commit**

```bash
git add server/records/ResidentsRecord.js
git commit -m "$(cat <<'EOF'
feat(residents): relax duplicate checks to phone/email/ID only, never name

Name matches are now always a non-blocking advisory, even when the DOB
also matches. Government ID numbers are now checked globally across
every resident instead of only within records that already matched on
name, closing a gap where two differently-named residents could share
an ID undetected.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Relax the CSV import's client-side duplicate pre-check to match

**Files:**
- Modify: `src/components/buttons/Tools/Resident_Model/data_backup.ts:114-162`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface change — `importResidentsFromCSV`'s signature is untouched.

CSV import has its own lightweight pre-check that runs before ever calling the backend, to avoid wasted requests. Its "RULE 1: Identity Match (Name + DOB)" would still silently skip a row the backend (after Task 1) would now accept — remove it so the two stay consistent. Email/phone pre-checks stay (still useful to avoid wasted requests); government-ID collisions aren't pre-checked here today and still won't be — the backend (Task 1's global ID check) remains the authority for those, and a colliding row will fail server-side and count toward the existing `failedRows` tally exactly as any other server rejection does today.

- [ ] **Step 1: Remove the name+DOB rule and its now-unused variables**

Replace `src/components/buttons/Tools/Resident_Model/data_backup.ts:114-150` (from the `// 🛡️ SMART COLLISION DETECTION ENGINE` comment through the end of `RULE 3`) with:

```ts
        // ==========================================================
        // 🛡️ SMART COLLISION DETECTION ENGINE
        // Name is intentionally NOT checked here — two residents can share a
        // name, and the backend now only blocks on phone/email/government ID
        // (see checkDuplicates in server/records/ResidentsRecord.js). ID-number
        // collisions aren't pre-checked client-side; the backend is the
        // authority for those and a colliding row fails server-side (counted
        // in failedRows, same as any other server rejection).
        // ==========================================================
        const csvEmail = (tempObj.email || '').trim().toLowerCase();
        const csvPhone = (tempObj.contact_number || tempObj.contactNumber || '').trim();

        let isDuplicate = false;
        let collisionReason = '';

        for (const existing of existingResidents) {
            const exEmail = (existing.email || '').trim().toLowerCase();
            const exPhone = (existing.contact_number || '').trim();

            // RULE 1: Digital ID Match
            if (csvEmail && exEmail && csvEmail === exEmail) {
                isDuplicate = true;
                collisionReason = `Email already in use (${csvEmail})`;
                break;
            }
            // RULE 2: Telecom Match (Must be valid length to avoid matching blanks)
            if (csvPhone && exPhone && csvPhone.length >= 10 && csvPhone === exPhone) {
                isDuplicate = true;
                collisionReason = `Phone number already registered (${csvPhone})`;
                break;
            }
        }
```

(Lines 151–161, the `if (isDuplicate) { ... continue; }` block and its closing `// ====...` comment, are unchanged — leave them exactly as-is immediately after this replacement.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no errors referencing `data_backup.ts` (pre-existing unrelated errors elsewhere, if any, are out of scope).

- [ ] **Step 3: Manual verification**

Prepare a CSV with two rows sharing the same first/last name and DOB but different emails/phones/no ID numbers. Import it via the admin Residents page ("Import CSV"). Expected: both rows import successfully (the summary shows `importedCount: 2`, `duplicateCount: 0`), where before this change the second row would have been skipped as a duplicate.

- [ ] **Step 4: Commit**

```bash
git add src/components/buttons/Tools/Resident_Model/data_backup.ts
git commit -m "$(cat <<'EOF'
fix(residents): stop CSV import's client pre-check from skipping name+DOB matches

Matches the backend's relaxed duplicate policy (name is never a
blocker) so a bulk import doesn't silently drop a legitimate row the
server would have accepted.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: OTP-gated registration endpoints (`request-code`, `confirm-code`)

**Files:**
- Modify: `server/records/ResidentsRecord.js` — insert new code after line 698 (the closing of `POST /residents`, before `PUT /residents/:id` at line 701)

**Interfaces:**
- Consumes: `checkDuplicates` (Task 1's new signature/behavior), `generateVerifyCode`, `hashOtp` (both already defined at file top, lines 17–22), `generateTempPassword` (line 9), `generateGenesisHash` (lines 126–129), `logActivity` (imported, signature `(supabase, actor, action, details, req=null)`), `sendAutoMail`, `sendSms` (both imported at file top), Supabase table `resident_registration_otp` (created via the manual SQL already at `docs/superpowers/specs/2026-07-14-manual-sql.sql` — **must be run before this task's live verification**).
- Produces: two new routes, `POST /residents/register/request-code` and `POST /residents/register/confirm-code`, consumed by Task 4's new `ApiService` methods.

**⚠️ Prerequisite:** run `docs/superpowers/specs/2026-07-14-manual-sql.sql` in the Supabase SQL editor before Step 3's live verification — the code will still pass Step 2 (syntax check) without it, but every request will 500.

- [ ] **Step 1: Insert the two new routes**

Insert the following into `server/records/ResidentsRecord.js` immediately after line 698 (`);` closing `POST /residents`) and before line 700's comment (`// PUT: 🛡️ UPDATE RESIDENT...`):

```js
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

                    await supabase.from('residents_account').insert([{
                        resident_id: profile.record_id,
                        username,
                        password: pass,
                        role: 'resident',
                        status: 'Active',
                        requires_reset: true,
                        is_verified: true  // ownership of the channel was just proven
                    }]);

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

```

- [ ] **Step 2: Syntax check**

Run: `node --check server/records/ResidentsRecord.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Manual verification against the running dev server**

Prerequisite: the SQL from `docs/superpowers/specs/2026-07-14-manual-sql.sql` has been run. Start `node server.js`, log in as a data-handler.

1. `POST /api/residents/register/request-code` with a full valid resident payload + `confirmationChannel: 'email'` (email must be a real inbox you control, or check server console — `sendAutoMail`/`sendSms` failures log to console per `Mailer.js`/`Sms.js`). Expected: `200` with `sessionId` and `expiresInSec: 300`, and no row yet in `residents_records`.
2. Confirm with a **wrong** code: `POST /api/residents/register/confirm-code` with the returned `sessionId` and `code: "000000"`. Expected: `401`, `"Invalid code. 2 attempts remaining."`.
3. Confirm with the **correct** code (read it from the email/console). Expected: `201` with the created profile; verify a new row now exists in `residents_records` AND `residents_account` (with `is_verified: true`), and the welcome email/SMS was sent (not the code — a second message).
4. Re-run step 1 six times in under a minute for the same identifier. Expected: the 6th request returns `429` with the daily-cap message (assuming the cooldown between the first few doesn't also trip — space them if needed to isolate the cap check from the cooldown check).
5. Repeat step 1, then let the code sit unused for 5+ minutes (or manually update `expires_at` in Supabase to the past), then confirm. Expected: `400`, `"Code expired. Request a new one."`.

- [ ] **Step 4: Commit**

```bash
git add server/records/ResidentsRecord.js
git commit -m "$(cat <<'EOF'
feat(residents): OTP-gate new resident account creation

Adds POST /residents/register/request-code and .../confirm-code. The
admin form now must get a confirmed email/SMS code before a resident
record + login account are created, closing the gap where credentials
were sent to a channel that was never proven reachable. CSV bulk
import is unaffected — it still calls POST /residents directly.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ApiService` methods for the registration OTP flow

**Files:**
- Modify: `src/components/UI/api.ts`

**Interfaces:**
- Consumes: `RESIDENTS_API` (already defined, line 42), `triggerAction` (already defined, lines 236–309).
- Produces: `ApiService.requestResidentRegistrationCode(payload: any) => Promise<{success: boolean, data?: any, error?: string}>` and `ApiService.confirmResidentRegistrationCode(sessionId: string, code: string) => Promise<{success: boolean, data?: any, error?: string}>`, consumed by Task 5's `Resident_modal.tsx`.

- [ ] **Step 1: Add the two methods**

In `src/components/UI/api.ts`, immediately after the existing `saveResident` method (after line 497's closing `),`, before `deleteResident` at line 499), insert:

```ts
  requestResidentRegistrationCode: (payload: any) =>
    triggerAction(`${RESIDENTS_API}/register/request-code`, 'POST', payload),

  confirmResidentRegistrationCode: (sessionId: string, code: string) =>
    triggerAction(`${RESIDENTS_API}/register/confirm-code`, 'POST', { sessionId, code }),

```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/UI/api.ts
git commit -m "$(cat <<'EOF'
feat(api): add ApiService methods for resident registration OTP flow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Two-stage OTP UI in `Resident_modal.tsx`

**Files:**
- Modify: `src/components/buttons/Resident_modal.tsx`

**Interfaces:**
- Consumes: `ApiService.requestResidentRegistrationCode`, `ApiService.confirmResidentRegistrationCode` (Task 4).
- Produces: no external interface change — `onSuccess(newRecord)` still fires the same way on final success, so `Resident.tsx`'s `handleModalSuccess` (unmodified) keeps working.

Only **create mode** changes. Update mode (`isUpdateMode`) keeps its existing single-step `ApiService.saveResident` submit path exactly as-is.

- [ ] **Step 1: Add registration-stage state**

In `src/components/buttons/Resident_modal.tsx`, after line 71 (`const [confirmationChannel, setConfirmationChannel] = useState<'email' | 'sms'>('email');`), insert:

```tsx
  // 🔐 Two-stage OTP registration (create mode only). 'form' = still editing;
  // 'code-pending' = a code was sent, waiting on confirmation.
  const [registrationStage, setRegistrationStage] = useState<'form' | 'code-pending'>('form');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [codeExpiresAt, setCodeExpiresAt] = useState<number | null>(null);
  const [resendCooldownUntil, setResendCooldownUntil] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
```

- [ ] **Step 2: Add a countdown tick effect**

After the state block from Step 1, insert:

```tsx
  useEffect(() => {
    if (registrationStage !== 'code-pending') return;
    const tick = () => {
      const target = Math.max(codeExpiresAt || 0, resendCooldownUntil || 0);
      setSecondsLeft(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [registrationStage, codeExpiresAt, resendCooldownUntil]);
```

- [ ] **Step 3: Reset the OTP stage whenever the modal (re)opens**

In the existing `useEffect(() => { if (isOpen) { ... } }, [isOpen, residentData]);` block (starts at line 101), inside the `if (isOpen) { ... }` body, immediately before its closing brace (right after the existing `setIsClosingPopup(false);` at line 169), add:

```tsx
      setRegistrationStage('form');
      setSessionId(null);
      setCodeInput('');
      setCodeExpiresAt(null);
      setResendCooldownUntil(null);
```

- [ ] **Step 4: Add the "send code" handler**

Immediately before the existing `onSubmit` function (line 282), insert a new handler that reuses the exact same validation the current `onSubmit` runs, but calls `request-code` instead of `saveResident`:

```tsx
  const handleSendCode = async () => {
    const missingGovIds = [
      govIdChecks.sss && !formData.sssIdNumber?.trim() && 'SSS ID #',
      govIdChecks.philhealth && !formData.philhealthIdNumber?.trim() && 'PHILHEALTH ID #',
      govIdChecks.other && !formData.otherIdNumber?.trim() && 'OTHER VALID ID #',
    ].filter(Boolean);
    if (missingGovIds.length > 0) {
      setGlobalError(`Required ID number missing: ${missingGovIds.join(', ')}`);
      if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const valErrors = validateResidentForm(formData);
    if (Object.keys(valErrors).length > 0) {
      setErrors(valErrors);
      const failedKeys = Object.keys(valErrors).map(k => k.replace(/([A-Z])/g, ' $1').toUpperCase()).join(', ');
      setGlobalError(`Missing or invalid data in: ${failedKeys}`);
      if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const destination = confirmationChannel === 'email' ? formData.email : formData.contact_number;
    if (!destination) {
      setGlobalError(`No ${confirmationChannel === 'email' ? 'email address' : 'contact number'} entered above to send the code to.`);
      if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setGlobalError('');
    setIsLoading(true);

    const safePayload = {
      firstName: formData.firstName, lastName: formData.lastName, middleName: formData.middleName,
      sex: formData.sex, dob: formData.dob, birthCountry: formData.birthCountry,
      birthProvince: formData.birthProvince, birthCity: formData.birthCity, birthPlace: formData.birthPlace,
      nationality: formData.nationality, religion: formData.religion, contact_number: formData.contact_number,
      email: formData.email, currentAddress: formData.currentAddress, purok: formData.purok,
      civilStatus: formData.civilStatus, education: formData.education, employment: formData.employment,
      employmentStatus: formData.employmentStatus, occupation: formData.occupation, isVoter: formData.isVoter,
      isPWD: formData.isPWD, is4Ps: formData.is4Ps, isSoloParent: formData.isSoloParent,
      isSeniorCitizen: formData.isSeniorCitizen,
      voterIdNumber: formData.voterIdNumber, pwdIdNumber: formData.pwdIdNumber,
      soloParentIdNumber: formData.soloParentIdNumber, seniorIdNumber: formData.seniorIdNumber,
      fourPsIdNumber: formData.fourPsIdNumber,
      sssIdNumber: formData.sssIdNumber, philhealthIdNumber: formData.philhealthIdNumber,
      otherIdNumber: formData.otherIdNumber,
      activityStatus: formData.activityStatus,
      confirmationChannel,
    };

    try {
      const result = await ApiService.requestResidentRegistrationCode(safePayload);
      if (result.success) {
        setSessionId(result.data.sessionId);
        setCodeExpiresAt(Date.now() + result.data.expiresInSec * 1000);
        setResendCooldownUntil(Date.now() + 60 * 1000);
        setRegistrationStage('code-pending');
      } else {
        setGlobalError(`Server Rejected: ${result.error}`);
        if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (error) {
      setGlobalError('Network Error: Failed to connect to the server.');
      if (scrollRef.current) scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmCode = async () => {
    if (!sessionId) return;
    setGlobalError('');
    setIsLoading(true);
    try {
      const result = await ApiService.confirmResidentRegistrationCode(sessionId, codeInput.trim());
      if (result.success) {
        setSuccessMessage('Identity Registered Successfully');
        setTimeout(() => {
          setIsClosingPopup(true);
          setTimeout(() => {
            setSuccessMessage('');
            setIsClosingPopup(false);
            onSuccess(result.data);
            onClose();
          }, 300);
        }, 800);
      } else {
        setGlobalError(result.error || 'Verification failed.');
      }
    } catch (error) {
      setGlobalError('Network Error: Failed to connect to the server.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditDetails = () => {
    setRegistrationStage('form');
    setSessionId(null);
    setCodeInput('');
    setCodeExpiresAt(null);
    setGlobalError('');
  };
```

- [ ] **Step 5: Wire the form's submit to branch on mode**

Replace the existing `<form onSubmit={onSubmit} ...>` opening tag (line 427) with a form that, in create mode, prevents default submission and delegates to the two new handlers based on stage — leaving update mode's `onSubmit={onSubmit}` untouched:

```tsx
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isUpdateMode) return onSubmit(e);
            if (registrationStage === 'form') return handleSendCode();
            return handleConfirmCode();
          }}
          className="RMS_FORM"
          ref={scrollRef}
          style={{ overflowY: 'auto' }}
        >
```

- [ ] **Step 6: Disable form fields while a code is pending**

In the `<div className="RMS_BODY">` block, wrap the existing sections (`Personal Identity` through `Classifications & Special IDs` — everything between line 438's `<div className="RMS_SECTION">` and line 708's closing `)}` for the Account Confirmation conditional) in a `<fieldset>` so they visually and functionally lock without individually touching every input:

Replace the opening `<div className="RMS_SECTION">` at line 438 with:

```tsx
            <fieldset disabled={registrationStage === 'code-pending'} style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="RMS_SECTION">
```

And immediately before the `{/* 📨 Asked BEFORE the account is created... */}` comment (line 710), close the fieldset:

```tsx
            </fieldset>
```

(This wraps sections "Personal Identity" through "Classifications & Special IDs" only — the Account Confirmation section itself, handled next, stays outside the fieldset since it needs to remain interactive to show the code-entry UI.)

- [ ] **Step 7: Replace the Account Confirmation section with the two-stage UI**

Replace the entire `{!isUpdateMode && ( <div className="RMS_SECTION"> ... </div> )}` block (lines 712–744) with:

```tsx
            {!isUpdateMode && (
              <div className="RMS_SECTION">
                <div className="RMS_SEC_TITLE">Account Confirmation</div>

                {registrationStage === 'form' ? (
                  <>
                    <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
                      A verification code will be sent to the channel you choose. The resident's
                      account is only created after that code is confirmed.
                    </p>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      {([
                        { key: 'email', icon: 'fa-envelope', label: 'Gmail / Email', dest: formData.email },
                        { key: 'sms', icon: 'fa-mobile-alt', label: 'Text (SMS)', dest: formData.contact_number },
                      ] as const).map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setConfirmationChannel(opt.key)}
                          style={{
                            flex: 1, padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
                            textAlign: 'left', fontWeight: 700, fontSize: '0.82rem',
                            border: confirmationChannel === opt.key ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                            background: confirmationChannel === opt.key ? 'rgba(59,130,246,0.08)' : 'transparent',
                            color: confirmationChannel === opt.key ? '#2563eb' : 'inherit',
                          }}
                        >
                          <i className={`fas ${opt.icon}`} style={{ marginRight: 6 }}></i>{opt.label}
                          <div style={{ fontSize: '0.72rem', fontWeight: 500, marginTop: 4, color: opt.dest ? 'inherit' : '#ef4444' }}>
                            {opt.dest || 'not provided above'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '0 0 12px', fontSize: '0.78rem', color: 'var(--text-muted, #64748b)' }}>
                      Enter the 6-digit code sent to{' '}
                      <b>{confirmationChannel === 'email' ? formData.email : formData.contact_number}</b>.
                      {codeExpiresAt && codeExpiresAt > Date.now() && ` Expires in ${secondsLeft}s.`}
                    </p>
                    <input
                      className="RMS_INPUT"
                      value={codeInput}
                      onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      style={{ fontSize: '1.4rem', letterSpacing: '6px', textAlign: 'center', maxWidth: 200 }}
                    />
                    <div style={{ display: 'flex', gap: '12px', marginTop: '10px', alignItems: 'center' }}>
                      <button type="button" onClick={handleEditDetails} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}>
                        ◀ Edit Details
                      </button>
                      <button
                        type="button"
                        onClick={handleSendCode}
                        disabled={!!resendCooldownUntil && resendCooldownUntil > Date.now()}
                        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline', opacity: (resendCooldownUntil && resendCooldownUntil > Date.now()) ? 0.5 : 1 }}
                      >
                        Resend Code{resendCooldownUntil && resendCooldownUntil > Date.now() ? ` (${secondsLeft}s)` : ''}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
```

- [ ] **Step 8: Update the submit button label**

Replace the button label expression at line 761 (`isUpdateMode ? 'UPDATE RECORD' : 'CONFIRM REGISTRATION'`) with:

```tsx
                isUpdateMode ? 'UPDATE RECORD' : (registrationStage === 'form' ? 'SEND CODE' : 'VERIFY & CREATE ACCOUNT')
```

- [ ] **Step 9: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no new errors referencing `Resident_modal.tsx`.

- [ ] **Step 10: Manual browser verification**

With `docs/superpowers/specs/2026-07-14-manual-sql.sql` already run and both dev servers up (`node server.js`, `npm run dev`):

1. Open Residents → "+ Add Residents". Fill the form with a real email you can check. Click "SEND CODE". Expected: button becomes "VERIFY & CREATE ACCOUNT", the form section above the Account Confirmation area visually disables, and a code arrives at the email.
2. Enter the wrong code, submit. Expected: inline error, form stays on the code stage.
3. Click "◀ Edit Details". Expected: returns to the editable form stage with previously-entered data intact.
4. Click "SEND CODE" again, enter the correct code, submit. Expected: the existing "Identity Registered Successfully" popup appears, modal closes, and the new resident's row is highlighted in the table (via the unchanged `handleModalSuccess`/`onSuccess` path).

- [ ] **Step 11: Commit**

```bash
git add src/components/buttons/Resident_modal.tsx
git commit -m "$(cat <<'EOF'
feat(residents): two-stage Send Code / Verify UI for new resident accounts

Create mode now sends a verification code before creating anything;
update mode is unchanged. Form fields lock while a code is pending,
with resend/expiry controls and an edit-details escape hatch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Shared password policy module + tests

**Files:**
- Create: `server/lib/PasswordPolicy.js`
- Modify: `diagnostic.test.js` (extend the repo's one established test script)

**Interfaces:**
- Consumes: `bcrypt.compare` (from `bcryptjs`, already a dependency).
- Produces: `validateNewPassword(newPassword: string, { currentHash?: string|null, firstName?: string, username?: string }) => Promise<string | null>` — returns an error message string when the password is rejected, `null` when it's valid. Consumed by Task 7.

- [ ] **Step 1: Write the module**

Create `server/lib/PasswordPolicy.js`:

```js
import bcrypt from 'bcryptjs';

// Rejects a proposed NEW password before it's hashed and stored. Runs at
// every password-set path (self-service reset, admin-assisted reset,
// first-login forced reset) so the rule can't be bypassed via a different
// route. `context` identifies the account the password is being set FOR, so
// the "still the generated shape" check can be evaluated against THEIR OWN
// name/username rather than a generic pattern.
//
// Returns null when the password is acceptable, or a user-facing error
// string identifying exactly what's wrong.
export const validateNewPassword = async (newPassword, { currentHash = null, firstName = '', username = '' } = {}) => {
    const pass = String(newPassword || '');

    if (pass.length < 8) {
        return 'Password must be at least 8 characters.';
    }

    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
    const classCount = classes.filter(re => re.test(pass)).length;
    if (classCount < 3) {
        return 'Password must contain at least 3 of: lowercase letters, uppercase letters, numbers, symbols.';
    }

    const cleanFirst = String(firstName || '').trim().toLowerCase();
    const cleanUser = String(username || '').split('@')[0].trim().toLowerCase();
    const lowerPass = pass.toLowerCase();

    if ((cleanFirst && lowerPass === cleanFirst) || (cleanUser && lowerPass === cleanUser)) {
        return 'Password must not be your own name or username.';
    }

    // "Still the generated shape" — name (or username) immediately followed by
    // trailing digits, e.g. felizardo123456 or beh001123456. Catches a
    // "reset" that only tweaks the digits and keeps the guessable structure.
    if (cleanFirst && new RegExp(`^${cleanFirst}\\d{4,6}$`).test(lowerPass)) {
        return 'Password is too predictable — do not use your name followed by numbers.';
    }
    if (cleanUser && new RegExp(`^${cleanUser}\\d{4,6}$`).test(lowerPass)) {
        return 'Password is too predictable — do not use your username followed by numbers.';
    }

    if (currentHash) {
        const unchanged = await bcrypt.compare(pass, currentHash);
        if (unchanged) {
            return 'New password must be different from your current password.';
        }
    }

    return null;
};
```

- [ ] **Step 2: Write the failing tests first**

Read `diagnostic.test.js` in full to see its exact `test`/`section` helpers and import block (already summarized above: `test(name, fn)` runs `fn`, logs ✓/✗, tracks `passed`/`failed`; `section(title)` prints a header). Add this import alongside the existing ones at the top of the file:

```js
import { validateNewPassword } from './server/lib/PasswordPolicy.js';
```

Then add a new section, placed after the existing sections (before the final summary print — find where the file currently prints `passed`/`failed` totals and insert immediately before that):

```js
section('Password Policy (server/lib/PasswordPolicy.js)');

await test('rejects passwords under 8 characters', async () => {
    const err = await validateNewPassword('Ab1!');
    assert.ok(err && /8 characters/.test(err));
});

await test('rejects passwords with fewer than 3 character classes', async () => {
    const err = await validateNewPassword('alllowercase');
    assert.ok(err && /3 of/.test(err));
});

await test('accepts a strong, unrelated password', async () => {
    const err = await validateNewPassword('Tr0ub4dor&9', { firstName: 'felizardo', username: 'fma002@pb.officials.eng-hill.brg.ph' });
    assert.strictEqual(err, null);
});

await test('rejects a password matching the own-name+digits generated shape', async () => {
    const err = await validateNewPassword('Felizardo123456', { firstName: 'felizardo' });
    assert.ok(err && /too predictable/.test(err));
});

await test('rejects a password matching the barangay-hall generatedId+digits shape', async () => {
    const err = await validateNewPassword('Beh001123456', { username: 'beh001@bh.officials.eng-hill.brg.ph' });
    assert.ok(err && /too predictable/.test(err));
});

await test('rejects a password unchanged from the current hash', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const currentHash = await bcrypt.hash('SomeExisting1!', 10);
    const err = await validateNewPassword('SomeExisting1!', { currentHash });
    assert.ok(err && /different from your current password/.test(err));
});

await test('accepts a genuinely new password different from the current hash', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const currentHash = await bcrypt.hash('SomeExisting1!', 10);
    const err = await validateNewPassword('BrandNew$2Value', { currentHash });
    assert.strictEqual(err, null);
});
```

- [ ] **Step 3: Run and confirm it fails before the module exists / passes after**

Run: `node diagnostic.test.js`
Before Step 1 is saved, this fails with a module-not-found error for `./server/lib/PasswordPolicy.js`. After Step 1 is saved, expected: all 7 new assertions print `✓`, and the file's final summary shows the previous passing count plus 7, with `failed: 0`.

- [ ] **Step 4: Commit**

```bash
git add server/lib/PasswordPolicy.js diagnostic.test.js
git commit -m "$(cat <<'EOF'
feat(security): shared password-strength/pattern validator

Rejects a new password that's unchanged from the current one, still
matches the account's own auto-generated {name}+digits shape, or
fails a baseline strength bar. One function, meant to be wired into
every password-set endpoint so the rule can't be bypassed via a
different route.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire the validator into `Account_Management.js`

**Files:**
- Modify: `server/auth/Account_Management.js`

**Interfaces:**
- Consumes: `validateNewPassword` (Task 6).
- Produces: no interface change to the two routes — same request/response shapes, just an added `400` rejection path plus (for officials) `requires_reset` now getting cleared like residents already do.

- [ ] **Step 1: Import the validator**

Add after the existing imports (after line 6, `import { RateLimiterMemory } from 'rate-limiter-flexible';`):

```js
import { validateNewPassword } from '../lib/PasswordPolicy.js';
```

- [ ] **Step 2: Wire it into `POST /accounts/public-reset`**

Replace the full route body at `server/auth/Account_Management.js:229-259` with:

```js
    router.post('/accounts/public-reset', async (req, res) => {
        try {
            const { identifier, otp, newPassword } = req.body;
            const identifierNorm = identifier?.toLowerCase().trim();

            const userData = await findUserEmail(identifierNorm);
            if (!userData) return res.status(400).json({ error: 'Account could not be verified.' });

            const targetMapKey = (userData.email || userData.accountId).toLowerCase();
            const stored = otpStore.get(targetMapKey);

            if (!stored || !stored.verified) return res.status(400).json({ error: 'OTP not verified or expired.' });

            const table = userData.role === 'official' ? 'officials_accounts' : 'residents_account';
            const idColumn = userData.role === 'official' ? 'account_id' : 'resident_id';
            const { data: acctRow } = await supabase.from(table).select('password, username').eq(idColumn, userData.accountId).maybeSingle();

            const policyError = await validateNewPassword(newPassword, {
                currentHash: acctRow?.password,
                firstName: userData.firstName,
                username: acctRow?.username,
            });
            if (policyError) return res.status(400).json({ error: policyError });

            if (userData.role === 'official') {
                const { error } = await supabase.from('officials_accounts').update({ password: hashPassword(newPassword), requires_reset: false }).eq('account_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
            } else {
                const { error } = await supabase.from('residents_account').update({ password: hashPassword(newPassword) }).eq('resident_id', userData.accountId);
                if (error) return res.status(500).json({ error: 'Database synchronization failed.' });
                await supabase.from('residents_account').update({ requires_reset: false }).eq('resident_id', userData.accountId);
            }

            otpStore.delete(targetMapKey);
            return res.status(200).json({ success: true, message: 'Password reset successful.' });

        } catch (error) {
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    });
```

- [ ] **Step 3: Wire it into `PATCH /accounts/reset/:accountId`**

Replace the full route body at `server/auth/Account_Management.js:265-346` with (the OTP-verification block for `isAdmin && !isSelf`, originally lines 282–315, is unchanged — copy it through verbatim as shown):

```js
    router.patch('/accounts/reset/:accountId', authenticateToken, async (req, res) => {
        try {
            const userRole = (req.user?.user_role || req.user?.role || '').toLowerCase().trim();
            const loggedInUserId = req.user?.account_id || req.user?.sub;
            const targetId = req.params.accountId;

            const adminRoles = ['superadmin', 'punongbarangay', 'barangaysecretary', 'barangayhall'];
            const isAdmin = adminRoles.includes(userRole);
            const isSelf = String(loggedInUserId) === String(targetId);

            if (!isAdmin && !isSelf) {
                return res.status(403).json({ error: 'Access Denied. You lack permissions.' });
            }

            const { password, otp } = req.body;
            if (!password) return res.status(400).json({ error: 'New password is required.' });

            if (isAdmin && !isSelf) {
                if (!otp) return res.status(400).json({ error: 'Security verification code is required.' });

                let targetMapKey = null;

                const { data: resAccRow } = await supabase.from('residents_account').select('resident_id').eq('account_id', targetId).maybeSingle();

                if (resAccRow?.resident_id) {
                    const { data: resRecord } = await supabase.from('residents_records').select('email').eq('record_id', resAccRow.resident_id).maybeSingle();
                    targetMapKey = resRecord?.email || resAccRow.resident_id;
                } else {
                    const { data: offAuth } = await supabase.from('officials_accounts').select('official_id').eq('account_id', targetId).maybeSingle();
                    if (offAuth) {
                        const { data: offData } = await supabase.from('officials').select('email').eq('id', offAuth.official_id).maybeSingle();
                        targetMapKey = offData?.email ? offData.email : targetId;
                    }
                }

                if (!targetMapKey) return res.status(404).json({ error: 'Target account corrupted.' });

                const mapKey = String(targetMapKey).toLowerCase();
                const stored = otpStore.get(mapKey);
                if (!stored) return res.status(400).json({ error: 'No active verification code found.' });
                if (Date.now() > stored.expires) {
                    otpStore.delete(mapKey);
                    return res.status(400).json({ error: 'Verification code expired.' });
                }
                if (hashOtp(otp.trim()) !== stored.codeHash) {
                    stored.attempts += 1;
                    if (stored.attempts >= 3) otpStore.delete(mapKey);
                    return res.status(401).json({ error: 'Invalid verification code.' });
                }
                otpStore.delete(mapKey);
            }

            // 🔒 Locate the target account (resident or official) and its current
            // password hash / name, so the shared policy can check "unchanged"
            // and "still the default shape" before anything is written.
            const { data: resAcct } = await supabase.from('residents_account')
                .select('resident_id, password, username').or(`account_id.eq.${targetId},resident_id.eq.${targetId}`).maybeSingle();

            let currentHash = null, accountFirstName = '', accountUsername = '', table = null;
            if (resAcct) {
                currentHash = resAcct.password;
                accountUsername = resAcct.username;
                const { data: profile } = await supabase.from('residents_records').select('first_name').eq('record_id', resAcct.resident_id).maybeSingle();
                accountFirstName = profile?.first_name || '';
                table = 'residents_account';
            } else {
                const { data: offAcct } = await supabase.from('officials_accounts').select('account_id, password, username, official_id').eq('account_id', targetId).maybeSingle();
                if (offAcct) {
                    currentHash = offAcct.password;
                    accountUsername = offAcct.username;
                    const { data: offProfile } = await supabase.from('officials').select('full_name').eq('id', offAcct.official_id).maybeSingle();
                    accountFirstName = (offProfile?.full_name || '').trim().split(/\s+/)[0] || '';
                    table = 'officials_accounts';
                }
            }

            if (!table) return res.status(404).json({ error: 'Account not found.' });

            const policyError = await validateNewPassword(password, { currentHash, firstName: accountFirstName, username: accountUsername });
            if (policyError) return res.status(400).json({ error: policyError });

            const securePass = hashPassword(password);

            if (table === 'residents_account') {
                const { data: resData } = await supabase
                    .from('residents_account')
                    .update({ password: securePass, requires_reset: false })
                    .or(`account_id.eq.${targetId},resident_id.eq.${targetId}`)
                    .select();
                if (resData && resData.length > 0) {
                    return res.json({ success: true, message: 'Password updated successfully.' });
                }
            } else {
                const { data: offData } = await supabase
                    .from('officials_accounts')
                    .update({ password: securePass, requires_reset: false })
                    .eq('account_id', targetId)
                    .select();
                if (offData && offData.length > 0) {
                    return res.json({ success: true, message: 'Official password updated successfully.' });
                }
            }

            return res.status(404).json({ error: 'Account not found.' });

        } catch (err) {
            res.status(500).json({ error: 'Database synchronization failed.' });
        }
    });
```

Note: `officials_accounts.requires_reset` referenced here requires Task 8's SQL (already covered by the same manual-SQL file) to have been run — the column must exist before this route can update it.

- [ ] **Step 4: Syntax check**

Run: `node --check server/auth/Account_Management.js`
Expected: no output.

- [ ] **Step 5: Manual verification**

With the server running and the `requires_reset` column present on `officials_accounts` (Task 8's SQL):

1. `PATCH /api/accounts/reset/:accountId` (self-reset, no `otp` needed) with `password: "Felizardo123456"` for an official whose name is Felizardo. Expected: `400`, `"Password is too predictable — do not use your name followed by numbers."`.
2. Same request with `password: "<their current password>"`. Expected: `400`, `"New password must be different from your current password."`.
3. Same request with `password: "Tr0ub4dor&9"` (or any strong, unrelated password). Expected: `200`, `"Password updated successfully."` (or `"Official password updated successfully."`), and `requires_reset` is now `false` for that account.

- [ ] **Step 6: Commit**

```bash
git add server/auth/Account_Management.js
git commit -m "$(cat <<'EOF'
feat(security): enforce password policy on every reset endpoint

Both /accounts/public-reset and /accounts/reset/:accountId now reject
a new password that's unchanged, still matches the account's own
generated-password shape, or is otherwise weak — for both residents
and officials.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: `requires_reset` on the officials login response

**Files:**
- Modify: `server/auth/OfficialsLogin.js`

**Interfaces:**
- Consumes: `officials_accounts.requires_reset` column (created by the manual SQL already delivered — **must be run before this task's live verification**).
- Produces: `POST /admin/login`'s success response now includes `requires_reset: boolean` and `profile.is_first_login: boolean`, consumed by Task 9.

- [ ] **Step 1: Add `requires_reset` to the account select**

In `server/auth/OfficialsLogin.js`, replace the `.select(...)` call (part of the query at lines 223–226) — find:

```js
                .select(`
                    account_id, username, password, role, official_id, theme_preference,
                    officials ( full_name, position, status )
                `)
```

Replace with:

```js
                .select(`
                    account_id, username, password, role, official_id, theme_preference, requires_reset,
                    officials ( full_name, position, status )
                `)
```

- [ ] **Step 2: Include it in the success response**

Replace the standard-login success `res.status(200).json({...})` call (lines 257–274) — find:

```js
            res.status(200).json({
                message: 'Authentication successful',
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole,
                term_status: restricted ? 'restricted' : 'active',
                theme_preference: accountData.theme_preference || 'light',
                profile: {
                    record_id: accountData.official_id,
                    profileName: accountData.officials?.full_name,
                    position: position,
                    role: userRole,
                    term_status: restricted ? 'restricted' : 'active',
                    // Distinguishes WHY access is restricted (Suspended/Resigned) so
                    // the lock screen can explain which one applies.
                    official_status: accountData.officials?.status || 'Active',
                }
            });
```

Replace with:

```js
            res.status(200).json({
                message: 'Authentication successful',
                account_id: accountData.account_id,
                username: accountData.username,
                role: userRole,
                term_status: restricted ? 'restricted' : 'active',
                theme_preference: accountData.theme_preference || 'light',
                requires_reset: accountData.requires_reset,
                profile: {
                    record_id: accountData.official_id,
                    profileName: accountData.officials?.full_name,
                    position: position,
                    role: userRole,
                    term_status: restricted ? 'restricted' : 'active',
                    // Distinguishes WHY access is restricted (Suspended/Resigned) so
                    // the lock screen can explain which one applies.
                    official_status: accountData.officials?.status || 'Active',
                    is_first_login: accountData.requires_reset,
                }
            });
```

- [ ] **Step 3: Syntax check**

Run: `node --check server/auth/OfficialsLogin.js`
Expected: no output.

- [ ] **Step 4: Manual verification**

Prerequisite: the manual SQL has been run, so `officials_accounts.requires_reset` exists and defaults `true`.

`POST /api/admin/login` with valid credentials for an account that has never had its password changed. Expected: response body includes `"requires_reset": true` and `"profile": { ..., "is_first_login": true }`. Reset that account's password via Task 7's endpoint, log in again — expected `"requires_reset": false`.

- [ ] **Step 5: Commit**

```bash
git add server/auth/OfficialsLogin.js
git commit -m "$(cat <<'EOF'
feat(officials): surface requires_reset on login

Mirrors the field residents already get from ResidentLogin.js. The
column itself (officials_accounts.requires_reset, default true) is
added via docs/superpowers/specs/2026-07-14-manual-sql.sql.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Capture `requires_reset` into `admin_session` at login

**Files:**
- Modify: `src/components/buttons/Official_Login_modal.tsx`

**Interfaces:**
- Consumes: `data.requires_reset` / `data.profile?.is_first_login` from the login response (Task 8).
- Produces: `localStorage['admin_session']` now includes `requires_reset: boolean`, consumed by Task 10.

- [ ] **Step 1: Normalize and store the flag**

In `src/components/buttons/Official_Login_modal.tsx`, find the `userData` object construction inside `handleSignIn`'s success branch:

```tsx
        // Session object for UI restoration — does NOT contain the auth token
        const userData = {
          username: data.username,
          role: data.role,
          profile: data.profile,
          account_id: data.account_id,
        };
```

Replace with:

```tsx
        const needsReset = data.requires_reset || data.profile?.is_first_login;

        // Session object for UI restoration — does NOT contain the auth token
        const userData = {
          username: data.username,
          role: data.role,
          profile: data.profile,
          account_id: data.account_id,
          requires_reset: needsReset,
        };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 3: Manual verification**

Log in as an official whose `requires_reset` is `true` (per Task 8's verification). Open browser dev tools → Application → Local Storage → check `admin_session`. Expected: the stored JSON includes `"requires_reset": true`.

- [ ] **Step 4: Commit**

```bash
git add src/components/buttons/Official_Login_modal.tsx
git commit -m "$(cat <<'EOF'
feat(officials): carry requires_reset into admin_session at login

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Forced-reset modal for officials, mounted in `Dashboard.tsx`

**Files:**
- Create: `src/components/buttons/Official_Resetpassword_modal.tsx`
- Modify: `src/components/UI/Administration_GUI/Dashboard.tsx`

**Interfaces:**
- Consumes: `ApiService.resetPassword` (already exists in `api.ts:472-473`), `localStorage['admin_session'].requires_reset` (Task 9), `localStorage['account_id']` (already set at login by `Official_Login_modal.tsx`).
- Produces: `OfficialResetPasswordModal` component with props `{ isOpen: boolean; accountId: string; firstName: string; onSuccess: () => void }`.

- [ ] **Step 1: Create the modal component**

Create `src/components/buttons/Official_Resetpassword_modal.tsx`:

```tsx
import React, { useState } from 'react';
import { ApiService } from '../UI/api';

interface OfficialResetProps {
  isOpen: boolean;
  accountId: string;
  firstName: string;
  onSuccess: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#ffffff', padding: '32px 36px', borderRadius: '14px',
  boxShadow: '0 20px 40px rgba(0,0,0,0.15)', maxWidth: '420px', width: '90%',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: '1px solid #cbd5e1', marginBottom: '12px', fontSize: '0.9rem', boxSizing: 'border-box',
};

const OfficialResetPasswordModal: React.FC<OfficialResetProps> = ({ isOpen, accountId, firstName, onSuccess }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || !confirmPassword) {
      setError('Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!accountId) {
      setError('Session identity missing. Please log in again.');
      return;
    }

    setLoading(true);
    try {
      const result = await ApiService.resetPassword(accountId, { password: newPassword });
      if (!result.success) {
        throw new Error(result.error || 'Server rejected the password update.');
      }
      setNewPassword('');
      setConfirmPassword('');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Password update failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <h2 style={{ margin: '0 0 8px', fontSize: '1.2rem', color: '#0f172a' }}>Action Required</h2>
        <p style={{ margin: '0 0 20px', fontSize: '0.85rem', color: '#64748b' }}>
          Hello {firstName || 'there'}, this account is still using its auto-generated password.
          Set a new one to continue.
        </p>

        {error && (
          <div style={{ backgroundColor: '#fef2f2', color: '#991b1b', padding: '10px 12px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleReset}>
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: '8px', border: 'none',
              backgroundColor: '#2563eb', color: '#fff', fontWeight: 700, fontSize: '0.9rem',
              cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default OfficialResetPasswordModal;
```

- [ ] **Step 2: Mount it in `Dashboard.tsx` with a forced-reset gate**

In `src/components/UI/Administration_GUI/Dashboard.tsx`, add the import after line 17 (`import NotificationSystem from './NotificationSystem';`):

```tsx
import OfficialResetPasswordModal from '../../buttons/Official_Resetpassword_modal';
```

After the `userInfo`/`setUserInfo` state block (after line 102's closing `}, [user]);`), add:

```tsx
  // 🔒 Forced first-login reset — mirrors CommunityDashboard.tsx's
  // mustResetPassword pattern for the resident portal.
  const [mustResetPassword, setMustResetPassword] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('admin_session');
      if (raw) {
        const session = JSON.parse(raw);
        if (session.requires_reset === true || session.profile?.is_first_login === true) {
          setMustResetPassword(true);
        }
      }
    } catch {
      // best-effort; ignore parse failures
    }
  }, []);
```

Immediately before the final closing `</div>` of the component's returned JSX (after line 367's `</div>` that closes `FRAME_MAIN_COLUMN`, before line 368's `</div>` that closes `FRAME_WRAPPER`), add:

```tsx
      <OfficialResetPasswordModal
        isOpen={mustResetPassword}
        accountId={localStorage.getItem('account_id') || ''}
        firstName={userInfo.name.split(' ')[0]}
        onSuccess={() => {
          setMustResetPassword(false);
          try {
            const raw = localStorage.getItem('admin_session');
            if (raw) {
              const session = JSON.parse(raw);
              session.requires_reset = false;
              if (session.profile) session.profile.is_first_login = false;
              localStorage.setItem('admin_session', JSON.stringify(session));
            }
          } catch {
            // best-effort; ignore parse failures
          }
        }}
      />
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b --noEmit`
Expected: no new errors.

- [ ] **Step 4: Manual browser verification**

Log in as an official with `requires_reset: true` (per Task 8/9's verification). Expected: immediately upon reaching `/admin/dashboard`, the "Action Required" modal appears over the dashboard. Enter a weak password (e.g. matching the name+digits shape) — expected: the Task 7 policy error surfaces inline. Enter a strong, valid, changed password — expected: the modal closes, and reloading the page does not bring it back (since `admin_session.requires_reset` is now `false` and the backend column was also cleared).

- [ ] **Step 5: Commit**

```bash
git add src/components/buttons/Official_Resetpassword_modal.tsx src/components/UI/Administration_GUI/Dashboard.tsx
git commit -m "$(cat <<'EOF'
feat(officials): forced password-reset gate on first login

Mirrors the resident portal's mustResetPassword pattern
(CommunityDashboard.tsx / Community_Resetpassword_modal.tsx), which
officials never had — closing the gap that let an account sit
indefinitely on its auto-generated default password.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation checklist

- [ ] Confirm `docs/superpowers/specs/2026-07-14-manual-sql.sql` has been run against the real database (both the new table and the new column are required for Tasks 3, 7, and 8 to work at all).
- [ ] Run `node diagnostic.test.js` one final time — full suite, not just the new section — to confirm nothing else regressed.
- [ ] Run `npx tsc -b --noEmit` clean across the whole frontend.
- [ ] Walk through the full "+Add Residents" flow once end-to-end in the browser (Task 5, Step 10) and the full officials forced-reset flow once end-to-end (Task 10, Step 4).
- [ ] Do **not** run `git push` — everything stays on `feature/resident-otp-and-password-hardening` until the user explicitly asks to push.
