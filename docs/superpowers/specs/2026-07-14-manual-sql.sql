-- ============================================================
-- MANUAL SQL — run these in the Supabase SQL editor, in order.
-- This repo has no migrations folder; all schema changes for this
-- project are applied by hand there (same convention as every
-- existing table). Nothing here is destructive — safe to run once.
-- ============================================================


-- ------------------------------------------------------------
-- 0. Extension needed by steps 2 and 3 below (bcrypt-compatible
--    crypt() for testing a candidate password against a stored
--    hash without ever storing/revealing the plaintext).
-- ------------------------------------------------------------
create extension if not exists pgcrypto;


-- ------------------------------------------------------------
-- 1. New table backing the OTP-gated resident registration flow
--    (Part 1 of the design). Holds a pending registration's
--    validated payload until the admin confirms the emailed/texted
--    code; nothing here becomes a real resident until confirmed.
-- ------------------------------------------------------------
create table if not exists resident_registration_otp (
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

create index if not exists idx_resident_reg_otp_identifier_created
  on resident_registration_otp (identifier, created_at);


-- ------------------------------------------------------------
-- 2. Forced-reset flag for officials accounts (Part 3). Residents
--    already have this column on residents_account; officials never
--    did, which is the gap that let the leaked account sit on its
--    default password indefinitely.
-- ------------------------------------------------------------
alter table officials_accounts
  add column if not exists requires_reset boolean not null default true;


-- ------------------------------------------------------------
-- 3. AUDIT (read-only) — which live official accounts are STILL on
--    their exact auto-generated default password right now. Run this
--    BEFORE step 4 and look at the results — it's how you find every
--    account in the same state as the one you just pasted in chat.
-- ------------------------------------------------------------
select
    oa.account_id,
    oa.username,
    o.full_name,
    o.position,
    o.status,
    crypt(
        case
            when o.position ilike '%barangay hall%'
                then split_part(oa.username, '@', 1) || '123456'   -- e.g. beh001123456
            else lower(split_part(trim(o.full_name), ' ', 1)) || '123456'  -- e.g. felizardo123456
        end,
        oa.password
    ) = oa.password as still_uses_default_password
from officials_accounts oa
join officials o on o.id = oa.official_id
order by still_uses_default_password desc, o.full_name;


-- ------------------------------------------------------------
-- 4. BACKFILL — force a reset on every account step 3 flagged as
--    still-default. (New accounts already default requires_reset to
--    true from step 2; this only needs to run once, now, to catch
--    accounts that already existed before that column was added.)
--    Since every account currently defaults to requires_reset = true
--    anyway (step 2's DEFAULT), this UPDATE is effectively a no-op
--    today — it only matters once someone changes their password and
--    requires_reset gets cleared to false. Safe to run regardless.
-- ------------------------------------------------------------
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
