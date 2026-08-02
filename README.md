<p align="center">
  <img src="asserts/logo.svg" alt="ZGALAXY Logo" width="180" height="180" />
</p>

<h1 align="center">ZGALAXY</h1>

<p align="center">
  <b>Next-Generation Decentralized Infrastructure Management Platform for Private Planetary Networks</b>
</p>

<p align="center">
  <a href="https://github.com/dreamzone-cc/ZGALAXY"><img src="https://img.shields.io/badge/Platform-ZGALAXY%20v1.2.0-ffb700?style=for-the-badge&logo=zerotier&logoColor=000" alt="ZGALAXY v1.2.0" /></a>
  <a href="https://github.com/dreamzone-cc/ZGALAXY/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-00ffb7?style=for-the-badge" alt="AGPL-3.0 License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Architecture-Decentralized%20Mesh-00b7ff?style=for-the-badge" alt="Decentralized Mesh" /></a>
  <a href="#"><img src="https://img.shields.io/badge/UI%20Theme-Obsidian%20%26%20Gold%20TUI-ffd700?style=for-the-badge" alt="Obsidian Gold TUI" /></a>
  <a href="https://discord.gg"><img src="https://img.shields.io/badge/Community-yuuyu__gg-7289da?style=for-the-badge&logo=discord&logoColor=fff" alt="Discord" /></a>
</p>

---

## 🌌 Executive Summary

**ZGALAXY** is an enterprise-grade, fully autonomous, decentralized infrastructure platform designed to replace centralized network management systems. It provides 100% independence from third-party vendor clouds, zero subscription fees, and complete control over private **Planet & Moon** root topologies.

Built on Node.js, Express, SvelteKit, and a custom **Obsidian Black & Galaxy Gold TUI Engine**, ZGALAXY allows organizations, community members, and enterprise clusters to deploy 100+ interconnected nodes that function as a single, resilient, self-healing distributed mesh network.

---

## ⚡ Key Strengths & Core Differentiators

### 1. 🛡️ 100% Independence from Central Controllers
Unlike traditional solutions that rely on vendor-hosted cloud controllers, ZGALAXY operates with complete self-sovereignty.
- **Zero Cloud Lock-in:** No reliance on my.zerotier.com or third-party license servers.
- **Zero Node Limits:** Manage unlimited nodes, planets, moons, and networks without artificial pricing tiers.
- **Self-Contained Root Compilation:** Compiles signed, native binary roots (`world.bin` & `.moon`) directly on your own infrastructure.

### 2. 🌐 Scoped Federation Token Engine
Inter-node security is powered by cryptographically signed **Federation Tokens** (`tokenId` & `tokenSecret`). Nodes exchange topology metadata autonomously without requiring a single central registry.
- **Token Lifecycle Control:** Generate, scope permissions (`READ`, `WRITE`, `PLANET_SYNC`, `MOON_SYNC`), set expiration dates, renew, or permanently revoke tokens.
- **Auditable Token Metrics:** Track usage counts, max limits, and active token states in real time.

### 3. 🔄 Dual-Mode Topology Synchronization Engine

| Sync Mode | Architectural Behavior | Use Case |
| :--- | :--- | :--- |
| **`FEDERATION_INHERITED`**<br>*(Auto-Discovery Mesh)* | When Node E joins Node A, Node E **automatically inherits and discovers** Nodes B, C, and D. Transitive mesh discovery propagates seamlessly across 100+ nodes without manual 1-to-1 linking. | Global community networks, enterprise branch offices, decentralized mesh networks. |
| **`DIRECT_ISOLATED`**<br>*(Strict Point-to-Point)* | Node X connects to Node A in strict isolation. Node X receives **ZERO information about B, C, or D**, and B/C/D receive ZERO info about X. Non-transitive, zero topology leakage. | High-security edge nodes, isolated audit servers, private point-to-point tunnels. |

### 4. 🏢 Multi-Planet Cluster High Availability (HA)
Aggregate multiple federated Planet root endpoints into a single, unified multi-root distribution file. If one physical Planet server goes offline, the network automatically routes through remaining active roots with **99.999% uptime redundancy**.

### 5. 🌙 Moon Node Lifecycle & Dynamic Migration
- **Instant Moon Generation:** Generate signed `.moon` nodes with automatic public key resolution (`zerotier-idtool`).
- **Cross-Planet Moon Migration:** Transfer signed Moon node authority from one Planet root to another in a single click.
- **Endpoint Re-binding:** Update Moon listening endpoints dynamically without invalidating node identities.

### 6. ☁️ Cloudflare DNS v4 & Dynamic DDNS Auto-Sync
- **Automatic IP Tracking:** Background worker checks dynamic WAN IP changes every 5 minutes.
- **Cloudflare Integration:** Seamlessly syncs A/AAAA records via Cloudflare REST API v4 with token validation and audit logging.
- **Auto-Rebuild Trigger:** Automatically recompiles Planet binaries when public IP addresses change.

### 7. 🎨 Obsidian & Gold TUI Aesthetics (Zero-Icon Policy)
- **Interactive TUI Console:** High-contrast Obsidian Black (`#08080a`) and Galaxy Gold (`#ffd700`) styling.
- **100% Text-Based Controls:** Zero icon bloat. All actions use clear text tags (`[ SYNC CLUSTER ]`, `[ MIGRATE MOON ]`, `[ REVOKE ]`).
- **Custom Non-Blocking Dialogs:** Zero browser native popups (`alert`, `confirm`). Custom TUI modals ensure seamless workflow continuity.

---

## 📊 Competitive Matrix: ZGALAXY vs Legacy Controllers

| Feature / Dimension | ZGALAXY Platform | Official Cloud Central | Legacy Self-Hosted Controllers |
| :--- | :---: | :---: | :---: |
| **Central Vendor Dependency** | ❌ **NONE (100% Autonomous)** | ⚠️ High (Vendor Cloud) | ⚠️ High (Single Central Node) |
| **Decentralized Mesh Federation** | ✅ **Native (100+ Nodes)** | ❌ No | ❌ No |
| **Dual Sync Modes (Inherited vs Isolated)**| ✅ **Native (Zero Leakage)** | ❌ No | ❌ No |
| **Multi-Root HA Planet Compiler** | ✅ **Native (Unified Binary)** | ❌ No | ❌ No |
| **Moon Node Migration & Re-binding** | ✅ **Native (Automated)** | ❌ No | ❌ No |
| **Cloudflare DNS & DDNS Auto-Sync** | ✅ **Built-in (5-Min Worker)** | ❌ No | ❌ No |
| **Node / Member Limits** | ♾️ **UNLIMITED** | ⚠️ Limited (Paid Tiers) | ⚠️ Single Instance Bound |
| **User Interface Aesthetics** | 🎨 **Obsidian & Gold TUI** | 📄 Generic Web UI | 📄 Legacy Basic Web UI |
| **License** | 📜 **AGPL-3.0 License** | 🔒 Proprietary | 📜 Varies |

---

## 🏗️ System Architecture

```
+-----------------------------------------------------------------------------------+
|                            ZGALAXY CONTROL ENGINE                                 |
+-----------------------------------------------------------------------------------+
                                         |
     +-------------------+---------------+---------------+-------------------+
     |                   |                               |                   |
     v                   v                               v                   v
 [ FEDERATION ]   [ CLUSTER HA ]                 [ MOON ENGINE ]     [ CLOUDFLARE ]
Token Engine      Multi-Root Planet               Signed Binaries      DNS & DDNS Worker
(Inherited/Iso)   Unified Compiler               Migration & Rebind   WAN IP Tracking
```

---

## 🚀 Quick Deployment Guide

### Prerequisites
- Linux OS (Ubuntu 20.04+, Debian 11+, RHEL 8+, Alpine)
- Node.js v18+ & npm

### Installation
```bash
# Clone the repository
git clone https://github.com/dreamzone-cc/ZGALAXY.git
cd ZGALAXY

# Deploy using single-command script
chmod +x deploy.sh
./deploy.sh
```

### Access Console & APIs
- **Web Console (TUI):** `http://<SERVER_IP>:5173`
- **Backend REST Engine:** `http://<SERVER_IP>:3000`
- **Interactive Swagger Docs:** `http://<SERVER_IP>:3000/api/docs`

---

## 🏷️ Metadata & Community

* **Official Repository:** [https://github.com/dreamzone-cc/ZGALAXY](https://github.com/dreamzone-cc/ZGALAXY)
* **License:** [AGPL-3.0 License](LICENSE)
* **Developer Discord:** `yuuyu_gg`
* **Maintainers:** [DreamZone Community](https://github.com/dreamzone-cc)

---

<p align="center">
  <sub>Built with ❤️ for private, autonomous planetary mesh networks. ZGALAXY is licensed under AGPL-3.0.</sub>
</p>
