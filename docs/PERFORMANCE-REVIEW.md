# ZGALAXY — Performance-First Architectural & Technical Review

**Date:** 2026-08-04
**Scope:** Full-stack review (engine, services, networking, crypto, storage, workers, frontend, deployment) with **performance as the primary objective**, tailored to the project's purpose as a **high-performance gaming overlay network**.

---

## 0. Executive Summary

ZGALAXY is a **control-plane** (management) system for a ZeroTier-based gaming overlay. It does **not** forward game traffic — the actual data plane is the `zerotier-one` daemon. Therefore:

- **In-game latency/throughput** is dominated by `zerotier-one`'s packet path and by the **quality of the planet/moon/root configuration this engine produces** (endpoint ordering, moon placement, multi-root HA, multipath settings).
- **The engine's own performance** matters for management-plane latency: API responsiveness, worker cycles, storage I/O, and federation/DDNS/Cloudflare background work.

Measured hot-path costs (Bun 1.3, this host):
| Operation | Measured | Notes |
|---|---|---|
| Session validation (read+parse `sessions.json`, 182 B) | **~0.01 ms** | Fine now; grows linearly with session count & cold-cache |
| Atomic config write + fsync | **~0.02 ms** | Negligible |
| Subprocess spawn (`execFile`) | **~1 ms** | CLI work itself takes seconds |
| PBKDF2-SHA512 @210k (login) | **~90 ms** | Async (threadpool), rate-limited 20/15min → not a hot path |

**Verdict:** at current scale the engine is fast and its hot path is cheap. The risks are **architectural**, not micro-bottlenecks: single-process/single-writer JSON stores, per-request disk reads, sequential federation propagation, full-memory backup, and control-plane scaling. The single highest-ROI change is **SQLite-by-default + in-memory session cache**, which removes per-request disk I/O and makes the control plane horizontally scalable.

---

## 1. Architecture & Complete Data Flow

### 1.1 Two planes
```
DATA PLANE (game traffic)            CONTROL PLANE (this engine)
┌─────────────────────────┐          ┌───────────────────────────────┐
│ zerotier-one (daemon)    │          │ Express/Bun HTTP API (3000)   │
│  · UDP 9994 packet path  │ ←──config│  · auth/RBAC middleware       │
│  · NAT traversal, mesh   │ (planet/ │  · 59 routes                  │
│  · multipath, MTU        │  moon/   │  · JSON/SQLite stores         │
└─────────────────────────┘  moons)   │  · DDNS + Cloudflare workers  │
                                      │  · federation mesh (HTTP)     │
                                      │  · CLI: idtool/mkmoonworld    │
                                      └───────────────────────────────┘
                                              ▲
                                    Web Console (5173) — management UI
```

### 1.2 Request path (management plane)
`HTTP → CORS/headers → express.json (100kb) → global rate limiter → route limiter → auth middleware → validateToken() → route handler → service → FileManager (atomic write) or SQLite → JSON response`

The auth middleware runs on **every authenticated request** and calls `UserService.validateToken`, which (JSON mode) reads `sessions.json` from disk, parses it, and prunes expired entries (potentially writing back). This is the per-request I/O cost.

### 1.3 Background flows
- **DDNS worker** (5 min): DNS resolve4/6 → on change → `PlanetService.buildPlanet` (subprocess pipeline) → atomic writes.
- **Cloudflare worker** (5 min): get config → public-IP detection (external HTTP) → optional CF API → optional planet rebuild.
- **Federation**: HTTP handshake between nodes; propagation fan-out to transitive peers.
- **Cluster**: periodic health probes (`HTTP GET /api/v1/health` per remote node).

---

## 2. Bottleneck Inventory (prioritized by performance impact)

| # | Area | Issue | Latency | Throughput | CPU | Memory | Scalability | Priority |
|---|------|-------|:---:|:---:|:---:|:---:|:---:|:---:|
| B1 | Storage/Auth | Per-request `sessions.json` disk read + JSON parse in auth middleware | +0.01ms→+Xms | ⬇️ | ⬇️ | ⬆️ | **Blocked** | 🔴 HIGH |
| B2 | Storage | JSON single-writer stores; no cross-process scale; lost-update risk (only per-path queue) | +fsync each write | ⬇️ | — | — | **Blocked** | 🔴 HIGH |
| B3 | Networking | Federation propagation **sequential** O(N) with retries; one dead peer stalls the fan-out | +10s×retries per peer | ⬇️ | — | — | ⬆️ | 🔴 HIGH |
| B4 | Networking | Dashboard `autoDetectAddresses` blocks load on external-IP fetch (3 providers × 4s failover) | +0.4–4 s | ⬇️ | — | — | — | 🟠 MED |
| B5 | Async/CLI | Planet/Moon build is a multi-subprocess pipeline (serialized by mutex); all builders queue on one lock | +seconds; queueing | ⬇️ | ⬆️ | — | ⬇️ | 🟠 MED |
| B6 | Memory | Backup buffers the **entire** data dir in memory for AES-GCM | — | — | ⬆️ | ⬆️ (GBs possible) | ⬇️ | 🟠 MED |
| B7 | Crypto | PBKDF2 210k on every login (~90ms, threadpool) — not hot path, but threadpool contention under burst logins | +90ms login | ⬇️ at burst | ⬆️ | — | ⬇️ at burst | 🟡 LOW |
| B8 | Memory | Frontend single-page monolith; every API response JSON-serialized into a 50-entry log panel | render cost | ⬇️ | ⬆️ | ⬆️ | — | 🟡 LOW |
| B9 | Networking | Rate-limiter key store is in-memory per-instance (no shared store across replicas) | — | — | — | ⬆️ | ⬇️ | 🟡 LOW |
| B10 | Storage | Sessions/peers unbounded growth: no sweep in JSON; SQLite table grows until per-token access | — | ⬇️ over time | — | ⬆️ | ⬇️ | 🟡 LOW |

---

## 3. Root-Cause Analysis

### B1 — per-request session I/O (ROOT CAUSE: storage architecture)
Every authenticated call re-reads `sessions.json` (`userService.getSessions` → `fs.readFile` + `JSON.parse`) and calls `pruneExpiredSessions` which may **write** the file. Measured 0.01 ms for a 182 B file with a hot OS cache; under high RPS, thousands of concurrent `readFile` calls serialize on the disk and, on a cold cache/network FS, page faults push each to 0.5–5 ms. **Impact scales linearly with session count and request rate.** The SQLite path exists (`USE_SQLITE=1`) but is **opt-in** and still does a DB query per request without an in-memory layer.

### B2 — JSON single-writer stores (ROOT CAUSE: chosen persistence model)
Users, sessions, federation tokens, peers, cluster topology, DDNS/CF configs are all single-document JSON files. Atomic rename + per-path queue prevent torn/lost writes within one process but:
- no read-your-own-writes cross-process safety,
- cannot be shared horizontally,
- every mutation is a full-document rewrite (O(file size)).

### B3 — sequential federation fan-out (ROOT CAUSE: conservative anti-SSRF design)
`propagateMeshTopology` walks `inheritedPeers` in a `for` loop with up to 2 retries and a 10 s timeout each. With P dead peers, worst-case propagation time ≈ P × (retries × 10 s). The SSRF guard + 10 s timeout were added for safety but paid for in propagation latency.

### B4 — blocking dashboard (ROOT CAUSE: eager external lookup on login)
`autoDetectAddresses` calls `NetworkService.getNetworkAddresses()`, which now races 2 provider groups (failover, 4 s timeouts). On an unreachable/internet-filtered host this delays the post-login dashboard by seconds even though addresses are non-critical for most actions.

### B5 — serialized build pipeline (ROOT CAUSE: correct-but-coarse mutex)
One `buildMutex` serializes planet build, multi-root build, moon create/rebuild/migrate, plus DDNS/CF auto-rebuilds. Correctness (no moon.json races) is guaranteed, but concurrent management actions queue behind a seconds-long pipeline.

### B6 — backup buffering (ROOT CAUSE: simplicity)
`exportBackup` reads the whole tar into a Buffer, then encrypts into another Buffer. A large `ztvar` (identity, world files, moons) can be hundreds of MB → transient memory spike.

### B7 — PBKDF2 (ROOT CAUSE: security standard)
210k iterations ≈ 90 ms of threadpool time per login. `crypto.pbkdf2` is async (doesn't block the event loop) but each attempt occupies a libuv thread. Rate limit (20/15 min) prevents abuse; burst logins could starve the 4-thread default pool briefly.

---

## 4. Networking Layer Analysis

| Aspect | Current | Perf assessment | Recommendation (performance-first) |
|---|---|---|---|
| API transport | HTTP/1.1, JSON, keep-alive | Fine for control plane; HTTP/2 not needed | Keep; enable `server.keepAliveTimeout` tuning |
| Connection setup | TLS terminated at reverse proxy (Caddy template); plaintext inside LAN | TLS adds ~1 RTT + CPU on new connections; acceptable for management | Keep proxy TLS; for **federation handshakes** on trusted networks keep HTTP (rare, latency-sensitive to drop RTT) |
| Session mgmt | Bearer token in `Authorization`; validated per request vs store | O(1) lookup but disk I/O (B1) | In-memory session cache (TTL+LRU) with store fallback |
| Reconnection | Federation peers re-handshake on `sync-now`; no automatic reconnection loop | Manual; mesh can go stale | Add bounded automatic re-probe with backoff |
| Concurrency | Express + Bun event loop; async everywhere; workers overlap-guarded | Good | Add `Promise.all` concurrency limit to propagation/probes (B3) |
| Packet processing | **Not handled here** — `zerotier-one` data plane | Out of scope for engine; engine sets config | Optimize config (below) |
| DNS | DDNS uses `dns.resolve4/6` per cycle | Cheap, 5-min cadence | Fine |

**Data-plane performance levers the engine controls (important for gaming):**
1. **`stableEndpoints` ordering** — ZeroTier tries endpoints in order. Today `planetService` orders `domain → ip4 → ip6`. For low-latency gaming, a **direct public IPv4 endpoint first** is usually the fastest path; domain adds a DNS resolution + possible CDN/proxy indirection. Recommend: allow explicit ordering, default `ip4 → ip6 → domain`.
2. **Moon placement/proximity** — moons reduce relay latency. Engine's `moonService` and HA templates already support this; document that moons should be regionally deployed near players.
3. **Multi-root planets** — `buildMultiRootPlanet` gives redundancy; ensure root count stays small (each root is probed/configured).
4. **Multipath** — ZeroTier multipath is a runtime daemon feature; the engine should expose a config knob to enable it for multi-WAN hosts (currently absent).

---

## 5. Crypto & Security Performance Review (ROI-based)

| Mechanism | Where | Measured/estimated cost | Hot path? | Verdict (performance-first) |
|---|---|---|---|---|
| PBKDF2-SHA512 210k | login | ~90 ms (threadpool) | No (rare, rate-limited) | **Keep.** Lowering to 50k (~20 ms) is possible but login is not in-game; ROI low. Consider argon2id only if login UX matters. |
| timingSafeEqual (secret key) | every request | ~µs | Yes | **Keep** — negligible |
| AES-256-GCM | backup | ~1–2 Gbps software; only memory issue (B6) | No (rare) | **Keep** strength; **stream** to avoid memory spike |
| TLS (proxy) | API | +~0.5–1 ms / new conn | Management only | **Keep at proxy**; not on the hot packet path |
| Federation bearer token over HTTP | handshake | +0 (plaintext) | No (rare) | **Accept for trusted networks**; document that federation should run inside the private network/VPN. Adding TLS costs 1 RTT per handshake — acceptable if threat model demands it. |
| Rate limiting (in-memory) | /login, /handshake, /join, global | ~µs, map entry per IP | Yes | **Keep**; negligible |
| CORS/security headers | all responses | ~µs | Yes | **Keep**; negligible |
| Dummy PBKDF2 on unknown user | failed login | +~90 ms (anti-enumeration) | No | **Keep** (cheap insurance; failed logins only) |
| Session token | every request | O(1) match after read | Yes | Move to cache (B1) |

**Security ops that can be simplified for performance:** per-request full-session-file read (B1), sequential federation probing (B3), and eager external-IP detection on the dashboard (B4) — all three add latency without adding security.

---

## 6. Scalability Assessment

| Dimension | Current | Limit | Fix |
|---|---|---|---|
| Control-plane instances | Single process (Bun) | 1 writer per JSON store; sessions file read per request | SQLite default + in-memory cache; stateless API for horizontal scale |
| Management users/sessions | Unbounded growth | Sessions file/table grows; 24 h TTL but no sweep | Periodic session GC sweep (SQLite `DELETE WHERE created_at < now()-TTL`) |
| Federation peers | Capped at 50 | Mesh state per node | Keep cap; parallelize propagation |
| Cluster nodes | Capped at 50 | Probes parallel now | Keep cap; probes already `Promise.all` |
| Concurrent HTTP | Bun event loop | High (thousands keep-alive) | Add `server.requestTimeout`; fine |
| Worker cycles | 2 × 5 min | Overlap-guarded | Fine |
| Frontend | 1 monolith page | Memory/render with large tables | Split panels; virtualize/paginate tables |

---

## 7. Optimization Roadmap (by Performance ROI)

**Phase A — remove per-request I/O (highest ROI, ~1 day)**
1. **SQLite by default** (`USE_SQLITE=1` default) with a **session in-memory cache** (LRU+TTL) checked before the DB; DB as source of truth.
2. Add a periodic **session sweep** (delete expired) so tables never grow unbounded.
3. Keep JSON mode as fallback for Node 18/20.

**Phase B — parallelize fan-out (~1 day)**
4. Federation propagation & cluster probes: `Promise.all` with a bounded concurrency pool (e.g. 10) instead of sequential; single-shot retries with exponential backoff.
5. Add automatic peer re-probe with backoff (reconnection strategy).

**Phase C — latency trims (~1–2 days)**
6. Dashboard: load `network/addresses` **lazily**/in background (don't block dashboard render); or cache external-IP for 60 s.
7. `stableEndpoints` ordering: `ip4 → ip6 → domain` by default; add explicit ordering option.
8. Add multipath enable knob + docs for gaming hosts.

**Phase D — memory & robustness (~1 day)**
9. Stream backup (pipe tar → cipher → file) to remove the full-memory buffer; keep AES-256-GCM.
10. Frontend: paginate/virtualize tables; truncate log entries to summaries.

**Phase E — scale readiness (~1–2 days)**
11. Config: expose request/keep-alive timeouts; document reverse-proxy TLS (already templated).
12. Optional: shared rate-limit store (Redis) only if multi-instance is adopted.

---

## 8. Current vs Expected Architecture

| Dimension | Current | After Phase A–E |
|---|---|---|
| Auth per request | Disk read + JSON.parse of sessions file | In-memory cache → SQLite (µs) |
| Storage | JSON files (opt-in SQLite) | **SQLite by default** + GC |
| Federation propagation | Sequential, up to 10 s/peer | Parallel, bounded concurrency, backoff |
| Dashboard load | Blocks on external IP fetch | Lazy/background + cached |
| Planet endpoints | domain-first ordering | IPv4-first, configurable |
| Backup | Full-memory buffer | Streamed, same cipher |
| Build pipeline | Single global mutex | Fine (correctness); optional per-type locks |
| Scale | Single instance, single writer | Stateless API + shared DB (SQLite/Postgres path) |

---

## 9. Additional Simplification & Overhead-Reduction Opportunities

1. **Collapse `/build` and `/regenerate`** into one endpoint (identical handlers) — less surface, fewer code paths to keep hot.
2. **Cache `getConfig()`** reads (DDNS/CF/domains) with an mtime check to avoid re-reading on every worker tick.
3. **Frontend**: move the 12 panel fetches behind a single `Promise.allSettled` (done) and drop per-response JSON logging (redact + truncate) to cut render cost.
4. **Remove dead code**: `importPlanet` (no route), `executeBinary`/`executeCommand` (no callers), legacy env vars (`FILE_SERVER_PORT`, `API_PORT`) — less code = less to audit and fewer failure modes.
5. **Federation**: consider `DIRECT_ISOLATED` (P2P only) as the gaming default to minimize mesh state, reserving `FEDERATION_INHERITED` for discovery bootstrap.
6. **ZeroTier daemon tuning** (data plane): document `moon` proximity, multipath, and MTU guidance in the runbook — the highest-impact "free" latency wins for the actual game traffic.

---

## 10. Conclusion

The control plane is **fast at current scale** (sub-ms hot path measured). The bottlenecks are **architectural** and only manifest at scale or under latency-sensitive flows. Applying Phase A (SQLite default + session cache) and Phase B (parallel fan-out) delivers the largest performance ROI with minimal risk. For the **gaming overlay itself**, the dominant levers are **config quality** (IPv4-first endpoints, regional moons, multi-root HA, multipath) and ZeroTier daemon tuning — which the engine should expose and document rather than implement in software.
