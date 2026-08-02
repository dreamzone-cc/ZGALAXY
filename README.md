<p align="center">
  <img src="asserts/logo.svg" alt="ZGALAXY Logo" width="160" height="160" />
</p>

<h1 align="center">ZGALAXY</h1>

<p align="center">
  <b>Standalone Decentralized ZeroTier Planet & Moon Infrastructure Management Platform</b>
</p>

<p align="center">
  <a href="https://github.com/dreamzone-cc/ZGALAXY"><img src="https://img.shields.io/badge/Project-ZGALAXY-ffb700?style=for-the-badge" alt="ZGALAXY" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-00ffb7?style=for-the-badge" alt="AGPL-3.0 License" /></a>
  <a href="https://discord.gg"><img src="https://img.shields.io/badge/Discord-yuuyu__gg-7289da?style=for-the-badge" alt="Discord" /></a>
</p>

---

## 🌌 Overview

**ZGALAXY** is a powerful, enterprise-grade, decentralized ZeroTier Planet & Moon infrastructure management system built with Node.js, Express, SvelteKit, and modern TUI (Terminal User Interface) aesthetic styling.

It enables individuals, enterprises, and community members to deploy 100+ autonomous ZGALAXY nodes globally, federating them into a unified mesh or linking them via isolated point-to-point channels.

---

## ✨ Features

- **🌐 Decentralized Federation Engine:** Scoped **Federation Tokens** for inter-node handshakes, mesh peer discovery, and token lifecycle management (Create, Scope, Renew, Revoke).
- **🔄 Dual Synchronization Modes:**
  - **`FEDERATION_INHERITED` (Auto-Discovery Mesh):** Joining nodes automatically inherit and discover all connected peers in the mesh network.
  - **`DIRECT_ISOLATED` (Strict Point-to-Point Isolation):** Strict 2-node isolation with zero topology information leaks.
- **🏢 Multi-Planet Cluster HA:** Aggregate multiple federated Planet root endpoints into a unified multi-root `world.bin` distribution binary.
- **🌙 Moon Lifecycle & Node Migration:** One-click `.moon` generation, endpoint re-binding, and seamless migration across federated planet nodes.
- **☁️ Cloudflare DNS Auto-Sync & DDNS:** Automated Cloudflare REST API v4 integration with dynamic WAN IP change workers every 5 minutes.
- **🎨 Obsidian & Gold TUI Aesthetics:** Zero-icon text-based UI console adhering strictly to 100% text controls and custom modal dialogs.
- **🔐 User Authentication & RBAC:** Role-Based Access Control (`ADMIN`, `OPERATOR`, `READ_ONLY`) with session token verification.

---

## 🏷️ Project & Developer Metadata

* **Project Name:** `ZGALAXY`
* **License:** `AGPL-3.0 License`
* **Official GitHub:** [https://github.com/dreamzone-cc/ZGALAXY](https://github.com/dreamzone-cc/ZGALAXY)
* **Developer Discord:** `yuuyu_gg`

---

## 🚀 Quick Deployment Guide

```bash
# Clone repository
git clone https://github.com/dreamzone-cc/ZGALAXY.git
cd ZGALAXY

# Execute single-command deployment
chmod +x deploy.sh
./deploy.sh
```

### 📍 Default Ports & Endpoints
- **Web Console (TUI):** `http://<SERVER_IP>:5173`
- **Backend API Engine:** `http://<SERVER_IP>:3000`
- **Interactive Swagger Docs:** `http://<SERVER_IP>:3000/api/docs`

---

## 📄 License

This project is licensed under the **AGPL-3.0 License**. See the `LICENSE` file for details.
