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
  const username = String(input.username || '').trim();
  const password = (typeof input.password === 'string' && input.password) ? input.password : previous?.password;
  if (!username || username.length > 128 || !password || password.length > 1024) {
    throw new AppError('3x-ui username and password are required.');
  }
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
  return { url: url.href, username, password, publicHost, subscriptionBase };
}

export class XUI {
  constructor(settings, { fetchImpl = globalThis.fetch, timeout = 15000 } = {}) {
    this.settings = settings;
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.cookies = new Map();
    this.loginPromise = null;
    this.hasSession = false;
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
      const cookie = this.cookieHeader();
      if (cookie) headers['Cookie'] = cookie;
      if (body !== undefined && body !== null) {
        headers['Content-Type'] = 'application/json';
      }

      const response = await this.fetch(url.href, {
        method,
        headers,
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual'
      });

      this.rememberCookies(response);

      // 3x-ui often returns 200 even for auth failures; check body
      const text = await response.text();
      let result;
      try {
        result = text ? JSON.parse(text) : null;
      } catch {
        if (response.status === 403 || response.status === 401) {
          throw new AppError('3x-ui authentication failed (HTTP ' + response.status + '). Check username/password and base path.', 403);
        }
        throw new AppError('3x-ui returned non-JSON (HTTP ' + response.status + '). Verify the full panel URL including secret path.', 502);
      }

      if (response.status === 403 || response.status === 401) {
        throw new AppError('3x-ui authentication failed. Check username, password and the secret base path.', 403);
      }

      if (!response.ok) {
        const msg = (result && (result.msg || result.message)) || ('HTTP ' + response.status);
        throw new AppError('3x-ui: ' + msg, response.status);
      }

      // Sanaei 3x-ui format: { success: boolean, msg: string, obj: any }
      if (result && typeof result.success === 'boolean') {
        if (!result.success) {
          const message = typeof result.msg === 'string' ? result.msg.slice(0, 250) : 'Operation rejected';
          if (/auth|login|password|credential|session|unauthorized/i.test(message)) {
            throw new AppError('3x-ui authentication failed: ' + message, 403);
          }
          throw new AppError('3x-ui: ' + message, 502);
        }
        return result.obj;
      }

      // fallback for other shapes
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  async login() {
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
      if (error.message && error.message.includes('authentication failed')) {
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
