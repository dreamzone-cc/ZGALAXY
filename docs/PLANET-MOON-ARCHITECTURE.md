# ZGALAXY Platform — Planet & Moon Architecture (Deep Examination)

Status: analysis complete
Scope: how ZGALAXY creates and maintains planets and moons, and how the
`zgalaxy-core` client layer is (and should be) architecturally unified with it.

---

## 1. Objective

Verify the mechanism ZGALAXY uses to create **planets** and **moons**, confirm
that both go through a **single unified architecture**, and align the client-side
native dynamic-IP layer (zgalaxy-core) with that same architecture so the whole
system shares one model.

## 2. Key finding — one unified world pipeline

ZGALAXY does **not** treat planets and moons as different mechanisms. Both are
ZeroTier **World** objects produced by the same pipeline:

```
identity.public
      │  zerotier-idtool initmoon identity.public
      v
   moon.json   (world id + signingKey + signingKey_secret + roots[].stableEndpoints)
      │
      ├── zerotier-idtool genmoon moon.json   ──►  <id>.moon      (MOON)
      └── mkmoonworld moon.json               ──►  world.bin      (PLANET)
```

- A **planet** = `world.bin` (World `TYPE_PLANET`), served as `dist/planet`.
- A **moon** = `<id>.moon` (World `TYPE_MOON`), served from `dist/<id>.moon`.
- Both share the same `World` serialization and the same signing model
  (`updatesMustBeSignedBy` = the moon.json signing public key).

### Source map (engine)

| Concern | File | Notes |
|---|---|---|
| Planet build | `src/services/planetService.ts` | `buildPlanet`, `buildMultiRootPlanet`, `importPlanet`, `validatePlanet`, `getPlanetInfo` |
| Planet API | `src/engine/routes/planet.router.ts` | `GET /info`, `GET /download`, `POST /build`, `POST /regenerate`, `DELETE /`, `POST /validate` |
| Moon build | `src/services/moonService.ts` | `createMoon`, `updateMoon`, `rebuildMoon`, `deleteMoon`, `listMoons` |
| Moon API | `src/engine/routes/moon.router.ts` | `GET /`, `POST /create`, `PUT /:id`, `POST /:id/migrate`, `POST /:id/rebind`, `POST /:id/rebuild`, `GET /:id/download`, `DELETE /:id` |
| Moon migration | `src/services/moonMigrationService.ts` | re-points a moon to a target planet, preserving identity (signing keys), re-sign via genmoon |
| Server-side DDNS | `src/services/ddnsService.ts` | periodic polling (default 5 min) → auto-rebuild planet on IP change |
| Domain binding | `src/services/domainService.ts` | verify + record domain↔PLANET/MOON binding |

## 3. Dynamic-IP handling in the engine

- ZeroTier build tools (`genmoon`, `mkmoonworld`) are **IP-only**: they silently
  drop hostname endpoints. The engine therefore **resolves the domain itself** at
  build time (`dns.resolve4`) and injects the resulting IPs as `stableEndpoints`
  (`planetService.ts` → `resolvedIps`).
- Endpoint ordering is intentional: resolved public IPv4 first (current/dynamic),
  then explicit IPv4/IPv6, then the domain string (documentation only —
  dropped by the tools).
- `ddnsService.checkAndSyncDDNS()` polls the domain on a schedule
  (`checkIntervalMinutes`, default 5) and, on a change, calls
  `PlanetService.buildPlanet(...)` to regenerate the canonical planet with the
  new IPs. This is the **server-side, periodic** model.

## 4. Client-side native layer (zgalaxy-core) — the same architecture

The `zgalaxy-core` client implements the same model, natively:

- It loads the engine-generated **World** (`planet` file) — identical object
  model and signing semantics.
- Its dynamic-IP layer treats the **domain as the fixed reference** and IPs as
  dynamic data — the exact same principle as the engine:
  - startup → resolve the domain once and use the current IP;
  - stable → **no** resolution (no polling);
  - disconnect → re-resolve and merge the new IP(s) into the planet's root
    endpoints **in place** (preserving the world id/timestamp/signature), then
    re-link gracefully (peer reset, no restart).
- Implementation: `World::setRootStableEndpoints`,
  `Topology::setPlanetEndpoints`, `Peer::hasAlivePath`,
  `Topology/Node::isPlanetReachable`, and the reactive resolver thread +
  periodic-free loop in `service/OneService.cpp`.

### Unification matrix (engine ↔ client)

| Aspect | Engine | Client (zgalaxy-core) | Unified? |
|---|---|---|---|
| World model | `moon.json` → World (planet/moon) | loads World from `planet` file | ✅ same object model |
| Signing | signs with moon.json key | never re-signs; updates endpoints in place (local-only, signature preserved) | ✅ consistent |
| Domain = reference | `dns.resolve4(domain)` at build | `getaddrinfo(domain)` at startup/on-disconnect | ✅ same principle |
| IP injection | injects resolved IPs as stableEndpoints | merges resolved IPs into root stableEndpoints | ✅ |
| Update cadence | server-side periodic (5 min) | client-side reactive (only on disconnect) | ✅ complementary by design |
| Multiple A records | injects **all** resolved A records | resolves + merges **all** resolved A records | ✅ unified |
| Moons | full moon pipeline (create/update/migrate) | planet-only dynamic layer (moons load via `orbit`/moons.d) | ⚠️ gap (see §5) |
| Endpoint order | resolved public first, then explicit | LAN endpoints kept first, then resolved | 🟡 acceptable (per-client best path) |

## 5. Identified gaps & recommendations

### 5.1 Client now resolves ALL A records (multi-A) — ✅ resolved
The client's `_resolveDomainIPv4s` (in `service/OneService.cpp`) now resolves
and merges **every** A record, exactly mirroring the engine's `buildPlanet`
which injects all resolved records. Combined with the in-place endpoint merge
(LAN endpoints preserved + resolved public IPs), this gives a multi-homed root
full redundancy. Verified live (the domain IP changed twice during testing; the
client self-healed each time without restart or external scripts).

### 5.2 Client moon support (future)
Moons share the same IP-only constraint. A fully unified architecture would let
the client's reactive layer also resolve moon root endpoints by domain
(extend `isPlanetReachable`/resolver to iterate `_moons` as well). This mirrors
the engine's unified moon.json pipeline. Recommended as a follow-up, not a
prerequisite — planets are the primary surface today.

### 5.3 Optional planet-download fallback
The engine exposes `GET /api/v1/planet/download` (the canonical, freshly
rebuilt planet). The client's DNS-based resolution already covers the dynamic-IP
case without it. A client fallback to that endpoint (when DNS is down but the
engine is reachable via a known address) would add resilience — optional.

## 6. Conclusion

The engine and the client already share one architecture: **a domain is the
fixed reference; IPs are dynamic data injected into a signed World**. The
engine rebuilds the canonical planet periodically (for new/joining clients); the
client's native layer self-heals existing clients reactively on disconnect. The
remaining unification items are the small multi-A alignment (recommended now)
and moons-on-the-client (follow-up).
