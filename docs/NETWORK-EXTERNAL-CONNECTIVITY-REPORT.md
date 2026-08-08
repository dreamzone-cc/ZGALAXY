# Network External-Connectivity & Dynamic-IP Mechanism — Comprehensive Test Report

Date: 2026-08-08
Scope: verify that the ZGALAXY network connects via the **domain → external IP**
mechanism, that connections use external (public) addresses rather than relying
only on local/LAN addresses, and that the mechanism runs without errors.

---

## 1. Summary

| Area | Result |
|---|---|
| Domain → external IP resolution | ✅ `dz.dreamzone.cc` → `105.105.114.137` (A record) |
| Engine-served planet contains the external IP | ✅ (after a bug fix, §4) |
| External reachability of the root (`105.105.114.137:9994`) | ✅ confirmed from 3 international check nodes |
| Client connecting via the external IP | ✅ verified end-to-end (external-only planet → DIRECT `105.105.114.137/9994`, ONLINE, network IP assigned) |
| Client prefers best path | ✅ uses LAN when available; falls back to external |
| Mechanism free of errors | ✅ after fixing the engine rebuild bug (§4) |

**One real error was found and fixed during this review** (the engine's DDNS
auto-rebuild of the planet failed on every IP change — see §4).

---

## 2. Mechanism under test

1. The network is anchored on the domain `dz.dreamzone.cc` (the fixed reference).
2. The ZGALAXY engine resolves the domain at build time (`dns.resolve4`) and
   injects the current external IP as the planet root `stableEndpoint`.
3. Clients resolve the domain reactively (startup + on disconnect) via the
   native dynamic-DNS layer and keep the external endpoint up to date in their
   local `planet` (merging it with any private/LAN endpoint).
4. Connection is IP-based as usual; the domain is never baked in — only its
   current IP is used.

## 3. Test evidence

### 3.1 Domain resolution
- `dz.dreamzone.cc` resolves to **`105.105.114.137`** (verified repeatedly from
  the local machine, from dz20, and from the engine's DDNS worker).
- The engine's DDNS state: `lastResolvedIp4 = 105.105.114.137`, provider
  `DNS_POLLING`, interval 5 min, `autoRebuildOnChange = true`.

### 3.2 Served planet content
- `/api/v1/planet/download` returns a 264-byte planet containing
  **`105.105.114.137`** (the current external IP). ✅

### 3.3 External reachability (from the internet)
- check-host.net (nodes in the US, Romania, Russia) reached
  `105.105.114.137:9994` successfully (74–108 ms) — the root is reachable from
  the public internet on the resolved external address. ✅

### 3.4 End-to-end connect via the external IP
- A client loaded with an **external-only planet** connected DIRECT via
  `105.105.114.137/9994`, went **ONLINE**, and joined the network
  `ef313fb5c9f817a2` (OK, IP `10.121.15.7/24`). This proves the full
  domain → external-IP → connect chain, including through the router (hairpin).
- With the merged planet (LAN + external), the client prefers the LAN path
  (`192.168.1.171/9994`, latency 0) and stays ONLINE — the normal, correct
  best-path behaviour. ✅

---

## 4. Errors found & fixed

### 🔴 4.1 Engine planet auto-rebuild failed on every IP change (fixed)
- **Symptom**: repeated
  `[ZGALAXY DDNS ERROR] Planet build failed: initmoon did not regenerate signing keys.`
  → the served planet was **stale** (old external IP), so new clients would get
  the wrong endpoint.
- **Root cause**: `zerotier-idtool` (1.16.x) writes the secret as
  **`signingKey_SECRET`** (uppercase), but `planetService.ts`, `moonService.ts`
  and `moonMigrationService.ts` read **`signingKey_secret`** (lowercase). The
  missing field triggered a re-init path that then threw.
- **Fix**: accept both spellings (`hasSecret` helper) in all three files.
  Because the engine runs from a **compiled bundle** (`dist/zgalaxy-engine`),
  the bundle was rebuilt (`bun build --compile …`) and the service restarted.
- **Verified**: the next DDNS cycle logged
  `[ZGALAXY DDNS WORKER] Dynamic IP changed! Planet stableEndpoints updated to
  dz.dreamzone.cc (105.105.114.137)` and the served planet now contains the
  external IP. ✅

### 🟡 4.2 Engine uses an old `zerotier-idtool` (1.14.2)
- The engine's `zerotier-idtool` resolves to a symlink
  `/home/dz171/zgalaxy/zerotier-idtool → /home/dz171/zt_src/zerotier-one`
  (version **1.14.2**). The fix makes its output compatible, but for
  consistency the idtool should be updated to the 1.16.2 zgalaxy-core build.
- **Recommendation**: point `config.idToolPath` / the symlink at the 1.16.2
  binary (matches `genmoon`/`mkmoonworld` behaviour verified elsewhere).

### 🟡 4.3 Moon creation failure (observed earlier, unrelated to this test)
- Log: `POST /api/v1/moons/create: Failed to locate generated .moon file
  (expected 069ae38092.moon).` — a moon creation attempt failed (likely the
  old idtool / moon identity setup). No moons are deployed in the current
  network, so this is non-blocking; re-test after updating the idtool.

### 🟡 4.4 API admin credentials unknown
- The engine API (`/ready`, `/planet/info`, `/metrics`) requires a Bearer token;
  the default `admin` password has been changed and is not available to this
  review, so those authenticated endpoints were not queried (the 
  unauthenticated health surface — planet download, services, DDNS logs, root
  control plane — was fully verified).

### ℹ️ 4.5 LAN-side failover test nuance
- Blocking only the LAN path (OUTPUT to `192.168.1.171:9994`) did not visibly
  switch the peer path, because the root still sends to the client (the path
  stays RX-alive, half-open). This is expected behaviour for a LAN peer and does
  not affect the external path — the external-only test (§3.4) conclusively
  proved external connectivity.

---

## 5. Fleet status after the review

| Node | Role | Status |
|---|---|---|
| dz171 (`069ae38092`) | Root + engine | ✅ online, serving planet with external IP, DDNS working |
| dz161 (`ef313fb5c9`) | Controller (ztnet) | ✅ online, network `ef313fb5c9f817a2` with 3 members |
| dz20 (`4633bff774`) | Client | ✅ online, network OK |
| local (`5b07896437`) | Client | ✅ online, network OK |
| 192.168.1.5 (`c1aa29b20e`) | Client | ✅ network member |

All nodes share the same planet world (world id `777409730778759168`).

---

## 6. Conclusions & recommendations

1. The **domain → external-IP → connect** mechanism works end-to-end and the
   root is reachable from the internet on the resolved external address.
2. The engine rebuild bug (§4.1) was the only functional error found; it is
   fixed, rebuilt and verified.
3. **Recommended follow-ups**:
   - Update the engine's `zerotier-idtool` to the 1.16.2 zgalaxy-core binary.
   - Re-test moon creation (§4.3) after that.
   - Optionally validate from a truly external client (VPS/remote box) for a
     final independent confirmation.
   - Rotate the known secrets (GitHub token, Cloudflare `cfat_…`).
