# Dependency Vulnerability Triage

_Last reviewed: 2026-06-25 — branch `feature/term-officials-and-request-badges`_

This is a risk-based triage of the residual `npm audit` findings. No dependency
was upgraded/downloaded to produce this record — each finding was assessed for
**reachability** (can the vulnerable code path actually be hit in this app?) and
given a disposition. Re-run `npm audit` after any dependency change and update this file.

## Current status: `npm audit` → 2 moderate, 0 high/critical

| Package | Advisory | Severity | Direct? | Disposition |
|---|---|---|---|---|
| `uuid` < 11.1.1 | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — missing buffer bounds check in **v3/v5/v6** when `buf` is provided | Moderate | transitive (via `exceljs`) | **Not exploitable — unreachable** |
| `exceljs` ≥ 3.5.0 | depends on the vulnerable `uuid` above | Moderate | direct | **Not exploitable — inherits the above** |

Both findings are the **same root cause** (the bundled `uuid@7.0.3` inside `exceljs`).

## Reachability analysis (why it's not exploitable here)

1. **The CVE only affects `uuid.v3 / v5 / v6` when a `buf` argument is passed.**
   It is a bounds-check bug in the "write into caller-supplied buffer" path.

2. **`exceljs` uses `uuid.v4` only, with no `buf`.** Verified in the installed package:
   - `node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`
     → `const {v4: uuidv4} = require('uuid');`
     → calls `uuidv4()` with **no arguments** (used only to mint random `x14Id`s for
       conditional-formatting rules).
   - `v3/v5/v6` are never imported; no `buf` is ever passed. **The vulnerable code
     path is therefore never reached.**

3. **The app does not use `uuid` directly.** A repo-wide search for
   `require('uuid')` / `from 'uuid'` / `uuidv3|v5|v6` returns **no matches** in
   `src/` or the backend `.js` routers. The app generates identifiers with Node's
   built-in `crypto.randomUUID()`, not the npm `uuid` package.

4. **Attack surface is minimal.** `exceljs` is invoked in exactly one place
   ([`AuditLog.tsx`](src/components/UI/Administration_GUI/AuditLog.tsx)) to export the
   audit log to `.xlsx`. It runs **client-side, admin-only**, over **trusted,
   server-supplied data** — there is no attacker-controlled input flowing into the
   `uuid` call.

**Conclusion:** Vulnerable dependency present, but **not exploitable** in this
codebase (unreachable code path + no attacker-controlled input). Residual risk is
**accepted** and tracked here.

## Remediation option (when chosen — requires a download, deferred by decision)

The clean upstream fix is to bump `exceljs` to v4.x (it ships a patched `uuid`):

```
npm i exceljs@^4.4.0
```

`exceljs` usage here is limited to `new ExcelJS.Workbook()` / `addWorksheet()` /
`workbook.xlsx.writeBuffer()` — all stable across the 3→4 major — so the bump is
low-risk. Alternatively, pin only the transitive sub-dependency without touching
`exceljs` via a package.json `overrides` entry:

```json
"overrides": { "uuid": "^11.1.1" }
```

Both options were intentionally **not applied** in this review (no dependency
download), per the decision to patch manually.

## Compensating controls already in place

- `exceljs` export path is gated to administrators and never consumes untrusted input.
- Critical/High advisories were already resolved (the `nodemailer`/`mailer`/`crypto`/
  `node`/`xss-clean` cleanup + the semver-safe `npm audit fix`), taking the tree from
  20 findings (1 critical, 5 high) down to these 2 unreachable moderates.
