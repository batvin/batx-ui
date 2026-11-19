# batx-ui

Self-hosted Persian 3D administration interface for Sanaei 3x-ui (Ubuntu 22.04)

## Repository

https://github.com/batvin/batx-ui

## Installation on Ubuntu 22.04

See the detailed guide in `INSTALL.html` (open it in a browser after cloning).

Quick start with Docker (after configuring):

```bash
git clone https://github.com/batvin/batx-ui.git
cd batx-ui
node scripts/configure.mjs   # creates .env with random admin password
sudo docker compose up -d --build
```

Then open http://127.0.0.1:8787 (or your domain if using the Caddy HTTPS profile).

**Note:** Some large frontend assets (app.js, styles.css, package-lock.json, INSTALL.html, remaining lib files) may need to be added from the original release zip if not yet present. Clone and compare with the provided zip.
