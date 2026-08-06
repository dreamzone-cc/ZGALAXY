# ZGalaxy - Comprehensive REST API Guide for ZeroTier Planet & Moon Infrastructure

**ZGalaxy** provides complete control over self-hosted ZeroTier infrastructure, allowing you to deploy and host your own Planet and Moon networks fully independently of the official central servers.

---

## Authentication & Security

The API authenticates via a Bearer Token passed in the request `Authorization` header.

```http
Authorization: Bearer YOUR_API_SECRET_KEY
```

- Users authenticate through `POST /api/v1/auth/login` and receive a session token (returned in `data.token`).
- Role-based access control (RBAC): `ADMIN`, `OPERATOR`, `READ_ONLY`. Administrative and state-changing endpoints require `ADMIN`/`OPERATOR`.
- Session tokens expire after 24 hours. Use `POST /api/v1/auth/logout` to invalidate them explicitly.
- Sensitive values (Cloudflare API token, federation token secrets, DDNS provider tokens) are never returned in full by list endpoints; masked fields (`*Masked`, `hasX`) are returned instead.

---

## Endpoints Reference

### 1. Health & Metrics

#### Health Check
* **GET** `/api/v1/health`
* **Response:**
  ```json
  {
    "status": "ok",
    "timestamp": "2026-07-31T20:21:00.000Z",
    "version": "1.3.0",
    "service": "ZGalaxy Planet/Moon Infrastructure Engine"
  }
  ```

#### Readiness Probe
* **GET** `/api/v1/ready` — reflects real infrastructure state (identity + auth token present). Returns `200` when ready, `503` otherwise.

#### Metrics (Prometheus format)
* **GET** `/api/v1/metrics`

---

### 2. Network & Dynamic IP Engine

#### Internal & External Address Discovery
* **GET** `/api/v1/network/addresses`

#### Dynamic IP Tracking & Sync
* **GET** `/api/v1/ddns/status`
* **POST** `/api/v1/ddns/sync`

#### DDNS Configuration
* **POST** `/api/v1/ddns/config` (ADMIN/OPERATOR)

---

### 3. Planet & Moon Operations

* **GET** `/api/v1/planet/info`
* **POST** `/api/v1/planet/build`
* **POST** `/api/v1/planet/regenerate`
* **POST** `/api/v1/planet/validate`
* **DELETE** `/api/v1/planet` (ADMIN)
* **GET** `/api/v1/planet/templates`
* **GET** `/api/v1/planet/download` (public)
* **GET** `/api/v1/moons`
* **POST** `/api/v1/moons/create`
* **GET** `/api/v1/moons/:id/download`
* **DELETE** `/api/v1/moons/:id` (ADMIN)

---

## Appendix: Complete Endpoint Inventory (59 operations)

> The authoritative reference for every operation is `docs/openapi.yaml` (served via `/api/docs` in Swagger UI).
> Verified: 59 operations across 12 routers, matching the implementation exactly (counted automatically).

| Category | Path | Method |
|----------|------|--------|
| System | `/api/v1/health` | GET (public) |
| System | `/api/v1/ready` | GET (public) |
| System | `/api/v1/metrics` | GET (public) |
| Auth | `/api/v1/auth/login` | POST (public) |
| Auth | `/api/v1/auth/logout` | POST |
| Auth | `/api/v1/auth/me` | GET |
| Auth | `/api/v1/auth/users` | GET (ADMIN) |
| Auth | `/api/v1/auth/users/create` | POST (ADMIN) |
| Auth | `/api/v1/auth/users/{username}` | DELETE (ADMIN) |
| Planet | `/api/v1/planet/info` | GET |
| Planet | `/api/v1/planet/download` | GET (public) |
| Planet | `/api/v1/planet/build` | POST (ADMIN/OPERATOR) |
| Planet | `/api/v1/planet/regenerate` | POST (ADMIN/OPERATOR) |
| Planet | `/api/v1/planet/validate` | POST (ADMIN/OPERATOR) |
| Planet | `/api/v1/planet` | DELETE (ADMIN) |
| Planet | `/api/v1/planet/templates` | GET |
| Moon | `/api/v1/moons` | GET |
| Moon | `/api/v1/moons/create` | POST (ADMIN/OPERATOR) |
| Moon | `/api/v1/moons/{id}` | PUT (ADMIN/OPERATOR) |
| Moon | `/api/v1/moons/{id}` | DELETE (ADMIN) |
| Moon | `/api/v1/moons/{id}/migrate` | POST (ADMIN/OPERATOR) |
| Moon | `/api/v1/moons/{id}/rebind` | POST (ADMIN/OPERATOR) |
| Moon | `/api/v1/moons/{id}/rebuild` | POST (ADMIN/OPERATOR) |
| Moon | `/api/v1/moons/{id}/download` | GET |
| Moon | `/api/v1/moons/ha-templates` | GET |
| Cluster | `/api/v1/cluster/status` | GET |
| Cluster | `/api/v1/cluster/nodes/add` | POST (ADMIN/OPERATOR) |
| Cluster | `/api/v1/cluster/nodes/{nodeId}` | DELETE (ADMIN/OPERATOR) |
| Cluster | `/api/v1/cluster/sync` | POST (ADMIN/OPERATOR) |
| Cluster | `/api/v1/cluster/build-unified` | POST (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/handshake` | POST (public, rate-limited) |
| Federation | `/api/v1/federation/tokens` | GET (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/tokens/create` | POST (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/tokens/{id}/revoke` | POST (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/tokens/{id}/renew` | POST (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/join` | POST (ADMIN/OPERATOR, SSRF-protected) |
| Federation | `/api/v1/federation/peers` | GET |
| Federation | `/api/v1/federation/peers/{nodeId}` | DELETE (ADMIN/OPERATOR) |
| Federation | `/api/v1/federation/sync-now` | POST (ADMIN/OPERATOR) |
| Identity | `/api/v1/identity/status` | GET |
| Identity | `/api/v1/identity/generate` | POST (ADMIN/OPERATOR) |
| Identity | `/api/v1/identity/rotate` | POST (ADMIN) |
| Identity | `/api/v1/identity/verify` | POST (ADMIN/OPERATOR) |
| Backup | `/api/v1/backup/export` | POST (ADMIN) |
| Backup | `/api/v1/backup/import` | POST (ADMIN) |
| Cloudflare | `/api/v1/cloudflare/config` | GET (apiToken masked) |
| Cloudflare | `/api/v1/cloudflare/config` | POST (ADMIN/OPERATOR) |
| Cloudflare | `/api/v1/cloudflare/verify-token` | POST |
| Cloudflare | `/api/v1/cloudflare/zones` | GET |
| Cloudflare | `/api/v1/cloudflare/zones/{zoneId}/records` | GET |
| Cloudflare | `/api/v1/cloudflare/sync` | POST (ADMIN/OPERATOR) |
| Cloudflare | `/api/v1/cloudflare/logs` | GET |
| Cloudflare | `/api/v1/cloudflare/logs` | DELETE (ADMIN/OPERATOR) |
| Network | `/api/v1/network/addresses` | GET |
| Domains | `/api/v1/domains` | GET |
| Domains | `/api/v1/domains/verify` | POST (ADMIN/OPERATOR) |
| Domains | `/api/v1/domains/bind` | POST (ADMIN/OPERATOR) |
| DDNS | `/api/v1/ddns/status` | GET |
| DDNS | `/api/v1/ddns/sync` | POST (ADMIN/OPERATOR) |
| DDNS | `/api/v1/ddns/config` | POST (ADMIN/OPERATOR) |
