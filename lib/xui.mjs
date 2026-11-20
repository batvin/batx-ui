import {URL} from 'node:url';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function normalizeSettings(input, previous = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Invalid settings.');
  let url;
  try { url = new URL(String(input.url || '')); } catch { throw new AppError('Enter the full 3x-ui URL, including its private base path.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new AppError('3x-ui URL must be HTTP(S), without embedded credentials, query or fragment.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';

  const apiToken = (typeof input.apiToken === 'string' && input.apiToken.trim())
    ? input.apiToken.trim()
    : (previous?.apiToken || '');

  const username = String(input.username || '').trim();
  const password = (typeof input.password === 'string' && input.password)
    ? input.password
    : (previous?.password || '');

  if (!apiToken && (!username || !password)) {
    throw new AppError('Provide either an API Token or username + password.');
  }
  if (apiToken && apiToken.length > 512) throw new AppError('API Token is too long.');
  if (username && username.length > 128) throw new AppError('Username is too long.');
  if (password && password.length > 1024) throw new AppError('Password is too long.');

  const publicHost = String(input.publicHost || '').trim().replace(/^\[|\]$/g, '');
  if (publicHost && !/^[a-zA-Z0-9:._-]+$/.test(publicHost)) {
    throw new AppError('Public host must be a hostname or IP address, without scheme, port or path.');
  }

  let subscriptionBase = String(input.subscriptionBase || '').trim();
  if (subscriptionBase) {
    let sub;
    try { sub = new URL(subscriptionBase); } catch { throw new AppError('Invalid subscription URL.'); }
    if (!['http:', 'https:'].includes(sub.protocol) || sub.username || sub.password || sub.hash || sub.search) {
      throw new AppError('Invalid subscription URL.');
    }
    subscriptionBase = sub.href.replace(/\/+$/, '') + '/';
  }

  return { url: url.href, username, password, apiToken, publicHost, subscriptionBase };
}

export class XUI {
  constructor(settings, { fetchImpl = globalThis.fetch, timeout = 20000 } = {}) {
    this.settings = settings;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.cookies = new Map();
    this.loginPromise = null;
    this.hasSession = false;
  }

  get usesToken() {
    return Boolean(this.settings.apiToken);
  }

  rememberCookies(response) {
    const setCookie = response.headers.getSetCookie?.() || [];
    for (const cookie of setCookie) {
      const first = cookie.split(';')[0];
      const idx = first.indexOf('=');
      if (idx > 0) this.cookies.set(first.slice(0, idx), first.slice(idx + 1));
    }
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async raw(route, method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const url = new URL(route, this.settings.url);
      const headers = {
        'Accept': 'application/json',
        'User-Agent': 'batx-ui/0.1'
      };

      if (this.usesToken) {
        headers['Authorization'] = `Bearer ${this.settings.apiToken}`;
      } else {
        const cookie = this.cookieHeader();
        if (cookie) headers['Cookie'] = cookie;
      }

      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
      }

      let response;
      try {
        response = await this.fetch(url.href, {
          method,
          headers,
          body: body == null ? undefined : JSON.stringify(body),
          signal: controller.signal,
          redirect: 'manual'
        });
      } catch (err) {
        const msg = err?.cause?.code || err?.code || err?.message || 'unknown';
        if (/CERT|TLS|UNABLE_TO_VERIFY|SELF_SIGNED/i.test(String(msg))) {
          throw new AppError('TLS/certificate error reaching 3x-ui. For local panels set NODE_TLS_REJECT_UNAUTHORIZED=0 or use http://127.0.0.1 if available.', 502);
        }
        throw new AppError(`Cannot reach 3x-ui (${msg}). Check URL, firewall and that the panel is running.`, 502);
      }

      this.rememberCookies(response);

      const text = await response.text();
      let result = null;
      try { result = text ? JSON.parse(text) : null; } catch {}

      if (response.status === 401 || response.status === 403) {
        throw new AppError('3x-ui authentication failed. Check API Token (or username/password) and the secret base path.', 403);
      }

      if (!response.ok) {
        const msg = (result && (result.msg || result.message)) || (`HTTP ${response.status}`);
        throw new AppError('3x-ui: ' + msg, response.status);
      }

      if (result && typeof result.success === 'boolean') {
        if (!result.success) {
          const message = typeof result.msg === 'string' ? result.msg.slice(0, 250) : 'Operation rejected';
          if (/auth|login|password|credential|session|unauthorized|token/i.test(message)) {
            throw new AppError('3x-ui authentication failed: ' + message, 403);
          }
          throw new AppError('3x-ui: ' + message, 502);
        }
        return result.obj;
      }

      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async login() {
    if (this.usesToken) {
      this.hasSession = true;
      return;
    }
    if (this.hasSession) return;
    if (this.loginPromise) return this.loginPromise;

    this.loginPromise = (async () => {
      this.cookies.clear();
      await this.raw('login', 'POST', {
        username: this.settings.username,
        password: this.settings.password
      });
      this.hasSession = true;
    })().finally(() => { this.loginPromise = null; });

    return this.loginPromise;
  }

  async request(route, method = 'GET', body) {
    if (!this.hasSession) await this.login();
    try {
      return await this.raw(route, method, body);
    } catch (error) {
      if (!this.usesToken && error.message && error.message.includes('authentication failed')) {
        this.hasSession = false;
        await this.login();
        return this.raw(route, method, body);
      }
      throw error;
    }
  }

  async getInbounds() {
    const result = await this.request('panel/api/inbounds/list');
    return Array.isArray(result) ? result : [];
  }

  async getInbound(id) {
    return this.request(`panel/api/inbounds/get/${id}`);
  }
}
