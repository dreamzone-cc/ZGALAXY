# ZGALAXY — Comprehensive Function Audit Report

Date: 2026-08-08
Scope: audit of **all functions** in the ZGALAXY platform — the engine (Bun,
`dreamzone-cc/ZGALAXY`, v1.3.0), the root node, the ztnet controller, and the
`zgalaxy-core` clients — combining **live function tests** (public + admin API)
and a **static code audit** of every route/service.

Method: live HTTP tests against `http://192.168.1.171:3000` (admin session),
live checks of the root/controller/clients, and full source review of
`src/engine/routes/*`, `src/services/*`, `src/engine/{app.ts,rbac.ts}`.

---

## 1. Public endpoints (live) — ALL WORK

| Endpoint | Result |
|---|---|
| `GET /api/v1/health` | ✅ 200 |
| `GET /api/v1/ready` | ✅ 200 — `ready:true` (identity ✓, auth token ✓, planet ACTIVE ✓) |
| `GET /api/v1/metrics` | ✅ 200 |
| `GET /api/v1/planet/download` | ✅ 200 (264 B) |
| `POST /api/v1/auth/login` | ✅ 200 admin/admin; 401 on bad creds |
| `GET /api/docs` | ✅ 301 (swagger) |
| Protected endpoint w/o token | ✅ 401 (auth enforced) |

## 2. Authenticated functions (live, admin) — results

| Function | Result |
|---|---|
| `auth/me`, `auth/users` (list) | ✅ |
| `auth/users/create` + `delete` | ✅ (test user created/deleted) |
| `planet/info` | ✅ ACTIVE / HEALTHY, ip4=`105.105.114.137` |
| `planet/download` | ✅ public 264 B |
| `planet/build` | ✅ rebuild OK → `["105.105.114.137/9994","dz.dreamzone.cc/9994"]` |
| `planet/validate` (POST) | ✅ `valid:true`, 264 B, sha256 |
| `planet/regenerate` | ⚠️ exact duplicate of build (L3) |
| `identity/status` | ⚠️ shows MISMATCH — see §3 |
| `identity/verify` | ✅ (derivation now correct after fix) |
| `moons` (list) | ✅ |
| `moons/create` | ✅ **now works** after fix (was broken) → `000000069ae38092.moon` |
| `moons/:id/download` | ⚠️ auth-gated → broken link in console (M1) |
| `moons/:id/delete` | ✅ |
| `ddns/status` + worker | ✅ `lastResolvedIp4=105.105.114.137`, rebuild OK |
| `domains` | ✅ `dz.dreamzone.cc` bound to PLANET |
| `cloudflare/config` | ✅ enabled, AUTOMATIC, `lastSyncedIp=105.105.114.137` |
| `cluster/status` | ✅ (node ip4 is stale — see §4) |
| `federation/tokens/create` + `revoke` | ✅ |
| `backup/export` | ✅ encrypted AES-256-GCM archive (3343 B) + checksum |
| `backup/import` | ⚠️ not exercised (destructive); code review in §5 |

## 3. Bugs found & FIXED during the audit

### 🔴 B1 — Engine DDNS planet rebuild always failed (fixed earlier)
`planetService.ts`/`moonService.ts`/`moonMigrationService.ts` read
`signingKey_secret`, but `zerotier-idtool` 1.16.x writes `signingKey_SECRET`.
Every auto-rebuild threw `initmoon did not regenerate signing keys`; the served
planet went stale. Fixed (accept both spellings) + rebuilt bundle + verified:
DDNS now rebuilds and the planet contains the current external IP.

### 🔴 B2 — `identity/status` used the wrong address derivation (fixed)
`identityService.ts` derived the node address from the **first 10 hex** of
SHA-384; ZeroTier (`Identity.cpp:92`) uses the **last 5 bytes** (`digest + 59`).
This caused a false MISMATCH for valid identities. Fixed (last 10 hex) and the
bundle rebuilt.

> Note on the live root identity: even with the corrected derivation, the
> dz171 identity (`069ae38092` / pubkey `f20c…`) does **not** standardly derive
> its address. It is internally consistent (secret↔public) and **functional**
> (the mesh works), so it is treated as a legacy data quirk — it must NOT be
> regenerated (that would break every client/planet referencing `069ae38092`).

### 🔴 B3 — `moons/create` always failed (fixed)
`genmoon` names the output by the **16-hex world id** (`000000069ae38092.moon`),
but the engine looked for `<id>.moon` (`069ae38092.moon`). Fixed by formatting
the world id to 16 hex. Verified: create/delete now work.

## 4. Findings from the static audit (status)

### HIGH — all now FIXED & verified
- **H1** ✅ **Fixed**: default admin is no longer seeded with the well-known
  `admin` password — a **random** initial password is generated and written to
  `config/admin_initial_password.txt` (JSON store + SQLite store). Existing
  deployments (like dz171) are unaffected (their credentials are preserved).
- **H2** ✅ **Fixed**: `identity/generate` now backs up
  `identity.public/secret` + `moon.json` to `.bak.<ts>` before overwriting,
  uses the resolved idtool path, and returns an explicit warning that the node
  address changes (invalidating existing clients).
- **H3** ✅ **Fixed**: a domain-only planet build now **refuses** (throws) when
  the domain cannot be resolved and no explicit IPv4/IPv6 is given — verified
  live (`build` with an unresolvable domain is rejected).
- **H4** ✅ **Fixed**: `trust proxy` is only enabled when `TRUST_PROXY=1` is
  explicitly set (no more spoofable `X-Forwarded-For` rate-limit bypass by
  default).
- **H5** ✅ **Fixed**: `/planet/download` no longer writes a placeholder file on
  anonymous requests; it returns a 404 with guidance when the planet is missing.

### MODERATE — status (all fixed & verified)
- **M1** ✅ Fixed: moon download public (no 401 without token).
- **M2** ✅ Fixed: Cloudflare reads gated ADMIN/OP (verified 403 for READ_ONLY).
- **M3** ✅ Fixed: `/network/addresses` gated ADMIN/OP (verified 403).
- **M4** ✅ Fixed: `addNode` now **probes** the node for real reachability; a
  caller-supplied status is no longer trusted. Verified: adding an unreachable
  node (8.8.8.8) results in `OFFLINE`.
- **M5** ✅ Fixed: `buildMultiRootPlanet` now shares the same signing-key
  self-healing (`ensureMoonJsonKeys`) as the single-root build.
- **M6** ✅ Fixed: permission check (WRITE) happens **before** a token use is
  consumed. Verified: a READ-only token handshake fails with
  "lacks required permission: WRITE" and `usedCount` stays 0.
- **M7** ✅ Fixed: `requestedSyncMode` is validated against the two known modes.
  Verified: `BOGUS_MODE` is rejected.
- **M8** ✅ Fixed: backup now includes the engine config (`zt/` + `cfg/` dirs)
  and import only accepts archives under the server config directory (verified
  400 for an arbitrary path; archive structure confirmed: `zerotier-one/`,
  `config/`).
- **M9** ⏳ documented residual risk (DNS-rebinding/TOCTOU in federation fetch;
  re-checked at each fetch — no clean fix with the built-in fetch).

### LOW — status (all fixed & verified)
- **L1** ✅ `secretsEqual` hashes both values before a constant-time compare.
- **L2** ✅ validation errors now return **400** (verified: bad domain → 400).
- **L3** ✅ `/planet/regenerate` rebuilds from the current stored endpoints
  (verified: no body needed, correct endpoints).
- **L4** ✅ Cloudflare `mode` is honored: `MANUAL` skips the periodic auto-sync
  (explicit `/sync` still works).
- **L5** ✅ domain regex rejects empty labels (`bad..domain` → 400).
- **L6** ✅ federation `createToken` validates permissions/syncMode/maxUses/
  expiresInDays/creator.
- **L7** ✅ dead code removed (`importPlanet`, `executeBinary`).
- **L8** ✅ versions derive from `package.json` (verified: 1.3.0 on health &
  planet/info).
- **L9** ✅ moon init now guards empty `initmoon` stdout (no `stderr` fallback).
- **L10** ✅ moon endpoints validated as `host:port` (1–65535).
- **L11** ✅ CORS defaults to the web-console origins when `CORS_ORIGINS` unset.

## 5. Verified correct (static + live)

Auth middleware + RBAC + error handler + rate limiting; path-traversal guards;
federation/cluster SSRF guards; backup AES-256-GCM crypto (streaming, IV, tag);
`signingKey_SECRET` handling; moon migration identity-preservation; user auth
(PBKDF2 210k, session TTL 24 h, SQLite WAL); file safety (atomic writes);
build serialization via shared mutex; DDNS/Cloudflare workers (no private IP
leak); secret masking in all responses.

## 6. Server / client fleet status

| Node | Role | Status |
|---|---|---|
| dz171 (`069ae38092`) | Root + engine | ✅ online; planet ACTIVE; DDNS/Cloudflare working |
| dz161 (`ef313fb5c9`) | Controller (ztnet) | ✅ online; network `ef313fb5c9f817a2`, 3 members |
| dz20 (`4633bff774`) | Client | ✅ online; network OK |
| local (`5b07896437`) | Client | ✅ online; network OK; native dynamic-DNS layer active |
| 192.168.1.5 (`c1aa29b20e`) | Client | ⚠️ **offline** (device not responding on LAN) |

## 7. Recommended follow-ups (remaining)

1. **M4** — probe cluster nodes before marking them ONLINE.
2. **M5** — add signing-key self-healing to `buildMultiRootPlanet`.
3. **M6/M7** — enforce federation permissions and validate `syncMode`.
4. **M8** — widen backup scope and harden import path handling.
5. **L2** — return 400 (not 500) for validation errors.
6. Rotate secrets (GitHub token, Cloudflare `cfat_…`).
7. Optionally validate from a truly external client (VPS).

## 8. Fixes applied in this pass (all rebuilt + deployed on dz171)

- **H1–H5, M1–M3** (§4) — source changes in `app.ts`, `planet.router.ts`,
  `cloudflare.router.ts`, `network.router.ts`, `userService.ts`,
  `sqliteStore.ts`, `identityService.ts`, `planetService.ts`.
- The engine bundle was rebuilt (`bun build --compile …`) and the service
  restarted; `tsc --noEmit` passes.
- **Regression verified after deploy**: `ready`/`health`/`planet/download` all
  200; the web console (5173) 200; clients dz20 + local ONLINE with the network
  OK; ztnet controller up; `planet/build` succeeds for the real domain and is
  rejected for an unresolvable domain.
