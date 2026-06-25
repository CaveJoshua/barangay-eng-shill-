# Security Review — Smart Barangay

_Reviewed: 2026-06-25 · Scope: dependency/supply-chain + secrets hygiene · Reviewer: DevSecOps pass_

This review maps the project against the **2025–2026 threat landscape** (which has
shifted from "known-CVE dependencies" to **malicious packages + maintainer-account
compromise**), audits this repo's posture, and lists the tooling and remediation
to adopt. Dependency-CVE triage detail lives in [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

---

## 1. Executive summary

| Area | Status |
|---|---|
| Known dependency CVEs (`npm audit`) | 🟡 2 moderate, both unreachable (triaged) — 0 critical/high |
| Compromised-package exposure (Shai-Hulud / axios) | 🟢 Not affected (versions safe) |
| Lockfile / reproducible installs | 🟢 `package-lock.json` present |
| Hardcoded secrets in source | 🟢 None — all via `process.env` / `import.meta.env` |
| **Secrets in version control** | 🔴 **`.env` is tracked in git — must remediate** |

**Top priority: rotate the secrets in `.env` and untrack it.** Everything else is green or accepted.

---

## 2. The 2025–2026 threat landscape (why this matters)

The npm ecosystem crossed an inflection point in 2025: attacks moved from
opportunistic crypto-skimming to **industrialized, self-replicating supply-chain
compromise**.

- **Volume:** Sonatype's 2026 report counts **>1.23 million** cumulative malicious
  open-source packages (+75% YoY; ~454k new in 2025 alone).
- **Shai-Hulud worm (Sep 2025, "Second Coming" Nov 2025):** the registry's first
  **self-propagating** malware — phishes a maintainer, steals npm/cloud tokens,
  runs secret-scanners to find more, and republishes itself into more packages.
- **axios compromise (Mar 30–31, 2026):** malicious `axios@1.14.1` / `axios@0.30.4`
  pulled in `plain-crypto-js@4.2.1` whose **postinstall script dropped a cross-platform
  RAT**. Live ~2–3h; attributed to N. Korean **Sapphire Sleet**.

**Implication:** `npm audit` (which only knows *published advisories*) is necessary
but **not sufficient**. The bigger risk is a *trusted* package turning malicious for
a few hours, executing on `npm install` via lifecycle scripts. Defenses must cover
**install-time execution, maintainer compromise, and secret exposure**, not just CVEs.

---

## 3. Audit findings (this repo)

### 🔴 CRITICAL — `.env` committed to version control
`.env` appears in `.gitignore`, but `git ls-files` confirms it is **already tracked**
(it was committed before being ignored; `.gitignore` does not untrack files). Any
secret it holds (e.g. `SUPABASE_JWT_SECRET`, `ROOT_EMAIL`, SMTP creds, Cloudinary &
Resend keys) is in the repo and its history.

**Remediate (in order):**
1. **Rotate every credential in `.env`** — treat all as compromised (Supabase JWT
   secret, Cloudinary key/secret, Resend API key, SMTP password, etc.).
2. **Untrack it:** `git rm --cached .env` then commit (the local file stays; future
   commits won't include it — `.gitignore` already covers it).
3. **Purge history** if the repo was ever pushed/shared: `git filter-repo --path .env --invert-paths` (or BFG), then force-push and have collaborators re-clone.
4. Provide a committed **`.env.example`** with keys but no values.

### 🟢 Compromised-package exposure — not affected
- **axios:** installed **1.16.0**; declared `^1.15.0`. The malicious `1.14.1`/`0.30.4`
  are **below** the range and cannot be resolved. Safe.
- No Shai-Hulud-flagged packages observed in the direct dependency set.

### 🟢 Lockfile present
`package-lock.json` is committed → reproducible installs with integrity hashes.
Always install in CI with `npm ci` (lockfile-exact), never `npm install`.

### 🟢 No hardcoded secrets in source
Repo-wide scan of `*.js/ts/tsx` found only `process.env` / `import.meta.env`
references — no embedded keys, tokens, or private keys.

### 🟡 Residual dependency CVEs — triaged unreachable
2 moderate (`uuid <11.1.1` via `exceljs`). Reachability analysis shows `exceljs`
uses `uuid.v4()` only (no `buf`, not v3/v5/v6), so the CVE path is unreachable.
Full detail + remediation options in [SECURITY-AUDIT.md](SECURITY-AUDIT.md).

---

## 4. Tooling — what's used today (2026), and what to adopt here

| Layer | Modern tool(s) | Why / what it catches |
|---|---|---|
| **SCA** (known CVEs in deps) | `npm audit`, **OSV-Scanner**, **Trivy**, Grype, Snyk | Advisory DB matching (NVD/OSV/GHSA). OSV-Scanner/Trivy are free, self-hosted. |
| **SAST** (code flaws) | **Semgrep** (2026 OSS default), CodeQL | Pattern/dataflow analysis: injection, authz gaps, unsafe sinks. Fast in CI. |
| **Secrets scanning** | **gitleaks**, TruffleHog, Semgrep secrets | Catches committed keys (would have flagged this repo's `.env`). |
| **Supply-chain / malicious pkg** | **Socket.dev**, Sonatype, `npm` provenance/attestations | Detects install-scripts, network/fs access, typosquats, maintainer-takeover signals — the Shai-Hulud/axios class. |
| **Reachability** | Endor Labs / Snyk (commercial) | Confirms whether vulnerable code is actually called — cuts noise 70–90% (the manual analysis we did for uuid). |

**Recommended minimum (free):** **Semgrep + OSV-Scanner + gitleaks**, run in CI on every PR.

---

## 5. Hardening roadmap ("update security again" checklist)

- [ ] **Rotate all `.env` secrets** (+ history purge if the repo was pushed). _Critical — manual._
- [x] `git rm --cached .env` — untracked (done).
- [x] Add **`.env.example`** (keys only) — done.
- [x] CI security gate added — [`.github/workflows/security.yml`](.github/workflows/security.yml): gitleaks (secrets) · `npm ci --ignore-scripts` + `npm audit` + Trivy (SCA) · Semgrep (SAST/SARIF).
- [x] Mitigate install-time RATs: CI installs with `npm ci --ignore-scripts` (blocks malicious postinstall payloads).
- [ ] Enable **2FA + provenance** on any npm publishing accounts (maintainer-compromise defense).
- [ ] Pin/replace abandoned deps (already removed `mailer`/`crypto`/`node`/`xss-clean`; keep watching `inquirer`/`shelljs`/`chalk` if unused at runtime).
- [ ] Patch the 2 triaged moderates when convenient (`exceljs@^4`).
- [ ] Re-run this review after any dependency change; keep [SECURITY-AUDIT.md](SECURITY-AUDIT.md) current.

---

## Sources
- [Sonatype / npm supply-chain attacks 2026 (shattered.io)](https://shattered.io/npm-supply-chain-attacks-2026/)
- [Unit 42 — npm threat landscape](https://unit42.paloaltonetworks.com/monitoring-npm-supply-chain-attacks/)
- [Microsoft — Mitigating the axios npm compromise](https://www.microsoft.com/en-us/security/blog/2026/04/01/mitigating-the-axios-npm-supply-chain-compromise/)
- [CISA — Supply chain compromise impacts axios](https://www.cisa.gov/news-events/alerts/2026/04/20/supply-chain-compromise-impacts-axios-node-package-manager)
- [AppSec Santa — open-source SCA tools 2026](https://appsecsanta.com/sca-tools/open-source-sca-tools)
- [DeepSource — SAST tools 2026](https://deepsource.com/resources/static-analysis-tools)
