# Resident Registration OTP Gate, Duplicate-Rule Relaxation & Password Hardening

Date: 2026-07-14
Branch: `feature/resident-otp-and-password-hardening`
Backup point: git tag `backup/pre-otp-registration-2026-07-14` (on `main` @ `6771802`)

This work stays local. No `git push` is performed as part of this effort — the
branch and tag exist only on this machine until the user decides to push them.

## Background

The "Add Residents" admin form (`Resident_modal.tsx` → `POST /residents` in
`server/records/ResidentsRecord.js`) currently creates the resident record and
a login account in one step, then fire-and-forgets the generated username and
temporary password to whichever contact channel (email/SMS) the admin picked
— with no proof that channel is actually reachable by the resident.

Separately, an audit of `officials_accounts` (see `Felizardo123456`, a live
account password matching the exact auto-generated default pattern) showed
that official accounts have no forced password reset and no password-strength
validation anywhere in the codebase, unlike resident accounts which at least
have a `requires_reset` flag (though nothing stops a resident from "resetting"
to another equally weak password either).

Three changes, one implementation pass:

1. Gate new resident account creation behind a confirmed OTP code.
2. Relax duplicate-detection so only phone/email/government-ID numbers block —
   never a person's name.
3. Close the password-hardening gap for both officials and residents.

---

## Part 1 — OTP-gated resident registration

### Scope

Applies **only** to the manual "+Add Residents" modal (`Resident_modal.tsx`,
create mode). CSV bulk import (`data_backup.ts` → `POST /residents`) is
**unchanged** — it keeps creating accounts directly and sending credentials
immediately, because gating hundreds of rows behind individual one-time codes
sent to each resident isn't practical for a bulk workflow.

`PUT /residents/:id` (editing an existing resident) is also unchanged by
Part 1 — editing doesn't create a new account, so there's nothing to verify.

### Flow

1. Admin fills out the resident form as today, including choosing a
   confirmation channel (email or SMS) — same UI section, repurposed.
2. Admin clicks **Send Code** (replaces today's "Confirm Registration" button
   in create mode).
3. Server-side, before sending anything:
   - Validate the full payload (existing `residentSchema` + government-ID
     required-field rules, unchanged).
   - Run the **hard duplicate check** (Part 2) — phone, email, and every
     government ID number, checked globally. If any collide, return 409
     immediately; no code is sent, nothing is created.
   - Determine the destination (email or contact_number) matching the chosen
     channel; if that field is blank, reject client-side before allowing Send
     Code at all.
   - Enforce rate limits (see below). If the daily cap or cooldown is hit,
     return 429 with a clear message.
   - Generate a 6-digit numeric code (same `generateVerifyCode`/`hashOtp`
     helpers already used by the existing `/residents/verify/*` flow in this
     file), hash it, and store a pending registration row containing the
     **entire validated form payload** (not re-taken from the client on
     confirm, to prevent tampering) plus the code hash, channel, identifier,
     and expiry (5 minutes, matching the existing verify flow's TTL).
   - Send the code synchronously (not fire-and-forget) so the admin gets
     immediate feedback if delivery fails and can pick the other channel.
4. Modal transitions to a **code-entry stage**: 6-digit input, countdown to
   expiry, "Resend Code" (disabled during the 60s cooldown), and an "Edit
   Details" link that discards the pending session client-side and returns to
   the form (the server-side row simply expires naturally).
5. Admin enters the code, clicks **Verify & Create Account**.
6. Server confirms the code (same expiry/attempt-lockout semantics as the
   existing verify flow: 3 wrong attempts kills the session and requires a
   fresh Send Code). On match:
   - Re-run the hard duplicate check as a final safety net (another admin
     could have registered a colliding phone/email/ID in the intervening
     minutes).
   - Perform the exact insert logic that today lives in `POST /residents`
     (resident record + `residents_account`), using the payload stored in the
     pending row.
   - Set `residents_account.is_verified = true` immediately (ownership was
     just proven).
   - Send a welcome message — username + temporary password — on the same
     channel the code was confirmed on. This replaces today's fire-and-forget
     credential email/SMS; it fires only once, only after confirmation.
   - Delete/mark the pending row consumed.
   - Return the created profile, same shape as today (including any
     name-match advisories).

### New backend pieces

**Table** `resident_registration_otp` (create manually in Supabase — this repo
has no migrations folder, so table changes are applied by hand there, same as
every other table):

```sql
create table resident_registration_otp (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,          -- normalized email or phone (rate-limit key)
  channel text not null check (channel in ('email','sms')),
  code_hash text not null,
  payload jsonb not null,            -- full validated resident payload, pending creation
  created_by text not null,          -- admin username, audit trail
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_resident_reg_otp_identifier_created
  on resident_registration_otp (identifier, created_at);
```

**Rate limiting** (DB-backed per the decision to survive redeploys):
- Max 5 rows per `identifier` per calendar day (count `created_at >= start of
  today`), regardless of channel used within that identifier.
- 60s cooldown since the identifier's most recent row, matching the existing
  `/residents/verify/request` cooldown convention.
- A failed send (provider returned false) deletes its row immediately so it
  doesn't consume a daily slot for a code the resident never received.
- Housekeeping: each request-code call opportunistically deletes rows older
  than 24h to keep the table small.

**Endpoints** (both `[authenticateToken, authorizeRoles(DATA_HANDLERS)]`,
same guard as today's `POST /residents`):
- `POST /residents/register/request-code` — body: full resident payload +
  `channel`. Returns `{ success, sessionId, expiresInSec }`.
- `POST /residents/register/confirm-code` — body: `{ sessionId, code }`.
  Performs the actual creation; returns the created profile (201) or a 4xx on
  bad/expired/rate-limited code.

`POST /residents` itself is untouched — CSV import keeps calling it directly.

### Frontend (`Resident_modal.tsx`)

- New local state: `registrationStage: 'form' | 'code-pending'`, plus
  `sessionId`, `codeInput`, `codeExpiresAt`, `resendCooldownUntil`.
- "Account Confirmation" section's channel picker stays; the footer button
  becomes context-sensitive: **Send Code** while `stage === 'form'`, **Verify
  & Create Account** while `stage === 'code-pending'`.
- Entering `code-pending` disables the rest of the form (visual lock, not
  removal, so the admin can still see what they entered) and reveals the
  6-digit input + resend/expiry UI + "Edit Details" link.
- Update mode (`isUpdateMode`) is untouched — no OTP stage, same single-step
  save as today.

---

## Part 2 — Duplicate rules: name never blocks

`checkDuplicates` in `ResidentsRecord.js` is split conceptually into two
concerns:

- **Hard duplicates (block the save):** phone number, email, and each
  government ID field (voter, PWD, 4Ps, solo parent, senior, SSS, PhilHealth,
  Other) — checked **globally** across all non-archived residents, not scoped
  to name matches like today. This closes a real gap: today, two
  differently-named residents sharing an SSS number would go undetected
  because the ID comparison only runs against rows that already matched on
  first+last name.
- **Name advisory (never blocks):** any existing resident sharing the same
  full name surfaces as a non-blocking advisory, same UX as today's
  "different DOB/ID, likely a namesake" case — except now this is the *only*
  outcome for a name match, even when DOB also matches. Confirmed with the
  user: two records for the same name **and** same birthdate will now save
  successfully, flagged only as a heads-up, not stopped.

This shared function feeds `POST /residents`, `PUT /residents/:id`, and the
new `POST /residents/register/request-code` / `confirm-code` pair, so the
relaxed rule is consistent everywhere duplicate checking happens.

**CSV import** (`data_backup.ts`) has its own lightweight client-side
pre-check that currently skips a row on name+DOB match before ever calling the
backend. That rule is removed to match the new policy — it keeps its
email/phone pre-checks (still useful to avoid wasted requests), and now relies
on the backend as the authority for ID-number collisions (a row with a
duplicate ID number will fail server-side and count toward the existing
"failed rows" tally, same as any other server rejection today).

---

## Part 3 — Forced password reset & weak-password rejection

### Officials: close the missing-flag gap

- Add `requires_reset boolean not null default true` to `officials_accounts`
  (SQL provided below — run manually in Supabase, same reasoning as Part 1's
  table).
- `officials` login response includes `requires_reset` (mirroring
  `is_first_login` already returned by `ResidentLogin.js`), and the admin
  frontend is forced into a password-change screen when it's true — the same
  pattern the resident portal (`Community_Resetpassword_modal.tsx`) already
  implements, just currently absent entirely on the officials/admin side.
- Existing accounts: the audit query already handed to the user
  (`audit_default_passwords.sql`) identifies which live accounts are still on
  the literal default password. A one-time backfill sets
  `requires_reset = true` for any account flagged by that audit (accounts that
  already changed their password legitimately are left alone).

### Shared password-set validator

One function, used by every path that sets a password (`Account_Management.js`
self-service and admin-assisted reset, resident first-login reset, officials
first-login reset), so the rule can't be bypassed by going through a different
endpoint. This is application code, not SQL — passwords are bcrypt-hashed
one-way, so pattern/reuse checks have to run on the plaintext *before*
hashing, at submit time.

Rejects the new password when:
1. **Unchanged:** `bcrypt.compare(newPassword, currentStoredHash)` is true.
2. **Still the generated shape:** case-insensitive match against
   `{firstName}\d{4,6}$` (or, for barangay-hall accounts, the
   `{generatedId}\d{4,6}$` shape) — catches "reset" that just tweaks a digit.
3. **Fails baseline strength:** shorter than 8 characters, fewer than 3 of the
   4 character classes (upper/lower/digit/symbol) present, or equal to the
   account's own username/first name/last name.

Each rejection returns a specific, actionable message (not a generic "invalid
password") so the person resetting knows exactly what to fix.

### SQL to run manually (Part 3)

```sql
alter table officials_accounts
  add column if not exists requires_reset boolean not null default true;

-- One-time backfill: force reset only for accounts the audit query flagged
-- as still on their literal default password. Run audit_default_passwords.sql
-- first, review the results, then apply this if it matches expectations:
update officials_accounts oa
set requires_reset = true
from officials o
where oa.official_id = o.id
  and crypt(
        case
          when o.position ilike '%barangay hall%'
            then split_part(oa.username, '@', 1) || '123456'
          else lower(split_part(trim(o.full_name), ' ', 1)) || '123456'
        end,
        oa.password
      ) = oa.password;
```

---

## Error handling

- Every new endpoint follows the existing codebase convention: provider
  failures (email/SMS) never throw past a `.catch(() => {})` boundary where
  the operation is genuinely fire-and-forget (the final welcome message can
  stay best-effort once the account already exists), but the **code send**
  itself is synchronous and its failure is surfaced to the admin immediately,
  since without a delivered code the flow cannot proceed at all.
- Rate-limit and expiry errors return distinct messages so the frontend can
  show "try again tomorrow" vs "code expired, resend" vs "wrong code, N
  attempts left" rather than a single generic failure banner.
- The final confirm-code step re-checks hard duplicates before inserting —
  if a collision appeared during the code-entry window, the admin sees the
  same 409 they'd have seen up front, and the pending OTP row is discarded.

## Testing plan

- Backend: exercise `request-code` / `confirm-code` directly (valid flow,
  wrong code, expired code, 3-attempt lockout, daily cap, cooldown, duplicate
  phone/email/ID rejection at both request and confirm time).
- Duplicate rules: same name + same DOB now succeeds with an advisory;
  duplicate phone/email/any single ID field still blocks regardless of name.
- CSV import: run an import batch to confirm it still creates accounts
  directly with no OTP involvement, and that a name+DOB-only "collision" from
  the old client-side rule no longer skips a row.
- Password validator: unit-style checks for all three rejection rules
  (unchanged, default-shape, weak) plus a valid strong password passing.
- Manual walk-through in the running app (per this project's `run`/`verify`
  skills) of the full Add Resident → Send Code → enter code → account created
  → welcome message flow, using a real inbox/phone the user controls.
