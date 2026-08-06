# ZGALAXY Comprehensive Plan — Restructuring, Feature Completion, and Running All Functions Efficiently

**Date:** 2026-08-04
**Reference:** Security & architecture audit findings in `docs/AUDIT-REPORT.md` + phase-ahead deep re-audit
**Goal:** A phased, actionable plan covering every feature declared by the project (implemented / partially implemented / missing), ensuring all functions run correctly, completely, securely and efficiently, ready for long-term production.

---

## Part A — Full Feature & Function Inventory with Implementation Status (after deep re-audit)

Labels: ✅ Implemented & working · ⚠️ Partially implemented / incomplete · 🧪 Declared but stub/simulation · ❌ Not implemented

### 1. Authentication & User Management
| Feature | Status | Audit detail |
|---------|--------|--------------|
| Login (Bearer session) | ✅ | Works, but no rate-limit and no role enforcement |
| ADMIN/OPERATOR/READ_ONLY roles | ⚠️ | Roles stored but **never enforced** (no RBAC) |
| User create/delete/list | ⚠️ | Works, but any authenticated user could do it (C1) |
| Password hashing | ⚠️ | PBKDF2-SHA512 @ 1000 iterations (very weak) + sync hashing blocks the event loop |
| Runtime `role` validation | ❌ | No runtime validation (only a compile-time `UserRole` type) |
| Default admin login | ⚠️ | `admin/admin` created by default and shown on the login screen |

### 2. Planet
| Feature | Status | Detail |
|---------|--------|--------|
| Read Planet info | ✅ | Works |
| Build/regenerate Planet (signed binary) | ✅ | Works with real `zerotier-idtool`/`mkmoonworld`; placeholder fallback gives misleading success on CLI failure |
| Download planet file | ✅ | Public/no auth (H6) |
| Delete planet | ❌ | Writes an empty file instead of deleting (M6) — status stays ACTIVE |
| Signature validation | 🧪 | Hardcoded `checksum: 'VALID_SIGNATURE'` with no real verification (M4) |
| Templates | ✅ | Static JSON returned |
| Import external Planet | ⚠️ | Written in service but **no route** calls it; may fail when the file is missing |

### 3. Moon
| Feature | Status | Detail |
|---------|--------|--------|
| Create signed Moon | ✅ | Works (initmoon + genmoon) |
| List / download / delete Moon | ✅ | Works, but download is public and paths allow Path Traversal (H2) |
| Update endpoints / rebind | ⚠️ | Works but regenerates the whole file and picks the first `.moon` in ztVar (M15) |
| Migrate Moon between planets | 🧪 | Just re-points the same identity; **no real authority transfer** (M17) |
| File identity check | ⚠️ | Relies on first-file index (non-deterministic) |
| HA templates | ✅ | Static JSON |

### 4. Federation / Decentralized Network
| Feature | Status | Detail |
|---------|--------|--------|
| Network token lifecycle (create/revoke/renew/expiry/maxUses) | ✅ | Implemented and enforced server-side in handshake |
| ISOLATED (full isolation, zero leakage) | ✅ | Logically correct; shares 0 peers |
| INHERITED (auto discovery across the network) | ⚠️ | Local part works (peer registration/sharing), but **actual cross-node propagation is a stub** (M1) |
| Inter-node handshake | ✅ | Validates token (expiry/revoke/usage limit) |
| Join node | ⚠️ | Does SSRF (H1) **and uses the ZeroTier port instead of the API port** → end-to-end broken (M8) |
| Topology poisoning (valid token injects arbitrary peers) | ❌ | No peer identity verification or peer cap (M10) |
| Public handshake flood | ❌ | Public endpoint with no rate-limit or protection |

### 5. Cluster / HA
| Feature | Status | Detail |
|---------|--------|--------|
| Add/remove/list nodes | ✅ | Works |
| Cluster sync | 🧪 | No real health check; marks nodes ONLINE by default (M3) |
| Unified multi-root Planet (multi-root HA) | 🧪 | Builds from a single root despite reporting root count (M2) |
| 99.999% HA claim | ❌ | Not actually supported |

### 6. Cloudflare DNS & DDNS
| Feature | Status | Detail |
|---------|--------|--------|
| Cloudflare token verification / zones / records / update | ✅ | Works |
| Cloudflare create record | ❌ | Uses wrong endpoint `POST /zones` (M7) |
| Auto-sync every 5 minutes | ✅ | Worker exists |
| Auto-rebuild Planet on IP change | ✅ | Works with selective build |
| DDNS (dynamic IP tracking) | ✅ | Worker exists |
| Multiple IP providers availability | ❌ | Depends only on `icanhazip.com`, no fallback (L12) |

### 7. Identity / Certificates
| Feature | Status | Detail |
|---------|--------|--------|
| Generate identity | ✅ | Works |
| Rotate certificates | ⚠️ | Generates new identity + backup; no peer coordination |
| Identity integrity verification | 🧪 | Returns `integrity: OK` with no real verification; `certificateStatus` and `keyStrength` are hardcoded (M5) |

### 8. Backup
| Feature | Status | Detail |
|---------|--------|--------|
| Export archive | ✅ | Plain, unencrypted tar.gz |
| Import/restore | ⚠️ | Works but has a command-injection risk (H3) and restore is not exposed in the UI |
| "Encrypted archive" as declared | ❌ | Not encrypted (M16) |

### 9. Frontend (Web Console TUI)
| Feature | Status | Detail |
|---------|--------|--------|
| Obsidian & Gold TUI, no icons, custom dialogs | ✅ | Implemented in SvelteKit |
| Deployable production build | ❌ | adapter-auto with no platform; no `svelte.config.js`; `vite dev` used in production; `svelte-check` fails (M12/L11) |
| API integration | ⚠️ | CORS open `*`; default values (secret/port/credentials) embedded in code |
| "Restore backup" management | ❌ | No button / no `/backup/import` integration |

### 10. Infrastructure & Deployment
| Feature | Status | Detail |
|---------|--------|--------|
| Docker / entrypoint / deploy script | ⚠️ | Inherited from upstream `xubiaolin/zerotier-planet`; does not package/serve the ZGALAXY UI; entrypoint runs ztncui (L7/L8) |
| TLS/HTTPS | ❌ | All channels plaintext HTTP |
| Logging & monitoring | ❌ | Raw console logging, no rotation/audit; `/health` always ok |
| Tests / CI | ❌ | No tests, no CI, no lint |

---

## Part B — Deep Re-Audit Findings (technically confirmed)

Confirmed additions beyond the base audit report, after deep re-inspection:

1. **58 route handlers** across 11 routers (`auth`, `backup`, `cloudflare`, `cluster`, `ddns`, `domain`, `federation`, `identity`, `moon`, `network`, `planet`, `system`) — only ~15 documented in OpenAPI.
2. **No runtime `role` validation:** any string is stored, and roles are never enforced.
3. **Fully open CORS:** `Access-Control-Allow-Origin: *` + all methods; any browser site can talk to the API.
4. **Public handshake registers peers / performs operations without constraint:** topology poisoning (M10) with no cap and no identity verification.
5. **Shipped `dist_engine` was stale (0.1.2)** vs source (1.2.0) — rebuilt during the audit for compatibility; it must be a build artifact, never hand-edited.
6. **Path traversal confirmed in practice** via `DELETE/GET /api/v1/moons/..%2F...`, and **SSRF confirmed in practice** via `federation/join`.
7. **Both workers (DDNS + Cloudflare) rebuild the planet and write `moon.json` without a lock** → race risk (M14).

---

## Part C — Phased Master Plan (Work Packages)

> Principle: **Security first** (immediate) ← **fix partially-implemented/broken features** (first release) ← **implement declared-but-missing features** (second release) ← **UI/deploy/docs** ← **production readiness & quality**.

### Phase 0 — Immediate Hardening (Blockers) — Week 1
Priority is stopping or reducing immediate exploit risk.
- **P0-1 Enforce RBAC:**
  - Add a `requireRole(...ROLES)` middleware (ADMIN / OPERATOR) applied to every route.
  - Enforce: user creation & role assignment → ADMIN only; user deletion and the `admin` account protected.
  - Runtime role whitelist validation; fail-closed default for invalid values.
- **P0-2 Remove embedded secrets:**
  - `SECRET_KEY` required from environment; fail/refuse on missing or weak values; block the default key in the web UI.
  - Rotate/remove all secrets in `config/*.json` (Cloudflare token + sessions) immediately.
  - Stop leaking the raw `apiToken` from `/cloudflare/config` (return `apiTokenMasked` only).
- **P0-3 Secure sessions:** expiry + TTL + explicit revoke/logout; hash storage; prune expired sessions.
- **P0-4 Effective rate-limiting:** `express-rate-limit` on `/login`, `/handshake`, `/join`; unified error messages.
- **P0-5 Stronger hashing:** PBKDF2 ≥210,000 or argon2id; non-blocking async.

### Phase 1 — Fix Partially Implemented / Broken Features — Week 2-3
- **P1-1 Fix Planet:** real delete (`fs.unlink`) + correct status; remove misleading success on CLI failure (return clear warning); real signature verification or remove the `VALID_SIGNATURE` claim.
- **P1-2 Fix Moon:** safe path (reject `..`/`/`) in delete/download; deterministic `.moon` selection (from world id); clean up old files.
- **P1-3 Fix Federation join:** endpoint = API port (not ZeroTier port); block SSRF (public-domain allowlist, block RFC1918/metadata); timeout and response size limit.
- **P1-4 Fix Cloudflare create:** correct `POST /zones/{zoneId}/dns_records`.
- **P1-5 Fix Cluster:** real health check (TCP ping); honest status instead of automatic ONLINE.
- **P1-6 Fix backup:** `execFile` without shell; safe extraction (reject `..`); archive hash.
- **P1-7 Fix token secrets:** mask `tokenSecret` in token lists; reveal once at creation; hash at rest.
- **P1-8 Fix timeouts/races:** write lock (atomic rename) + single-flight for stores; coordinate DDNS/Cloudflare workers.

### Phase 2 — Implement Declared-But-Missing Features — Week 4-6
- **P2-1 Real mesh propagation:** actual fan-out of INHERITED topology to every transitive peer via trusted handshake + retry/backoff + loop detection; peer caps and identity verification (anti P0/M10).
- **P2-2 Multi-root Planet (multi-root HA):** aggregate endpoints of all ONLINE nodes into `moon.json.roots[]` then `mkmoonworld`; honest `lastUnifiedBuildAt`; explicit failure when no active root.
- **P2-3 Real Moon migration:** transfer signing/identity authority to the target planet (with the key) or document as re-point behavior; remove the original after success; real `previousPlanetId`.
- **P2-4 Encrypted backup:** real encryption with a secret (age/GPG/AES-GCM) + key management + restore via the UI.
- **P2-5 Honest identity/certificates:** measure `keyStrength` from the actual key; real signature verification; rotation with proper invalidation.

### Phase 3 — Frontend, Deployment, Documentation — Week 7-8
- **P3-1 Fix frontend build:** create `svelte.config.js` with a real adapter (`adapter-node` or `adapter-static`), fix the two `svelte-check` errors, serve the build, `npm run preview` in production.
- **P3-2 Tighten CORS:** restrict to known origins + mesh peer list; remove the default key/credentials from the UI.
- **P3-3 Align Docker/deploy with ZGALAXY:** package and serve the UI; remove unneeded ztncui; `start_all.sh` with dynamic path.
- **P3-4 Documentation:** OpenAPI covering all routers (58); sync the guide; unified language; commit `package-lock.json`.
- **P3-5 TLS:** reverse proxy (Caddy/nginx/Traefik) with HTTPS + redirect + HSTS.

### Phase 4 — Production Readiness, Monitoring & Metrics — Week 9-10
- **P4-1 Replace JSON stores with SQLite (WAL/transactions/constraints)** with migration of existing data (security: locking and schema).
- **P4-2 Metrics infrastructure:** rich `/metrics` (Prometheus), structured logging (pino), log rotation, security audit events.
- **P4-3 Clean shutdown:** SIGTERM flush, real readiness reflecting ZeroTier state, pm2/systemd supervision.
- **P4-4 Tests & CI:** unit + integration + security regressions (RBAC, SSRF, traversal, injection); lint + `svelte-check` + build as gates; version-matching smoke test.

---

## Part D — Operational Target Map per Function (target behavior + acceptance criteria)

| Function | Target behavior after implementation | Acceptance criteria |
|----------|--------------------------------------|---------------------|
| Login | Secure login, rate-limit, lockout after repeated failures, security log | Roles cannot be bypassed; no brute-force |
| User management | ADMIN only; `admin` account protected | READ_ONLY/OPERATOR denied (401/403) |
| Passwords | Strong, cost-migratable, async hashing | Hash ≥210k or argon2 |
| Sessions | TTL + revoke + logout | Expired/revoked token rejected immediately |
| Build Planet | Signed binary with honest status reporting | Non-placeholder file on success; clear warning on CLI failure |
| Delete/verify Planet | Real delete; honest signature verification | After delete → NOT_CONFIGURED; verify reflects actual file |
| Moon migration | Real authority transfer + endpoint update | Target `.moon` served; original removed or marked |
| Moon path security | Reject traversal | `/moons/..` → 400/404 with no effect |
| Mesh propagation | Real inter-node communication with bounded loop growth | New node discovers INHERITED peers within N seconds |
| Cluster HA | Health check + real root aggregation | Unified build reflects all actually-ONLINE nodes |
| Cloudflare | verify/list/update/create all correct | New record creation succeeds against a real API |
| DDNS | IP tracking with multiple fallbacks | IP change updates endpoints + rebuild when enabled |
| Backup | Encryption + restore via UI | Encrypted archive; restore returns a sound state |
| Frontend | Production build served; CORS tight | `npm run build` + `preview` works; `/api` from the UI works |
| TLS | All traffic over HTTPS | No plaintext HTTP; HSTS enabled |
| Monitoring | Logs/metrics/readiness | Metrics on /metrics; clear service health |

---

## Part E — Integration Matrix (between components)

| From → To | Type | Current problem | Proposed solution |
|-----------|------|-----------------|-------------------|
| Web Console → Engine API | REST | CORS `*` + embedded key/credentials + default apiUrl | Restricted CORS, secrets from env, trusted dynamic baseURL |
| Engine → ZeroTier idtool/mkmoonworld | CLI subprocess | CLI failure reported as placeholder success | Honest error reporting, timeout cap |
| Engine → Cloudflare API | HTTPS | create uses wrong endpoint; raw token returned | Fix URL; mask token |
| Engine → WAN IP provider | HTTPS external | Single icanhazip point | Multiple + fallback + family variation |
| Federation: node↔node | HTTP REST | Wrong port + SSRF + stub propagation | API port, allowlist, real propagation |
| DDNS Worker ↔ PlanetBuilder | Shared (moon.json) | Lock-free write race | Single-flight lock + atomic rename |
| Cloudflare Worker ↔ PlanetBuilder | Shared | Same race | Same |
| Backup ↔ ztVar | Files | Injection / zip-slip / unencrypted | execFile + path check + encryption |
| Session/Auth ↔ all routes | Bearer | No RBAC, no expiry | requireRole + TTL |

---

## Part F — Priority & Resources (Rough Order of Magnitude)

- **Immediate:** Phase 0 in full — one week, critical security impact.
- **Release 1 (1.3.x):** Phase 1 — two weeks; addresses everything "implemented but broken/misleading".
- **Release 2 (2.0):** Phase 2 — three weeks; completes the declared decentralized features (mesh, multi-root, migration, encrypted backup).
- **Deploy:** Phase 3 — two weeks.
- **Production:** Phase 4 — two weeks; SQLite + CI + monitoring.

Total approximate timeline: **10 weeks** with one engineer; shorter with an extra security member for Phase 0.

---

## Mandatory Notes Before Starting

1. **Rotate the current Cloudflare token in `config/cloudflare_config.json` immediately** (exposed and observed during the audit; no API call was made).
2. Ensure any change to `dist_engine` is built from source in CI and never updated by hand.
3. Use branches/PRs per work package, adding an acceptance test for each feature before closing it.

---

## Part G — Detailed Task-Level Backlog

> Each task has: **ID** · **file/area** · **action** · **Definition of Done** · **reference bug**. Executed in order within each phase. On closing, add an acceptance test verifying the DoD.

### Phase 0 — Immediate Security Blockers (Week 1)

| # | File / Area | Action | Definition of Done | Bug |
|---|-------------|--------|--------------------|-----|
| P0-1.1 | `src/engine/app.ts`, new `rbac.ts` | Build `requireRole('ADMIN'\|'OPERATOR')` middleware reading `req.userRole` (set by authenticator), rejecting others with 403 | Every restricted route: system data/users/delete/backup/keys ADMIN-only | C1 |
| P0-1.2 | All routers | Apply `requireRole` on every mutating point; protect `/auth/users*`, `/backup/*`, `/identity/rotate` (ADMIN) | Test that READ_ONLY is denied on every mutation | C1 |
| P0-1.3 | `src/services/userService.ts` | Role whitelist; reject values not `ADMIN\|OPERATOR\|READ_ONLY`; protect `admin` deletion | Invalid `role` → 400; delete admin → 403 | L?/new |
| P0-2.1 | `src/engine/config/index.ts` | Make `SECRET_KEY` required (fail on missing); reject known default | Boot without env refuses or generates a strong key | C2 |
| P0-2.2 | `web-console/src/routes/+page.svelte` | Remove default `apiKey` and `admin/admin` credentials, show "required" instead | No key/credentials in code/screen | C2/C3 |
| P0-2.3 | `src/engine/routes/cloudflare.router.ts` | Stop returning raw `apiToken`; `{ apiTokenMasked, hasApiToken }` only | `/cloudflare/config` never shows the token | C5 |
| P0-2.4 | `config/*` | Rotate Cloudflare token and all sessions; remove secrets from disk or move to vault/env | No valid secrets in `config/` | C4 |
| P0-3.1 | `src/services/userService.ts` | Token TTL (e.g., 24h) + explicit revoke (logout endpoint) | TTL/revoke exceeded → 401 | H4 |
| P0-3.2 | `src/engine/routes/auth.router.ts` | `GET|POST /logout` deletes the session | Logout invalidates immediately | H4 |
| P0-4.1 | `package.json`, `app.ts` | Install and enable `express-rate-limit` on `/login`, `/handshake`, `/join` | Over-threshold → 429; no bypass | H5 |
| P0-4.2 | `src/engine/routes/auth.router.ts` | Unified error messages (do not reveal user existence) | No username/password distinction | H5/L |
| P0-5.1 | `src/services/userService.ts` | Raise PBKDF2 to ≥210,000 or migrate to `argon2`; `crypto.pbkdf2` (async) | OWASP-approved cost; no event-loop blocking | H7 |

### Phase 1 — Fix Partially Implemented / Broken Features (Week 2-3)

| # | File / Area | Action | Definition of Done | Bug |
|---|-------------|--------|--------------------|-----|
| P1-1.1 | `src/services/planetService.ts` | `deletePlanet` uses `unlink`; return correct status | After delete, `/info` shows NOT_CONFIGURED | M6 |
| P1-1.2 | `planetService.buildPlanet` | On CLI failure: no placeholder + no fake success; return `{success:false, error}` or clear warning | No false success when tools missing | L/M4 |
| P1-1.3 | `planetService.validatePlanet` | Real signature verification or remove hardcoded `VALID_SIGNATURE` | Result reflects actual file content | M4 |
| P1-2.1 | `src/services/moonService.ts` | Strict `moonId` validation (reject `..`,`/`,`\`, null); assert path inside `distPath` | Traversal attempt → 400/404 with no effect | H2 |
| P1-2.2 | `moonService.createMoon`/`listMoons` | Deterministic `.moon` selection (from world id in `moon.json`) instead of `files.find` | No wrong selection with multiple files | M15 |
| P1-3.1 | `src/services/federationPeerService.ts` | `localEndpoint` uses API (HTTP) port, not ZeroTier port | `responderEndpoint` valid for HTTP | M8 |
| P1-3.2 | `federationPeerService.joinFederation` | Public-domain allowlist + block RFC1918/local/metadata; timeout and size limit | SSRF blocked | H1 |
| P1-4.1 | `src/services/dns/providers/cloudflareProvider.ts` | Fix CREATE to `/zones/{zoneId}/dns_records` | New record creation succeeds | M7 |
| P1-5.1 | `src/services/clusterService.ts` | Real check (TCP connect on ip:port) + honest status | Dead node marked OFFLINE | M3 |
| P1-6.1 | `src/services/backupService.ts` | `execFile` without shell; block zip-slip on extract; size/type checks | No injection, no out-of-path writes | H3 |
| P1-7.1 | `src/services/federationTokenService.ts` | Mask `tokenSecret` in lists; reveal once; hash at rest | No secret disclosure in queries | M9 |
| P1-8.1 | `src/services/fileManager.ts` | Atomic writes (`tmp`+`rename`) + per-store write lock | No lost updates under concurrency | M14 |

### Phase 2 — Implement Declared-But-Missing Features (Week 4-6)

| # | File / Area | Action | Definition of Done | Bug |
|---|-------------|--------|--------------------|-----|
| P2-1.1 | `src/services/federationPeerService.ts` | `propagateMeshTopology` actually propagates to every transitive peer via trusted handshake + retry/backoff + loop detection | New node actually discovers INHERITED peers | M1 |
| P2-1.2 | `federationPeerService.handleIncomingHandshake` | Peer cap + token-bound identity verification + rate-limit | No topology poisoning, no unbounded growth | M10 |
| P2-2.1 | `src/services/clusterService.ts` | Aggregate all ONLINE node endpoints into `moon.json.roots[]` then build | Real multi-root unified build | M2 |
| P2-3.1 | `src/services/moonMigrationService.ts` | Real authority transfer (or documented re-point); remove original; `previousPlanetId` | Real, non-misleading migration result | M17 |
| P2-4.1 | `src/services/backupService.ts` | Real encryption (AES-GCM/age) + restore via route | Encrypted archive; restore returns state | M16 |
| P2-5.1 | `src/services/identityService.ts` | Measure `keyStrength` from the key; real verification instead of hardcoded `OK`/`VALID` | Honest identity reports | M5 |

### Phase 3 — Frontend, Deployment, Documentation (Week 7-8)

| # | File / Area | Action | Definition of Done | Bug |
|---|-------------|--------|--------------------|-----|
| P3-1.1 | `web-console/svelte.config.js` (new) + `vite.config.ts` | Real adapter (`adapter-node` or `adapter-static`) | `npm run build` produces real `build/` | M12 |
| P3-1.2 | `web-console/src/routes/+page.svelte` | Fix the two `svelte-check` errors (customHeader union) | `npm run check` with no errors | L11 |
| P3-1.3 | `deploy.sh` | Run `vite preview`/static instead of `vite dev` | Real production services | M12/L |
| P3-2.1 | `src/engine/app.ts` | CORS restricted to known origins; add security options | No `Access-Control-Allow-Origin: *` | L4 |
| P3-2.2 | `web-console` env | baseURL and key from production env | No embedded secrets | C2 |
| P3-3.1 | `Dockerfile`/`entrypoint.sh`/`start_all.sh` | Package and serve the UI; remove ztncui; dynamic path | Image serves UI + API | L7/L8 |
| P3-4.1 | `docs/openapi.yaml` + `API-DOCUMENTATION.md` | Cover all 58 routes; unified docs | Every endpoint documented and matching the app | L1/L2 |
| P3-4.2 | `.gitignore` | Stop ignoring `package-lock.json`; commit it | Reproducible builds | L10 |
| P3-5.1 | Deployment | Add reverse proxy + HTTPS + HSTS | No plaintext HTTP | M13 |

### Phase 4 — Production Readiness & Monitoring (Week 9-10)

| # | File / Area | Action | Definition of Done | Bug |
|---|-------------|--------|--------------------|-----|
| P4-1.1 | New stores | Migrate JSON → SQLite (WAL/transactions/constraints) with a migration tool | No corrupt reads/writes under concurrency | M14 |
| P4-2.1 | `server.ts`, `/metrics` | Expand metrics (Prometheus) + structured logging (pino) + rotation | Observable and alertable | L9/L14 |
| P4-3.1 | `server.ts` | SIGTERM clean shutdown + real readiness reflecting ZeroTier state | Clean stop; honest readiness | L14 |
| P4-4.1 | New `test/` | unit/integration/security-regression tests (RBAC, SSRF, traversal, injection) | Critical coverage; green in CI | General |
| P4-4.2 | CI (GitHub Actions) | build + lint + `svelte-check` + tests + smoke (version match) | P0-P4 does not regress | M11 |

---

### Progress Checklist (across phases)

```
[X] P0   Immediate security      (C1–C5, H1–H5, H7, L11) — implemented & verified 2026-08-04
[X] P1   Fix partial work        (M2–M9, M14, M15, H2/H3) — implemented & verified 2026-08-04 (M15 deferred→P2)
[X] P2   Declared features       (M1, M10, M16, M17, M2, M5) — implemented & verified 2026-08-04
[X] P3   UI/deploy/docs          (M12, L1–L8, L10, M13) — implemented 2026-08-04 (Docker rebuild/test manual)
[X] P4   Production/CI           (L9, L14, M11, M14)     — completed 2026-08-04
      · P4-1 SQLite auth store (USE_SQLITE=1, Node≥22.5, migration tool) — other stores later
      · P4-2 /metrics Prometheus + /ready
      · P4-3 Clean shutdown SIGTERM/SIGINT
      · P4-4 Security tests (15→24) + CI (GitHub Actions)
```

Only after **P0** is complete is the platform considered safe for responsible operation; it is recommended that no network node handles real traffic before passing at least P1.
