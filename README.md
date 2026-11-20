# batx-ui

Self-hosted Persian 3D administration interface for Sanaei 3x-ui (Ubuntu 22.04)

**Repository:** https://github.com/batvin/batx-ui

## Clean install (recommended)

```bash
# Remove old broken copy
sudo docker compose -f ~/batx-ui/compose.yaml down 2>/dev/null || true
rm -rf ~/batx-ui

# Fresh clone
git clone https://github.com/batvin/batx-ui.git
cd batx-ui

# Create admin password (save the output!)
node scripts/configure.mjs

# Build & run
sudo docker compose up -d --build
```

Open: **http://SERVER-IP:8787**

Login with `admin` + the password printed by `configure.mjs`.

### Connect to your 3x-ui panel

1. In batx-ui go to **اتصال 3x-ui**
2. Panel URL (local, recommended): `https://127.0.0.1:8443/YOUR_SECRET_PATH/`
3. Prefer **API Token** (Settings → Security → API Token in 3x-ui, scope admin)
4. Public Host: your real domain (e.g. `gkoo.elvamk.shop`)
5. Save → open **کانفیگ‌ها**

### Notes

- `network_mode: host` so batx-ui can reach local 3x-ui
- `NODE_TLS_REJECT_UNAUTHORIZED=0` allows self-signed certs on localhost
- Data is stored in Docker volume `batx_data`
