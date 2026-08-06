# ZGALAXY — Comprehensive Architectural & Technical Audit Report

**Audit Date:** 2026-08-04
**Version Audited:** ZGALAXY v1.2.0 (package.json)
**Audit Scope:** All backend engine modules, all REST routes, all services, security architecture, synchronization engines, web-console, deployment tooling, databases (JSON stores), and communication protocols.
**Methodology:** Static code review of `src/`, `docs/`, deployment scripts; TypeScript compile verification (`tsc --noEmit` passes); Svelte check (`svelte-check` fails with 2 errors); live runtime verification of the API on the host; isolated sandbox instance (`ENGINE_PORT=3100`, temp paths) used to safely test destructive operations; adversarial scenario tests (RBAC, SSRF, path traversal, command injection, token leakage, topology injection). All test artifacts were removed and system state restored.

---

## 1. Executive Summary

ZGALAXY is a well-structured Node.js/Express control plane for self-hosted ZeroTier Planet & Moon infrastructure, with a layered architecture (routers → services → `FileManager`/`CliService`), clean TypeScript (strict mode, zero compile errors), and a genuinely implemented federation-token lifecycle (create/revoke/renew/expiry/maxUses with server-side enforcement in the handshake path) and dual-mode isolation logic (`DIRECT_ISOLATED` correctly shares zero peers).

**However, the project is NOT production-ready.** The audit confirmed multiple **critical security defects** that allow complete authentication bypass and privilege escalation, plus a live Cloudflare credential and valid admin session tokens stored in cleartext on disk. A large number of **advertised "enterprise" features are stubs or simulations** (mesh propagation, multi-root HA Planet compilation, cluster health, signature validation, identity verification, encrypted backup). Documentation (OpenAPI, API guide) covers a small fraction of the actual API surface, and the frontend cannot produce a deployable production build.

**Severity totals:** 5 Critical · 7 High · 17 Medium · 14 Low. All were verified by code inspection and, where safe, by live/sandbox exploitation.

---

## 2. Confirmed Findings by Severity

### CRITICAL

| # | Finding | Evidence / Impact | Remediation |
|---|---------|-------------------|-------------|
| C1 | **Role-based access control (RBAC) is entirely absent.** All "Admin only" endpoints are protected only by the global token-validity check, never by role. | Verified live: a `READ_ONLY` user listed all users, created a new `ADMIN` account, and deleted the `admin` account. Affects `auth.router.ts` (`/users`, `/users/create`, `/users/:username`) and every state-changing route across the API. Any valid session token is full admin. | Add an `requireRole('ADMIN')` middleware and enforce it on every route. Reject `ADMIN` role creation/assignment by non-admins. Protect `admin` account from deletion. |
| C2 | **Hardcoded default secret key** = `zerotier_planet_secret_key_default_123` (`src/engine/config/index.ts:20`) is a full ADMIN bearer-token bypass; it is also baked into the web console (`web-console/src/routes/+page.svelte:6`). | Verified live: `Authorization: Bearer zerotier_planet_secret_key_default_123` grants ADMIN on a default install. Anyone who reads the shipped frontend JS or source gains admin. | Require `SECRET_KEY` env (fail-fast if missing/weak), or replace with per-deploy generated secrets; never ship a default in the client. |
| C3 | **Default admin credentials `admin`/`admin` auto-created and displayed on the login screen**; password hashing is PBKDF2-SHA512 with only **1,000 iterations** (OWASP recommends ≥210,000 for SHA-512), and login has **no rate limiting**. | `userService.ts:33-52`, login UI at `+page.svelte:876`. Default account + weak hash + unlimited attempts = trivial brute-force. | Force password change on first login, increase to ≥210,000 iterations (or use argon2id), add exponential backoff/rate-limiting (e.g., `express-rate-limit`), account lockout. |
| C4 | **Live secrets present on disk in cleartext:** `config/cloudflare_config.json` contains a real Cloudflare API token; `config/sessions.json` contains 31 valid admin session tokens; `config/users.json` contains password hashes. | Sessions are stored plaintext and **never expire** (`validateToken` ignores `createdAt`). Any file/backup access or path-traversal compromise yields full control. | Encrypt secrets at rest; implement session expiry + server-side revocation/logout; rotate the exposed Cloudflare token immediately; add `.gitignore` confirmation and out-of-band secret storage (env/vault). |
| C5 | **Raw Cloudflare API token returned by the API.** `GET /api/v1/cloudflare/config` spreads the full config (`...cfg`) including `apiToken` alongside the masked copy. | Verified live: raw `cfat_...` token returned to any authenticated user (including READ_ONLY). | Never serialize the raw token; return only `apiTokenMasked`/`hasApiToken`. |

### HIGH

| # | Finding | Evidence / Impact | Remediation |
|---|---------|-------------------|-------------|
| H1 | **SSRF in federation join.** `POST /api/v1/federation/join` makes a server-side `fetch(cleanEndpoint + '/api/v1/federation/handshake')` to an attacker-controlled URL (`federationPeerService.ts:176`). | Verified live: server issued an HTTP POST to an internal `127.0.0.1` listener and echoed the response. Enables internal port scanning, metadata-endpoint access, and internal service probing. | Validate `targetEndpoint` against an allowlist (public IPs only, scheme https/http explicit), block RFC1918/link-local/metadata ranges, add timeouts and response-size caps. |
| H2 | **Path traversal in Moon delete & download.** `MoonService.deleteMoon/getMoonFilePath` join an unvalidated `moonId` into a path (`moonService.ts:108-129`); the download route is public. | Verified live: `DELETE /api/v1/moons/..%2Fsecret_file.moon` deleted a file outside `dist/`; unauthenticated `GET .../download` disclosed arbitrary `.moon`-suffixed file contents. | Reject `..`, `/`, `\`, null bytes in `moonId`; resolve and assert the path stays under `distPath`; require auth for downloads or use a tokenized download endpoint. |
| H3 | **Command injection / tar extraction risk in backup.** `importBackup` runs `tar -xzf ${tarPath} -C ${backupDir}` with a user-supplied path interpolated into a shell string (`backupService.ts:31`); `exportBackup` is fine but also shell-built. | Injection is currently gated by a preceding `fileExists` check, but any file whose name contains shell metacharacters defeats it; crafted tarballs can overwrite arbitrary files in `ztVar` (zip-slip) including `identity.secret`/`authtoken.secret`. | Use `execFile` with array args; validate the tarball path; extract with traversal protection (`tar -xzf ... --no-same-owner --no-same-permissions` + strip components / reject `..` entries); restrict import to an admin-only, path-allowlisted flow. |
| H4 | **Session tokens never expire and cannot be revoked/logged out.** `UserService.validateToken` (`userService.ts:96-99`) performs an exact-match lookup with no `createdAt`/TTL check; no logout endpoint exists. | Verified: tokens minted on 2026-08-01 remain valid. Compromised tokens are valid forever; token bloat grows `sessions.json` unboundedly. | Add TTL + sliding expiry, prune expired sessions, support explicit revoke/logout, store tokens hashed. |
| H5 | **No login rate limiting / brute-force protection.** `POST /api/v1/auth/login` is unthrottled and returns distinct 401 messages. | Combined with C3, enables offline/online brute-force of the weak default credential set. | Rate limit by IP + username; uniform error messages; CAPTCHA after N failures; audit log. |
| H6 | **Unauthenticated side-effectful "download" bypass.** `isPublicPath` treats any path ending in `/download` as public (`app.ts:34`), and `planet/download` creates a placeholder planet file when missing (`planet.router.ts:24-28`). | An anonymous attacker can trigger filesystem writes and read the planet/moon binaries without authentication. | Restrict public download to the single planet endpoint with a signed/expiring token; remove the file-creation side effect from a GET handler. |
| H7 | **Weak, synchronous password hashing.** PBKDF2 at 1000 iterations (`userService.ts:34`), executed synchronously on the event loop. | Weak offline resistance; `pbkdf2Sync` blocks the event loop under login load (DoS amplifier). | Use async `crypto.pbkdf2` or `argon2`/`bcrypt` with OWASP-recommended cost factors. |

### MEDIUM

| # | Finding | Evidence / Impact | Remediation |
|---|---------|-------------------|-------------|
| M1 | **Mesh topology propagation is a stub.** `propagateMeshTopology` only counts inherited peers and returns the count — it never contacts remote nodes (`federationPeerService.ts:247-253`). The README's "transitive mesh discovery propagates seamlessly across 100+ nodes" is not implemented; `/federation/sync-now` is cosmetic. | Verified: `sync-now` returns `{propagatedPeersCount: 1}` with zero network activity. | Implement real fan-out: push topology to each transitive peer's handshake endpoint (with token), retry/backoff, and cycle detection. |
| M2 | **Multi-root HA Planet compilation is not implemented.** `buildUnifiedClusterPlanet` compiles a planet from only the **primary** node's endpoint and merely reports `federatedRootsCount` (`clusterService.ts:124-152`). The "unified multi-root distribution file" and "99.999% HA" claims are false. | No aggregation of multiple roots into `world.bin`/`moon.json` roots array. | Aggregate all ONLINE nodes' endpoints into `moon.json.roots[]` before invoking `mkmoonworld`, and persist `lastUnifiedBuildAt` truthfully. |
| M3 | **Cluster node health is simulated.** `syncClusterNodes` marks remote nodes `ONLINE` without any probe/health check (`clusterService.ts:109-116`). | HA status reporting is fictitious; a dead node is still "ONLINE". | Implement real health checks (TCP connect to node `ip:port` or HTTP ping) with configurable timeouts and status transitions. |
| M4 | **Planet "validate signature" is fake.** `validatePlanet` returns `checksum: 'VALID_SIGNATURE'` unconditionally (`planetService.ts:150-157`). | No cryptographic verification of the signed root binary; validation UI result is meaningless. | Verify using ZeroTier's world-file signature structures or at minimum an integrity hash + freshness check. |
| M5 | **Identity/certificate status is fabricated.** `getIdentityStatus` hardcodes `certificateStatus: 'VALID'` and `keyStrength: '2048-bit ECC / Ed25519'` (`identityService.ts:24-25`). | Misleading security telemetry. | Derive key strength from actual key material; perform real signature/cert verification. |
| M6 | **Planet delete is broken.** `deletePlanet` writes an empty file instead of removing it (`planetService.ts:133-140`). | Verified: after "delete", the planet file still exists (size 0) and `/planet/info` reports `ACTIVE`/`HEALTHY`. | Use `fs.unlink` and update status accordingly; handle the not-found case with a real 404. |
| M7 | **Cloudflare record auto-create uses the wrong API endpoint.** `createRecord` POSTs to `https://api.cloudflare.com/client/v4/zones` instead of `/zones/{zoneId}/dns_records` (`cloudflareProvider.ts:139`). | The "create new record" fallback path always fails; only pre-existing records can be updated. | Correct the URL and validate `zoneId`. |
| M8 | **Cross-node federation handshake endpoint uses the wrong port.** `getPeerTopology` builds `localEndpoint` from `planetInfo.port` (the ZeroTier port, e.g. 9994) rather than the engine's HTTP port (e.g. 3000) (`federationPeerService.ts:62-64`, `planetService.ts:33`). | Verified live: `responderEndpoint` returned `http://brg-dz.dreamzone.cc:9994`, so a peer's `joinFederation` POST would hit the ZeroTier UDP/TCP port, not the REST API. Distributed federation join is broken end-to-end. | Return the HTTP/API base URL for federation metadata (separate "control-plane" endpoint from ZeroTier "data-plane" port). |
| M9 | **Federation token secrets exposed in cleartext.** `GET /api/v1/federation/tokens` returns full `tokenSecret` for every token to any authenticated user; token creation also echoes it. | Combined with C1, any low-privilege user can harvest all inter-node credentials. | Mask secrets after creation (return once), store hashed, and expose secrets only to ADMIN on demand. |
| M10 | **Topology poisoning / unbounded peer registry via public handshake.** Any peer presenting a valid token can register arbitrary `nodeId`/`endpoint` values (`federationPeerService.ts:95-152`); no deduplication by endpoint, no validation, no cap. | Attacker with a token can pollute topology, grow `federation_peers.json` without limit, and misdirect peers. | Validate/authorize node identity (tie `sourceNodeId` to token), cap peer count, dedupe, rate-limit handshakes, and require signed claims. |
| M11 | **Stale compiled artifact shipped in-tree.** At audit start `dist_engine` was out of sync with `src` (health returned `0.1.2` vs src `1.2.0`; planet version `0.1.2` vs `2.0.5`). `deploy.sh` builds before running, but anyone running `node dist_engine/...` directly gets old behavior. | Version drift between source and deployed artifact. | Treat `dist_engine` as a build output (gitignore + build in CI), add a build-time version stamp, and add a smoke test that asserts version consistency. |
| M12 | **Frontend cannot produce a deployable production build.** `vite.config.ts` uses `adapter-auto`, which detects no platform; `npm run build` exits 0 but emits no `build/` artifact. `deploy.sh` runs `vite dev` (a dev server) in production. `svelte.config.js` is absent. | Verified: `build/` not produced; `svelte-check` fails with 2 TS errors (`+page.svelte:499,522`). | Add `svelte.config.js` with a concrete adapter (`@sveltejs/adapter-node` or `adapter-static`), fix the two type errors, serve the built app, and run `npm run preview`/static server in production. |
| M13 | **No TLS/HTTPS anywhere.** Engine, file server, and console all serve plain HTTP; auth tokens and Cloudflare tokens transit in cleartext. | Credential disclosure on any untrusted network. | Terminate TLS behind a reverse proxy (Caddy/nginx/Traefik); enforce HTTPS redirect + HSTS; document the deployment pattern. |
| M14 | **Concurrency / race conditions on JSON stores.** All persistence is read-modify-write without locking (`userService`, `federationTokenService`, `federationPeerService`, etc.); the two 5-minute workers (DDNS and Cloudflare) can concurrently rewrite `moon.json` and rebuild the planet. | Lost updates, torn writes, and inconsistent state under concurrent requests/workers. | Use a small write queue / atomic rename (`write temp + rename`) and serialize worker jobs (mutex or single-writer). |
| M15 | **Moon generation picks the first `.moon` file found.** `createMoon` uses `files.find(f => f.endsWith('.moon'))` in `ztVar` (`moonService.ts:79-81`). | If multiple `.moon` files accumulate, the wrong binary may be copied/deployed. | Derive the generated filename from the world ID in `moon.json` and glob deterministically; clean stale files. |
| M16 | **Backups are not encrypted** despite the UI claiming "full encrypted archives" (`+page.svelte:1618`); export is a plain `tar.gz`; restore is not exposed in the UI. | Advertised feature/behavior mismatch; plaintext secrets in backup. | Implement real encryption (age/GPG/AES), document key management, add restore UI. |
| M17 | **Moon migration is a re-point, not an authority transfer.** `migrateMoon` just re-generates the same identity-bound moon with the target endpoint; no handover of signing authority, no removal of the original, and `previousPlanetId` is never populated (`moonMigrationService.ts:18-44`). | "Cross-planet Moon migration" claim is overstated; result is misleading. | Clarify semantics or implement actual authority transfer with the target node's identity/keys. |

### LOW

| # | Finding | Remediation |
|---|---------|-------------|
| L1 | **OpenAPI spec grossly incomplete** — documents ~15 of ~50 endpoints; `API-DOCUMENTATION.md` is minimal; both are in Arabic only. | Generate specs from code (e.g., `tsoa`/`express-openapi`), cover all routes, localize. |
| L2 | **`/api/docs` and `docs/` are not synced with implementation** (missing auth, cloudflare, cluster, federation, identity, backup, planet validate/templates/delete, moon migrate/rebind/rebuild). | CI check that documented routes exist and vice versa. |
| L3 | **Malformed JSON bodies return HTTP 500** instead of 400 (body-parser errors land in the generic error middleware). | Add a dedicated 400 handler for `body-parser` errors. |
| L4 | **CORS fully open** (`cors()` with no options, `app.ts:24`). | Restrict to the console origin + allowed federation peers. |
| L5 | **Broad public-download bypass** (`req.path.endsWith('/download')`). | Use an explicit allowlist of public paths. |
| L6 | **GET handlers have write side effects** (`listTokens` auto-mutates store, `getPeerTopology` writes defaults, `planet/download` writes placeholder). | Move mutations to POST/PUT flows or mark them clearly. |
| L7 | **`start_all.sh` hardcodes `/home/ggonlinux/zt/docker-zerotier-planet-2.0.5`** — path does not match this repository. | Derive from script location or config. |
| L8 | **`build.sh`/Dockerfile inherited from upstream `xubiaolin/zerotier-planet`** — builds ztncui and ZeroTier but does **not** include or serve the ZGALAXY web-console; entrypoint launches ztncui on :3443. | Align Docker build with the ZGALAXY architecture; include and serve the built console. |
| L9 | **No structured logging / log rotation / audit trail**; `engine.log`/`frontend.log` are raw nohup redirects; secrets can be logged. | Adopt `pino`/`winston` with rotation and a security event log; redact secrets. |
| L10 | **`package-lock.json` files are gitignored** — non-reproducible builds. | Commit lockfiles; pin deps. |
| L11 | **`svelte-check` fails** with 2 TypeScript errors in `+page.svelte` (`customHeader` union type). | Fix the type errors; add `check` to CI. |
| L12 | **DDNS/cloudflare IP detection depends on third-party `icanhazip.com`** with no fallback and no retry; `ipv6.icanhazip.com` can return an IPv4 if the host lacks v6. | Support multiple public-IP providers with failover; validate address family. |
| L13 | **Version data is hardcoded** (`/health` 1.2.0, planet `2.0.5`) and drifted historically (0.1.2). | Single source of truth for versions, injected at build time. |
| L14 | **No graceful shutdown, no readiness semantics** (`/health` always `ok` regardless of ZeroTier state), no process supervision (pm2/systemd) in the deploy script. | Add SIGTERM cleanup, readiness checks that reflect real services, and a systemd/pm2 unit. |

---

## 3. Data Flow & Integration Audit

### 3.1 Verified Working Flows (confirmed by live/sandbox tests)
- **Auth flow:** login → session token → Bearer middleware → route (token-only; role NOT enforced).
- **Planet build:** CLI `zerotier-idtool genmoon` + `mkmoonworld-x86_64` produce `world.bin` → copied to `dist/planet`; endpoints recorded to `moon.json` and `config/ip_addr4/6`, `domain`. Works with real binaries; graceful placeholder fallback exists when CLI fails (but reports success misleadingly).
- **Moon create/list/download/delete:** `initmoon`/`genmoon` produce a `.moon` copied to `dist/`; list reflects `dist/`; download works (public); delete works (but vulnerable to traversal, H2).
- **Federation handshake:** incoming handshake validates token secret (expiry/maxUses/revocation enforced), registers peer, and applies isolation policy (0 peers shared in `DIRECT_ISOLATED`). Verified.
- **DDNS & Cloudflare workers:** both run every 5 minutes from `server.ts`, resolve IPs, and trigger planet rebuild on change. Cloudflare provider correctly implements token verify/getZones/getRecords/updateRecord. (Not executed against live CF to avoid side effects on the real account.)
- **User lifecycle:** create/list/delete persist to `users.json`; hashes use PBKDF2.
- **Swagger UI** loads (`/api/docs` 200).

### 3.2 Broken / Non-functional Integration Points
- **Federation join round-trip is broken** (M8): returned peer endpoint uses the ZeroTier port, so the outbound handshake hits the wrong service.
- **Mesh propagation is a stub** (M1): no cross-node data movement despite "seamless 100+ node propagation".
- **Unified multi-root planet** (M2): not aggregated; single-root output.
- **Cloudflare auto-create record** (M7): wrong REST endpoint.
- **Planet delete/validate, identity status** (M4/M5/M6): non-functional/misleading.
- **Frontend production build** (M12): no deployable artifact; dev server used in "deployment".
- **Docker/deploy tooling** (L7/L8): inherited from an upstream project; does not package the console; `start_all.sh` points at a nonexistent path.

### 3.3 Security Architecture Assessment
- Authentication: Bearer secret key (superuser) OR session token. Secret-key bypass default is exploitable (C2). Sessions: no expiry/revocation (H4).
- Authorization: **none** — every role can perform every action (C1). All "Admin only" comments are aspirational.
- Transport: cleartext HTTP (M13).
- Secrets at rest: plaintext JSON (C4/C5); token mask not applied.
- Injection surface: SSRF (H1), path traversal (H2), command injection (H3), topology poisoning (M10).
- Key management: no rotation policy beyond a `rotateCertificates` that regenerates identity without coordinating with peers.

### 3.4 Synchronization & Worker Analysis
- Two 5-minute intervals registered in `server.ts:14-35` (DDNS + Cloudflare), both can trigger `PlanetService.buildPlanet`, which writes `moon.json` and rebuilds — potential concurrent write conflicts (M14).
- No locking, no debounce, no single-flight guard; a long build could overlap with the next tick.

### 3.5 Database / Persistence (JSON-file stores)
- Files: `users.json`, `sessions.json`, `federation_tokens.json`, `federation_peers.json`, `planet_cluster.json`, `cloudflare_config.json`, `cloudflare_logs.json`, `ddns_config.json`, `domains.json`, plus `ip_addr4/6`, `domain`, `local_node_id.json`.
- Pros: zero external DB dependency, path-configurable, atomic-friendly writes are possible.
- Cons: no transactions/locking, no schema validation, secrets in cleartext, unbounded growth (sessions, peers, logs are capped at 100 for CF logs but not others).

---

## 4. Functional Specifications Compliance

| Advertised Feature (README/UI) | Status | Verdict |
|--------------------------------|--------|---------|
| 100% independence from central controllers / zero lock-in | Partially — external `icanhazip.com` dependency for WAN IP (L12); otherwise self-contained | ⚠️ Partial |
| Scoped Federation Token engine (lifecycle, scopes, expiry, metrics) | Implemented and enforced in handshake | ✅ Works |
| Dual-mode sync (INHERITED vs ISOLATED, zero leakage) | Isolation logic correct at handshake boundary; propagation stub (M1) | ⚠️ Partial |
| Transitive mesh discovery across 100+ nodes | Not implemented — `propagateMeshTopology` is a stub (M1) | ❌ Not implemented |
| Multi-Planet Cluster HA / unified multi-root file / 99.999% uptime | Single-root only (M2); health simulated (M3) | ❌ Not implemented |
| Moon migration & re-binding | Re-binding works; migration is a re-point, no authority transfer (M17) | ⚠️ Partial |
| Signed-root compilation (`world.bin`, `.moon`) | Binary generation works with real `idtool`; signature **validation** is fake (M4) | ⚠️ Partial |
| Cloudflare DNS v4 auto-sync + token validation + audit logs | Mostly implemented; record **creation** broken (M7) | ⚠️ Partial |
| DDNS auto-sync (5-min worker, auto rebuild) | Implemented | ✅ Works |
| Obsidian & Gold TUI (zero-icon, custom dialogs) | Implemented in SvelteKit console | ✅ Works |
| Encrypted backup archives | Not encrypted (M16) | ❌ Not implemented |
| Member/role management | Roles exist but **not enforced** (C1) | ❌ Not implemented |

---

## 5. Recommendations — Priority Roadmap

**Immediate (block production):**
1. Implement RBAC middleware and enforce on all routes; fix the `auth.router` admin-only endpoints (C1).
2. Remove hardcoded/default secrets and default admin credentials; enforce strong `SECRET_KEY` (C2/C3).
3. Rotate/remove the exposed Cloudflare token and all leaked session tokens; encrypt secrets at rest; mask `apiToken` in API responses (C4/C5).
4. Harden `federation/join` (SSRF), moon path traversal, and backup import (H1–H3).
5. Add session expiry/revocation and login rate limiting (H4/H5).

**Short-term (next release):**
6. Implement real mesh propagation, multi-root HA compilation, and cluster health checks (M1–M3).
7. Fix planet delete/validate, identity verification, Cloudflare create-record (M4–M7).
8. Fix federation endpoint port (M8), token secret exposure (M9), handshake abuse (M10).
9. Ship a buildable frontend (adapter, fix TS errors) and CI (build + `svelte-check` + smoke tests) (M12, L11).
10. Add TLS termination and a hardened Docker/deploy pipeline aligned with ZGALAXY (M13, L7/L8).

**Long-term:**
11. Replace JSON stores with SQLite (transactional, WAL, integrity), add schema/validation (M14).
12. Add automated tests (unit + integration + security regression), structured logging, observability, graceful shutdown, process supervision (L9, L14).
13. Complete and localize API documentation; enforce spec-vs-implementation checks (L1/L2).
14. Implement real backup encryption and documented key management (M16).

---

## 6. Audit Notes & Environment State
- Audit ran in the working tree at `/home/ggonlinux/zt/zgalaxy` (not a git repository).
- `dist_engine` was rebuilt during the audit (`npx tsc`) to match `src` (it was stale at audit start — see M11). All compiled output now reflects `src`.
- Test artifacts were removed; `config/users.json` was restored to the original `admin` account and `config/sessions.json` to the 31 original sessions; no test federation tokens/peers remain; no engine processes or test ports are left running.
- The live `config/cloudflare_config.json` still contains the exposed Cloudflare API token — **rotate it immediately** (a copy of its value was observed; the audit did not call Cloudflare's API).
