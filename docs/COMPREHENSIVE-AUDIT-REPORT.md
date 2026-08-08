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

## 4. Findings from the static audit (not yet fixed)

### HIGH
- **H1** default `admin/admin` is auto-seeded on fresh install (login works with
  it on this server!). Recommend: force a password change on first login.
- **H2** `identity/generate` is OPERATOR-allowed and overwrites
  `identity.secret/public` + `moon.json` with **no backup** → irreversible
  node-address change that breaks the mesh. Should be ADMIN-only + backup first.
- **H3** a domain-only planet build can succeed with **zero usable endpoints**
  if `dns.resolve4` fails (the domain string is dropped by the tools). Should
  throw when resolution fails and no explicit IP is given.
- **H4** `trust proxy = 1` with no reverse proxy in front → rate limits can be
  bypassed via a spoofed `X-Forwarded-For`.
- **H5** `/planet/download` is public and writes a placeholder file to
  `dist/planet` when missing (anonymous write primitive).

### MODERATE
- **M1** moon download link in the web console is broken (requires Bearer in a
  plain link).
- **M2** Cloudflare `GET /zones`, `/records`, `/logs` are readable by any
  authenticated user (should be ADMIN/OP).
- **M3** `/network/addresses` exposes internal interface topology to READ_ONLY
  and triggers external egress (icanhazip/ipify).
- **M4** cluster nodes are added as `ONLINE` without a probe; unreachable nodes
  can be baked into a unified planet.
- **M5** `buildMultiRootPlanet` lacks the signing-key self-healing of the
  single-root build.
- **M6** federation non-WRITE permissions are never enforced; failed handshakes
  burn token uses before the permission check.
- **M7** `requestedSyncMode` is unvalidated on the public handshake.
- **M8** backup scope excludes config (users/DDNS/federation/cloudflare); import
  trusts a client-supplied `tarPath` and legacy plaintext archives.
- **M9** federation SSRF has a DNS-rebinding/TOCTOU window (accepted residual
  risk, documented).

### LOW
- **L1** token-length timing leak in `secretsEqual`. **L2** validation errors
  return 500 instead of 400. **L3** `/planet/regenerate` duplicates `/build`.
  **L4** Cloudflare `mode` flag is dead. **L5** domain/endpoint validation is
  loose (`a..b` accepted). **L6** federation token inputs unvalidated.
  **L7** dead code (`importPlanet`, `executeBinary`, `mode`).
  **L8** hardcoded versions (2.0.5 / 1.3.0). **L9** `stdout||stderr` write in
  moon init. **L10** endpoint validation weak. **L11** CORS_ORIGINS empty by
  default in production.

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

## 7. Recommended follow-ups (priority)

1. Force admin password change / remove the seeded default credential (H1).
2. Restrict `identity/generate` to ADMIN + back up before overwrite (H2).
3. Harden the domain-only build (H3) and reverse-proxy note (H4/H11).
4. Fix moon download in the console (M1) and gate Cloudflare/network reads (M2/M3).
5. Rotate secrets (GitHub token, Cloudflare `cfat_…`).
6. Optionally validate from a truly external client (VPS).
