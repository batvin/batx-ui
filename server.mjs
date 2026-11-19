import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import QRCode from 'qrcode';
import {Store} from './lib/store.mjs';
import {XuiClient, AppError} from './lib/xui.mjs';
import {listConfigs, getConfig, createConfig, updateConfig, deleteConfig, validateInbound} from './lib/configs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = new Store(process.env.DATA_DIR || './data');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 8787;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';
const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || '';

if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is empty. Run: node scripts/configure.mjs');
  process.exit(1);
}

if (TRUST_PROXY) app.set('trust proxy', 1);

app.use(express.json({limit: '1mb'}));
app.use(express.static(path.join(__dirname, 'public'), {index: false, maxAge: '1h'}));

const sessions = new Map();

function makeSession() {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, {created: Date.now()});
  return id;
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)batx_session=([^;]+)/);
  if (!match) return null;
  const id = match[1];
  return sessions.has(id) ? id : null;
}

function requireAuth(req, res, next) {
  if (!getSession(req)) {
    return res.status(401).json({error: 'Unauthorized'});
  }
  next();
}

app.post('/api/login', (req, res) => {
  const {username, password} = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({error: 'Invalid body'});
  }
  const userOk = username === ADMIN_USERNAME;
  const passOk = password.length === ADMIN_PASSWORD.length &&
    timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!userOk || !passOk) {
    return res.status(401).json({error: 'Invalid credentials'});
  }
  const id = makeSession();
  res.setHeader('Set-Cookie', `batx_session=${id}; Path=/; HttpOnly; SameSite=Strict${COOKIE_SECURE ? '; Secure' : ''}`);
  res.json({ok: true});
});

app.post('/api/logout', (req, res) => {
  const id = getSession(req);
  if (id) sessions.delete(id);
  res.setHeader('Set-Cookie', 'batx_session=; Path=/; Max-Age=0');
  res.json({ok: true});
});

app.get('/api/me', (req, res) => {
  if (!getSession(req)) return res.status(401).json({error: 'Unauthorized'});
  res.json({username: ADMIN_USERNAME});
});

app.get('/api/settings', requireAuth, (req, res) => {
  res.json(store.getSettings());
});

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    const settings = await store.setSettings(req.body || {});
    res.json(settings);
  } catch (e) {
    res.status(e.status || 400).json({error: e.message});
  }
});

app.get('/api/configs', requireAuth, async (req, res) => {
  try {
    const configs = await listConfigs(store);
    res.json(configs);
  } catch (e) {
    res.status(e.status || 500).json({error: e.message});
  }
});

app.get('/api/configs/:id', requireAuth, async (req, res) => {
  try {
    const config = await getConfig(store, req.params.id);
    res.json(config);
  } catch (e) {
    res.status(e.status || 404).json({error: e.message});
  }
});

app.post('/api/configs', requireAuth, async (req, res) => {
  try {
    const config = await createConfig(store, req.body || {});
    res.status(201).json(config);
  } catch (e) {
    res.status(e.status || 400).json({error: e.message});
  }
});

app.put('/api/configs/:id', requireAuth, async (req, res) => {
  try {
    const config = await updateConfig(store, req.params.id, req.body || {});
    res.json(config);
  } catch (e) {
    res.status(e.status || 400).json({error: e.message});
  }
});

app.delete('/api/configs/:id', requireAuth, async (req, res) => {
  try {
    await deleteConfig(store, req.params.id);
    res.status(204).end();
  } catch (e) {
    res.status(e.status || 400).json({error: e.message});
  }
});

app.post('/api/configs/:id/qr', requireAuth, async (req, res) => {
  try {
    const config = await getConfig(store, req.params.id);
    const url = config.shareUrl || config.link || '';
    if (!url) return res.status(400).json({error: 'No share URL'});
    const dataUrl = await QRCode.toDataURL(url, {margin: 1, width: 256});
    res.json({dataUrl});
  } catch (e) {
    res.status(e.status || 500).json({error: e.message});
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({error: 'Internal error'});
});

app.listen(PORT, HOST, () => {
  console.log(`batx-ui listening on http://${HOST}:${PORT}`);
});
