# Compliance Review — Smart Barangay

_Reviewed: 2026-06-25. Technical compliance mapping (not legal advice). Pairs with
[SECURITY.md](SECURITY.md) (threat review) and [SECURITY-AUDIT.md](SECURITY-AUDIT.md) (dep triage)._

A Philippine barangay system processing residents' personal data is a **Personal
Information Controller (PIC)** under the **Data Privacy Act of 2012 (RA 10173)** and
its IRR, overseen by the **National Privacy Commission (NPC)**. This document maps the
system to: (1) RA 10173 data-privacy law, (2) OWASP/cybersecurity, (3) DevSecOps
secure-SDLC, and (4) open-source licensing (IP law).

---

## 1. Personal data inventory (what we process)

| Store | Personal / sensitive data |
|---|---|
| `residents_records` | name, address, **DOB**, contact, civil status, **religion**, employment, and **government IDs** (PWD, senior, 4Ps, solo-parent, voter) → includes **sensitive personal information** (religion, health-adjacent IDs) |
| `blotter_cases` | complainant/respondent names, narrative, **uploaded evidence** (photos/video) |
| `document_requests` | requestor name, purpose, references |
| `officials` / `officials_accounts` | names, positions, contact, credentials (hashed) |
| `audit_logs` | actor, action, IP, device fingerprint |

Because **sensitive personal information** is involved (religion, IDs), RA 10173's
stricter processing conditions (§13) apply.

---

## 2. RA 10173 (Data Privacy Act) — mapping

**Three core principles (§11):** Transparency · Legitimate Purpose · Proportionality.

| Requirement | Status | Evidence / gap |
|---|---|---|
| **Lawful basis** (LGU mandate / public function; consent where needed) | 🟡 Partial | Processing supports barangay functions (lawful); **no explicit consent/notice UI** for residents — add a privacy notice + consent at registration |
| **Transparency / Privacy Notice** | 🔴 Missing | No published Privacy Notice describing what's collected, why, retention, and rights → **add one** |
| **Proportionality / data minimization** | 🟡 | Reasonable fields, but review whether `religion` and all ID numbers are strictly necessary |
| **Security measures (§20 — organizational/physical/technical)** | 🟢 Strong (technical) | bcrypt password hashing, JWT (HS256, expiry+refresh), RBAC, rate limiting, HTTPS/secure cookies, helmet, CORS allowlist, audit logging, IPS/IDS + captcha. See §3. |
| **Data subject rights (§16: be informed, access, correct, erase/block, object, portability, complain)** | 🟡 Partial | Access/correct via Profile + Account Management; **no self-serve erasure/export or objection flow** → add |
| **Breach notification (§20(f): 72h to NPC + data subjects)** | 🔴 No documented plan | Detection exists (audit logs, IPS/IDS); **add a written incident-response + 72h notification procedure** |
| **Data retention & disposal** | 🔴 Undefined | Archive exists but **no retention schedule / disposal policy** → define (e.g., purge after statutory period) |
| **Data Protection Officer (DPO)** | 🔴 Organizational | DPA requires a designated **DPO** → designate and publish contact |
| **NPC registration** (PIC w/ sensitive data ≥ thresholds) | 🔴 Organizational | Register the processing system with the NPC if thresholds are met |
| **Cross-border / processors** (Supabase, Cloudinary, Resend, Render — likely overseas) | 🟡 | Third-country processors hold PII → ensure **Data Sharing/Processing Agreements** and adequacy; document in the Privacy Notice |

---

## 2b. International data-protection law (GDPR & global)

RA 10173 was modeled on EU data-protection principles, so the controls above map
closely to the **EU GDPR**. Aligning to GDPR (the global benchmark) also covers
analogous regimes (UK GDPR, Singapore PDPA, California CCPA/CPRA). GDPR applies
extraterritorially (Art 3) if the system ever processes EU data subjects' data.

| GDPR article | Requirement | Status / gap |
|---|---|---|
| **Art 6** | Lawful basis (public task / consent) | 🟡 public-task basis exists; **explicit consent UI** needed |
| **Art 9** | Special-category data (e.g. **religion**) → explicit consent / specific condition | 🔴 currently collected without explicit consent → add |
| **Art 12–14** | Transparent information / privacy notice | 🔴 add Privacy Notice |
| **Art 15–22** | Data-subject rights: access, rectification, **erasure ("right to be forgotten")**, restriction, **portability**, objection, no solely-automated decisions | 🟡 access/rectify partial; **add erasure + export**; no automated decisioning (✓) |
| **Art 25** | Privacy by design & by default | 🟢 least-privilege RBAC, data minimization, secure defaults |
| **Art 30** | Records of Processing Activities (ROPA) | 🟡 partial via this inventory → formalize a ROPA |
| **Art 32** | Security of processing | 🟢 see §3 (encryption, access control, resilience, audit) |
| **Art 33–34** | Breach notification (72h to authority + data subjects) | 🔴 add written plan |
| **Art 35** | DPIA for high-risk (sensitive data) processing | 🔴 conduct a DPIA |
| **Art 37–39** | Data Protection Officer | 🔴 designate DPO |
| **Art 44–49** | International transfers (SCCs/adequacy for Supabase/Cloudinary/Resend/Render) | 🟡 execute SCCs/DPAs |

**Net:** technical security (Art 25/32) is strong; the gaps are the same
**privacy-program** items as RA 10173 (notice, consent, DSAR, breach plan, DPO,
transfers) — satisfying RA 10173 + GDPR together closes both.

---

## 3. Cybersecurity — OWASP Top 10 (2021) mapping

| OWASP | Control in this system |
|---|---|
| **A01 Broken Access Control** | `Rbac.js` + `authorizeRoles()`; role derived from the **verified JWT** (not client header); IDOR guard (residents restricted to own records); term-based auto-restrict |
| **A02 Cryptographic Failures** | passwords **bcrypt**-hashed; JWT **HS256 (pinned)**; secrets in env (not source); `secure`+`SameSite` cookies; HTTPS in prod |
| **A03 Injection** | Supabase client = parameterized queries (no raw SQL string-building); input validation (`joi`/`zod`); output sanitization (`xss`, `DOMPurify`) |
| **A04 Insecure Design** | per-account rate limiters (documents + incidents, DB-backed), captcha/`Regulator` security pulse |
| **A05 Security Misconfiguration** | `helmet`, CORS **allowlist** (no wildcard), body-size limits, GraphQL **introspection disabled**, `x-powered-by` off, fail-fast on missing secrets |
| **A06 Vulnerable & Outdated Components** | `npm audit` + CI **SCA gate** (Trivy/OSV); residual moderates triaged unreachable ([SECURITY-AUDIT.md](SECURITY-AUDIT.md)) |
| **A07 Identification & Auth Failures** | bcrypt, **login rate limiting**, JWT expiry + rotating refresh, **OTP** for root/master access |
| **A08 Software & Data Integrity** | committed **lockfile**, CI `npm ci --ignore-scripts` (blocks malicious postinstall), SBOM via lockfile |
| **A09 Logging & Monitoring** | `audit_logs` (`logActivity` w/ actor+IP+device), **IPS/IDS** + captcha regulator |
| **A10 SSRF** | minimal outbound surface (Cloudinary uploads only); no user-controlled URL fetch |

---

## 4. DevSecOps / Secure SDLC compliance

- **Shift-left security gate** — [`.github/workflows/security.yml`](.github/workflows/security.yml): gitleaks (secrets), npm audit + Trivy (SCA), Semgrep (SAST → Security tab), on every push/PR.
- **Secrets management** — `.env` untracked + [`.env.example`](.env.example) template; CI secret scanning over full history.
- **Supply-chain hardening** — lockfile-exact installs, `--ignore-scripts`, dependency triage, removal of abandoned/squatter packages.
- **Separation of concerns** — backend consolidated under `server/` (auth / records / services / lib) for auditability and least-privilege module boundaries.
- **Change traceability** — small, single-purpose commits; build/import verification before each.

---

## 5. Open-source licensing (IP law) compliance

- Stack is **overwhelmingly permissive**: **399 MIT**, 31 ISC, 18 Apache-2.0, 22 BSD. **No AGPL; no forced GPL.**
- Dual-licensed deps resolved to the permissive option: `dompurify` → Apache-2.0, `jszip` → MIT.
- Weak/file-level copyleft used **unmodified** as deps (compliant): `lightningcss`/build = MPL-2.0; `caniuse-lite` = CC-BY-4.0 (attribution only).
- **Obligation:** retain copyright/license notices (MIT/BSD/Apache attribution) — ship a `THIRD-PARTY-NOTICES` / `licenses` file in production builds.

---

## 6. Prioritized compliance action items

**Technical (codeable):**
- [ ] 🔴 Rotate `.env` secrets + purge history (carryover from [SECURITY.md](SECURITY.md)).
- [ ] Add a **Privacy Notice + consent** step at resident registration (RA 10173 transparency).
- [ ] Add **data-subject-rights** flows: data export + erasure/objection request.
- [ ] Define + enforce a **data retention/disposal** schedule (auto-purge archived records past the statutory period).
- [ ] Generate `THIRD-PARTY-NOTICES.txt` at build (licensing attribution).

**Organizational (not code — for the barangay/LGU):**
- [ ] Designate and publish a **Data Protection Officer (DPO)**.
- [ ] **Register** the system with the **NPC** (if thresholds met).
- [ ] Execute **Data Processing/Sharing Agreements** with Supabase, Cloudinary, Resend, Render.
- [ ] Adopt a written **breach-response plan** (72-hour NPC + data-subject notification).

> _Disclaimer: technical/engineering assessment only; confirm legal obligations with the
> barangay's DPO / legal counsel and the NPC._
