# ZGALAXY - Standalone Planet & Moon Infrastructure Management Platform

========================================================================
ZGALAXY - SECURE AUTHENTICATION GATEWAY & PLANET ENGINE [TUI MODE]
========================================================================

**ZGALAXY** is a powerful, standalone ZeroTier Planet & Moon infrastructure management system built with Node.js, Express, SvelteKit, and modern TUI aesthetic styling.

---

## 🏷️ Project & Developer Metadata

* **Project Name:** `ZGALAXY`
* **License:** `AGPL-3.0 License`
* **Official GitHub Repository:** [https://github.com/dreamzone-cc](https://github.com/dreamzone-cc)
* **Developer Discord:** `yuuyu_gg`

---

## ✨ Features

- **TUI Mode Aesthetics:** Zero-icon text-based UI with Obsidian Black & Galaxy Gold color theme.
- **Custom Reusable Modals:** Zero native browser dialogs (`alert`, `confirm`, `prompt` replaced by TUI modal system).
- **User Authentication & RBAC Engine:** Built-in member roles (`ADMIN`, `OPERATOR`, `READ_ONLY`) with PBKDF2 password hashing and session tokens.
- **Cloudflare DNS Auto-Sync Integration:** Extensible provider architecture supporting Cloudflare REST API v4 (User & Account Tokens `cfat_...`) with WAN IP auto-detection and automatic Planet rebuild.
- **Dynamic IP & DDNS Sync Worker:** Background worker tracking dynamic WAN IP changes every 5 minutes.
- **Planet & Moon Lifecycle Management:** One-click Planet compilation, `.moon` node generation, signature validation, and backup export/restore.

---

## 🚀 Quick Deployment Guide

```bash
# Clone or transfer repository
cd /opt/zgalaxy

# Execute single-command deployment
chmod +x deploy.sh
./deploy.sh
```

- **TUI Console:** `http://<SERVER_IP>:5173`
- **Backend API:** `http://<SERVER_IP>:3000`
- **Swagger Documentation:** `http://<SERVER_IP>:3000/api/docs`

---

## 📄 License

This project is licensed under the **AGPL-3.0 License**. See the LICENSE file for details.
