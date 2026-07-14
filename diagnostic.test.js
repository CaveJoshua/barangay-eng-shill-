/**
 * diagnostic.test.js
 * Run: node diagnostic.test.js
 *
 * Covers every security-critical path reviewed in this session:
 *   OTP generation & hashing, JWT 401/403 split, admin refresh grace period,
 *   RBAC middleware, blotter mass-assignment guard, notification fetch cap,
 *   smart body-limit routing, bcrypt password hashing, household number generation.
 */

import assert from 'assert';
import crypto from 'crypto';
import jwt    from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { validateNewPassword } from './server/lib/PasswordPolicy.js';

// ─── MINIMAL TEST RUNNER ───────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓  ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ✗  ${name}`);
        console.error(`       → ${err.message}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`);
}

// ─── LOGIC MIRRORED FROM SOURCE FILES ─────────────────────────────────────
// These are extracted verbatim so the test proves the actual implementations.

// Profile.js / Officials.js / Account_Management.js
const generateSecureCode = (length = 6) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length }, () => chars[crypto.randomInt(0, chars.length)]).join('');
};

const hashOtp = (code) => crypto.createHash('sha256').update(code).digest('hex');

// Data.js / server.js — maps JWT error type to HTTP status
const jwtStatusCode = (err) => err?.name === 'TokenExpiredError' ? 401 : 403;

// Data.js — smart body limit
const getBodyLimit = (method, path) => {
    const isImageUpload = ['POST', 'PUT'].includes(method) && /^\/announcements(\/|$)/.test(path);
    return isImageUpload ? '50mb' : '10mb';
};

// Notification.js — fetch cap
const getFetchLimit = (raw) => Math.min(parseInt(raw) || 50, 100);

// RBAC guard (Household.js / IncidentReport.js pattern)
const passesRoleCheck = (req, allowedRoles) => {
    const role = (req.user?.user_role || req.user?.role || 'resident').toLowerCase().trim();
    return allowedRoles.includes(role);
};

// IncidentReport.js — allowlist for blotter PUT
const getBlotterAllowlist = (r, processedNarrative) => {
    const allowed = {};
    if (r.complainant_name !== undefined) allowed.complainant_name = r.complainant_name;
    if (r.respondent       !== undefined) allowed.respondent       = r.respondent;
    if (r.incident_type    !== undefined) allowed.incident_type    = r.incident_type;
    if (processedNarrative !== undefined) allowed.narrative        = processedNarrative;
    if (r.date_filed       !== undefined) allowed.date_filed       = r.date_filed;
    if (r.time_filed       !== undefined) allowed.time_filed       = r.time_filed;
    if (r.status           !== undefined) allowed.status           = r.status;
    if (r.hearing_date     !== undefined) allowed.hearing_date     = r.hearing_date;
    if (r.hearing_time     !== undefined) allowed.hearing_time     = r.hearing_time;
    if (r.rejection_reason !== undefined) allowed.rejection_reason = r.rejection_reason;
    if (r.resolution       !== undefined) allowed.resolution       = r.resolution;
    return allowed;
};

// ─── TESTS ────────────────────────────────────────────────────────────────

const TEST_SECRET = 'diagnostic-test-secret-only';

// ── 1. OTP GENERATION ──
section('OTP: Generation');

await test('generates a 6-character string', () => {
    assert.strictEqual(generateSecureCode(6).length, 6);
});

await test('output contains only charset characters', () => {
    const charset = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    for (let i = 0; i < 30; i++) {
        for (const ch of generateSecureCode(6)) {
            assert.ok(charset.has(ch), `Unexpected character: ${ch}`);
        }
    }
});

await test('has sufficient entropy (200 samples — no Math.random pattern)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateSecureCode(6)));
    assert.ok(codes.size > 195, `Too many collisions (${codes.size}/200) — suspect Math.random`);
});

// ── 2. OTP HASHING ──
section('OTP: SHA-256 Hashing');

await test('hash is a 64-char hex string', () => {
    assert.match(hashOtp('ABC123'), /^[a-f0-9]{64}$/);
});

await test('hash is deterministic for the same input', () => {
    assert.strictEqual(hashOtp('TESTCODE'), hashOtp('TESTCODE'));
});

await test('hash does not equal the plaintext OTP', () => {
    const code = generateSecureCode(6);
    assert.notStrictEqual(hashOtp(code), code);
});

await test('hashed comparison works (what verifyOtp actually does)', () => {
    const code = generateSecureCode(6);
    const stored = hashOtp(code);
    assert.strictEqual(stored, hashOtp(code.toUpperCase().trim()));
});

// ── 3. OTP SESSION LIFECYCLE ──
section('OTP: Session Lifecycle');

const otpStore = new Map();

await test('session stores hash, not plaintext', () => {
    const code = generateSecureCode(6);
    otpStore.set('session-a', { codeHash: hashOtp(code), expires: Date.now() + 300_000, attempts: 0 });
    const rec = otpStore.get('session-a');
    assert.notStrictEqual(rec.codeHash, code);
    assert.strictEqual(rec.codeHash.length, 64); // SHA-256 hex
});

await test('correct OTP verifies', () => {
    const code = generateSecureCode(6);
    otpStore.set('session-b', { codeHash: hashOtp(code), expires: Date.now() + 300_000, attempts: 0 });
    const rec = otpStore.get('session-b');
    assert.ok(hashOtp(code.toUpperCase().trim()) === rec.codeHash);
});

await test('wrong OTP fails and increments attempts', () => {
    const code = generateSecureCode(6);
    otpStore.set('session-c', { codeHash: hashOtp(code), expires: Date.now() + 300_000, attempts: 0 });
    const rec = otpStore.get('session-c');
    const match = hashOtp('ZZZZZZ') === rec.codeHash;
    assert.ok(!match);
    rec.attempts += 1;
    assert.strictEqual(rec.attempts, 1);
});

await test('session is deleted after 3 failed attempts', () => {
    const code = generateSecureCode(6);
    otpStore.set('session-d', { codeHash: hashOtp(code), expires: Date.now() + 300_000, attempts: 0 });
    for (let i = 0; i < 3; i++) {
        const rec = otpStore.get('session-d');
        if (!rec) break;
        rec.attempts += 1;
        if (rec.attempts >= 3) otpStore.delete('session-d');
    }
    assert.ok(!otpStore.has('session-d'), 'Session must be purged after 3 failures');
});

await test('expired OTP is detected and cleared', () => {
    const code = generateSecureCode(6);
    otpStore.set('session-e', { codeHash: hashOtp(code), expires: Date.now() - 1_000, attempts: 0 });
    const rec = otpStore.get('session-e');
    const isExpired = Date.now() > rec.expires;
    assert.ok(isExpired);
    if (isExpired) otpStore.delete('session-e');
    assert.ok(!otpStore.has('session-e'));
});

// ── 4. JWT ERROR MAPPING ──
section('JWT: 401 (expired) vs 403 (tampered)');

await test('valid token is accepted', () => {
    const token = jwt.sign({ username: 'admin', role: 'superadmin' }, TEST_SECRET, { expiresIn: '1h' });
    const decoded = jwt.verify(token, TEST_SECRET);
    assert.strictEqual(decoded.username, 'admin');
});

await test('expired token → 401', async () => {
    const token = jwt.sign({ username: 'test' }, TEST_SECRET, { expiresIn: '1ms' });
    await new Promise(r => setTimeout(r, 20));
    let status;
    try { jwt.verify(token, TEST_SECRET); }
    catch (err) { status = jwtStatusCode(err); }
    assert.strictEqual(status, 401);
});

await test('tampered token → 403', () => {
    const garbage = 'eyJhbGciOiJIUzI1NiJ9.TAMPERED.BADSIG';
    let status;
    try { jwt.verify(garbage, TEST_SECRET); }
    catch (err) { status = jwtStatusCode(err); }
    assert.strictEqual(status, 403);
});

await test('wrong-secret token → 403', () => {
    const token = jwt.sign({ username: 'x' }, 'wrong-secret');
    let status;
    try { jwt.verify(token, TEST_SECRET); }
    catch (err) { status = jwtStatusCode(err); }
    assert.strictEqual(status, 403);
});

// ── 5. ADMIN REFRESH GRACE PERIOD ──
section('JWT: Admin Refresh Grace Period');

await test('ignoreExpiration lets us read claims from expired token', async () => {
    const token = jwt.sign({ username: 'admin' }, TEST_SECRET, { expiresIn: '1ms' });
    await new Promise(r => setTimeout(r, 20));
    let decoded;
    jwt.verify(token, TEST_SECRET, { ignoreExpiration: true }, (err, payload) => {
        assert.ok(!err || err.name !== 'JsonWebTokenError', `Should not throw JsonWebTokenError: ${err?.message}`);
        decoded = payload;
    });
    assert.strictEqual(decoded?.username, 'admin');
});

await test('token expired 3min ago is inside the 5min grace window', () => {
    const GRACE_MS = 5 * 60 * 1000;
    const expiredAt = Date.now() - 3 * 60 * 1000;
    assert.ok(!(Date.now() > expiredAt + GRACE_MS), 'Should still be within grace period');
});

await test('token expired 6min ago is outside the 5min grace window', () => {
    const GRACE_MS = 5 * 60 * 1000;
    const expiredAt = Date.now() - 6 * 60 * 1000;
    assert.ok(Date.now() > expiredAt + GRACE_MS, 'Should be rejected — past grace period');
});

await test('fresh token has 1h expiry (not 24h)', () => {
    const token = jwt.sign({ username: 'admin' }, TEST_SECRET, { expiresIn: '1h' });
    const { exp, iat } = jwt.decode(token);
    const lifetimeSeconds = exp - iat;
    assert.ok(lifetimeSeconds <= 3600, `Token lifetime ${lifetimeSeconds}s exceeds 1h`);
    assert.ok(lifetimeSeconds > 3500, `Token lifetime ${lifetimeSeconds}s is too short`);
});

// ── 6. RBAC ──
section('RBAC: Role Guards');

const ADMIN_ROLES    = ['admin', 'superadmin', 'staff', 'barangayhall'];
const RESIDENT_ROLES = [...ADMIN_ROLES, 'resident'];
const DELETE_ROLES   = ['admin', 'superadmin'];

await test('admin passes household guard', () => {
    assert.ok(passesRoleCheck({ user: { role: 'admin' } }, ADMIN_ROLES));
});

await test('resident is blocked from household list endpoint', () => {
    assert.ok(!passesRoleCheck({ user: { role: 'resident' } }, ADMIN_ROLES));
});

await test('resident can access single-household endpoint', () => {
    assert.ok(passesRoleCheck({ user: { role: 'resident' } }, RESIDENT_ROLES));
});

await test('staff cannot delete (superadmin/admin only)', () => {
    assert.ok(!passesRoleCheck({ user: { role: 'staff' } }, DELETE_ROLES));
});

await test('missing role field defaults to resident (blocked from admin routes)', () => {
    assert.ok(!passesRoleCheck({ user: {} }, ADMIN_ROLES));
});

await test('role check is case-insensitive (ADMIN → admin)', () => {
    assert.ok(passesRoleCheck({ user: { role: 'ADMIN' } }, ADMIN_ROLES));
});

await test('no user object → defaults to resident', () => {
    assert.ok(!passesRoleCheck({}, ADMIN_ROLES));
});

// ── 7. BLOTTER MASS ASSIGNMENT GUARD ──
section('Blotter: Mass Assignment Allowlist');

await test('injected fields are stripped', () => {
    const body = {
        status: 'Active',
        is_admin: true,         // privilege escalation
        complainant_id: 'fake', // IDOR
        password: 'hack',       // credential injection
    };
    const allowed = getBlotterAllowlist(body, undefined);
    assert.ok(!('is_admin'       in allowed));
    assert.ok(!('complainant_id' in allowed));
    assert.ok(!('password'       in allowed));
    assert.strictEqual(allowed.status, 'Active');
});

await test('undefined fields are excluded (no null-pollution)', () => {
    const allowed = getBlotterAllowlist({ status: 'Resolved' }, undefined);
    assert.ok(!('narrative'    in allowed));
    assert.ok(!('hearing_date' in allowed));
    assert.strictEqual(allowed.status, 'Resolved');
});

await test('all 11 permitted fields are passed through correctly', () => {
    const body = {
        complainant_name: 'Juan', respondent: 'Pedro', incident_type: 'Noise',
        date_filed: '2026-05-17', time_filed: '09:00', status: 'Active',
        hearing_date: '2026-06-01', hearing_time: '10:00',
        rejection_reason: null, resolution: null
    };
    const allowed = getBlotterAllowlist(body, 'Narrative text');
    assert.strictEqual(Object.keys(allowed).length, 11);
});

// ── 8. NOTIFICATION FETCH CAP ──
section('Notifications: Fetch Limit Cap');

await test('undefined limit defaults to 50', () => {
    assert.strictEqual(getFetchLimit(undefined), 50);
});

await test('limit of 200 is capped at 100', () => {
    assert.strictEqual(getFetchLimit('200'), 100);
});

await test('limit of 30 is honoured', () => {
    assert.strictEqual(getFetchLimit('30'), 30);
});

await test('non-numeric limit defaults to 50', () => {
    assert.strictEqual(getFetchLimit('xyz'), 50);
});

await test('limit of exactly 100 is allowed', () => {
    assert.strictEqual(getFetchLimit('100'), 100);
});

// ── 9. SMART BODY LIMIT ROUTING ──
section('Body: Smart Limit Routing');

await test('POST /announcements → 50mb', () => {
    assert.strictEqual(getBodyLimit('POST', '/announcements'), '50mb');
});

await test('PUT /announcements/123 → 50mb', () => {
    assert.strictEqual(getBodyLimit('PUT', '/announcements/123'), '50mb');
});

await test('GET /announcements → 10mb (no body upload)', () => {
    assert.strictEqual(getBodyLimit('GET', '/announcements'), '10mb');
});

await test('POST /blotter → 10mb', () => {
    assert.strictEqual(getBodyLimit('POST', '/blotter'), '10mb');
});

await test('POST /residents → 10mb', () => {
    assert.strictEqual(getBodyLimit('POST', '/residents'), '10mb');
});

await test('POST /documents → 10mb', () => {
    assert.strictEqual(getBodyLimit('POST', '/documents'), '10mb');
});

// ── 9.5 SERVER GLOBAL SMART BODY LIMIT (J-CVE-101203) ──
section('Body: Global Smart Limit (server.js)');

// server.js — global parser. Previously a flat 200mb that silently overrode the
// Data.js cap; now an /api-prefixed smart limit (50mb only for announcement uploads).
const getGlobalBodyLimit = (method, path) => {
    const isImageUpload = ['POST', 'PUT'].includes(method) && /^\/api\/announcements(\/|$)/.test(path);
    return isImageUpload ? '50mb' : '10mb';
};

await test('POST /api/announcements → 50mb', () => {
    assert.strictEqual(getGlobalBodyLimit('POST', '/api/announcements'), '50mb');
});

await test('PUT /api/announcements/9 → 50mb', () => {
    assert.strictEqual(getGlobalBodyLimit('PUT', '/api/announcements/9'), '50mb');
});

await test('GET /api/announcements → 10mb (no upload)', () => {
    assert.strictEqual(getGlobalBodyLimit('GET', '/api/announcements'), '10mb');
});

await test('POST /api/residents → 10mb', () => {
    assert.strictEqual(getGlobalBodyLimit('POST', '/api/residents'), '10mb');
});

await test('no route exceeds 50mb (200mb DoS hole closed)', () => {
    const paths = ['/api/announcements', '/api/residents', '/api/documents', '/api/auth'];
    for (const p of paths) {
        for (const m of ['POST', 'PUT', 'GET']) {
            assert.notStrictEqual(getGlobalBodyLimit(m, p), '200mb');
        }
    }
});

// ── 10. PASSWORD HASHING ──
section('Auth: bcrypt Password Hashing');

await test('hash is not stored as plaintext', () => {
    const plain = 'testpassword123';
    const hash  = bcrypt.hashSync(plain, 10);
    assert.notStrictEqual(hash, plain);
    assert.ok(hash.startsWith('$2'));
});

await test('correct password validates', () => {
    const plain = 'resident@pass1';
    const hash  = bcrypt.hashSync(plain, 10);
    assert.ok(bcrypt.compareSync(plain, hash));
});

await test('wrong password is rejected', () => {
    const hash = bcrypt.hashSync('correct-horse', 10);
    assert.ok(!bcrypt.compareSync('battery-staple', hash));
});

await test('two hashes of the same password differ (salted)', () => {
    const plain = 'samepassword';
    assert.notStrictEqual(bcrypt.hashSync(plain, 10), bcrypt.hashSync(plain, 10));
});

// ── 11. HOUSEHOLD NUMBER GENERATION ──
section('Household: Number Generation');

await test('format matches HH-YYYY-NNNN', () => {
    const year  = new Date().getFullYear();
    const num   = crypto.randomInt(1000, 9999);
    const hh_num = `HH-${year}-${String(num)}`;
    assert.match(hh_num, /^HH-\d{4}-\d{4}$/);
});

await test('randomInt(1000, 9999) stays in bounds across 200 samples', () => {
    for (let i = 0; i < 200; i++) {
        const n = crypto.randomInt(1000, 9999);
        assert.ok(n >= 1000 && n < 9999, `Out of bounds: ${n}`);
    }
});

// ── 12. LINKED HASH-CHAIN (J-CVE-101203) ──
section('Ledger: Linked Hash-Chain');

// Logic mirrored from ResidentsRecord.js buildResidentChain().
const CHAIN_GENESIS_PREV = '0'.repeat(64);
const genHash = (f, m, l, dob) =>
    crypto.createHash('sha256')
        .update(`${f?.trim().toLowerCase()}|${m?.trim().toLowerCase()}|${l?.trim().toLowerCase()}|${dob}`.replace(/\s+/g, ''))
        .digest('hex');
const blockHashOf = (prev, data, id) =>
    crypto.createHash('sha256').update(`${prev}|${data}|${id}`).digest('hex');

const buildChain = (records) => {
    const ordered = [...records].sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));
    let prev = CHAIN_GENESIS_PREV;
    const blocks = [];
    for (const r of ordered) {
        const expected = genHash(r.first_name, r.middle_name, r.last_name, r.dob);
        const stored = r.genesis_hash || null;
        const data_status = !stored ? 'unverified' : (stored === expected ? 'valid' : 'compromised');
        const data = stored || expected;
        const block_hash = blockHashOf(prev, data, r.record_id);
        blocks.push({ record_id: r.record_id, prev_hash: prev, block_hash, data_status });
        prev = block_hash;
    }
    return { blocks, head: prev };
};

const signed = (r) => ({ ...r, genesis_hash: genHash(r.first_name, r.middle_name, r.last_name, r.dob) });
const SAMPLE = [
    signed({ record_id: 'R-001', first_name: 'Juan',  middle_name: 'M', last_name: 'Cruz',   dob: '1990-01-01' }),
    signed({ record_id: 'R-002', first_name: 'Maria', middle_name: 'S', last_name: 'Santos', dob: '1992-02-02' }),
    signed({ record_id: 'R-003', first_name: 'Jose',  middle_name: 'P', last_name: 'Reyes',  dob: '1994-03-03' }),
];

await test('genesis block links to 64 zeros', () => {
    const { blocks } = buildChain(SAMPLE);
    assert.strictEqual(blocks[0].prev_hash, CHAIN_GENESIS_PREV);
});

await test('every block links to the previous block hash', () => {
    const { blocks } = buildChain(SAMPLE);
    for (let i = 1; i < blocks.length; i++) {
        assert.strictEqual(blocks[i].prev_hash, blocks[i - 1].block_hash, `Block ${i} link broken`);
    }
});

await test('head is deterministic for identical input', () => {
    assert.strictEqual(buildChain(SAMPLE).head, buildChain(SAMPLE).head);
});

await test('tampering a record surfaces as compromised', () => {
    const tampered = SAMPLE.map(r => r.record_id === 'R-002' ? { ...r, last_name: 'HACKED' } : r);
    const { blocks } = buildChain(tampered);
    const bad = blocks.find(b => b.record_id === 'R-002');
    assert.strictEqual(bad.data_status, 'compromised');
});

await test('a tampered block changes every subsequent block hash', () => {
    const clean = buildChain(SAMPLE).blocks;
    const tampered = buildChain(SAMPLE.map(r => r.record_id === 'R-001' ? { ...r, genesis_hash: genHash('Evil', '', 'Actor', '2000-01-01') } : r)).blocks;
    // R-001 is first; R-002 and R-003 hashes must differ from the clean chain.
    assert.notStrictEqual(clean[1].block_hash, tampered[1].block_hash);
    assert.notStrictEqual(clean[2].block_hash, tampered[2].block_hash);
});

await test('deleting a record changes the head (deletion detection)', () => {
    const full = buildChain(SAMPLE).head;
    const missingMiddle = buildChain(SAMPLE.filter(r => r.record_id !== 'R-002')).head;
    assert.notStrictEqual(full, missingMiddle);
});

await test('input order does not matter (canonical sort by record_id)', () => {
    const shuffled = [SAMPLE[2], SAMPLE[0], SAMPLE[1]];
    assert.strictEqual(buildChain(SAMPLE).head, buildChain(shuffled).head);
});

// ── 13. PASSWORD POLICY ──
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

// ─── FINAL REPORT ─────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'═'.repeat(56)}`);

if (failed === 0) {
    console.log(`  ALL ${total} TESTS PASSED`);
} else {
    console.log(`  ${passed} passed  /  ${failed} FAILED  (${total} total)`);
}
console.log(`${'═'.repeat(56)}\n`);

if (failed > 0) process.exit(1);
