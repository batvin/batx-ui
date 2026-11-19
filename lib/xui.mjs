import {URL} from 'node:url';

export class AppError extends Error {
  constructor(message,status=400) {super(message);this.status=status;}
}
export function normalizeSettings(input,previous=null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Invalid settings.');
  let url;
  try {url=new URL(String(input.url||''));} catch {throw new AppError('Enter the full 3x-ui URL, including its private base path.');}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AppError('3x-ui URL must be HTTP(S), without embedded credentials, query or fragment.');
  url.pathname=url.pathname.replace(/\/+$/,'')+'/';
  const username=String(input.username||'').trim();
  const password=typeof input.password==='string' && input.password ? input.password : previous?.password;
  if (!username || username.length>128 || !password || password.length>1024) throw new AppError('3x-ui username and password are required.');
  const publicHost=String(input.publicHost||'').trim().replace(/^\[|\]$/g,'');
  if (publicHost && !/^[a-zA-Z0-9:._-]+$/.test(publicHost)) throw new AppError('Public host must be a hostname or IP address, without scheme, port or path.');
  if (publicHost.includes(':') && !publicHost.includes('::') && publicHost.split(':').length<3) throw new AppError('Do not include a port in the public host.');
  let subscriptionBase=String(input.subscriptionBase||'').trim();
  if (subscriptionBase) {
    let sub;
    try {sub=new URL(subscriptionBase);} catch {throw new AppError('Invalid subscription URL.');}
    if (!['http:','https:'].includes(sub.protocol)||sub.username||sub.password||sub.hash||sub.search) throw new AppError('Invalid subscription URL.');
    subscriptionBase=sub.href.replace(/\/+$/,'')+'/';
  }
  return {url:url.href,username,password,publicHost,subscriptionBase};
}

// Sole upstream target is an administrator-configured origin. Never expose an arbitrary URL proxy.
export class XUI {
  constructor(settings,{fetchImpl=globalThis.fetch,timeout=15000}={}) {
    this.settings=settings;
    this.fetch=fetchImpl;
    this.timeout=timeout;
    this.cookies=new Map();
    this.loginPromise=null;
    this.hasSession=false;
  }
  rememberCookies(response) {
    for (const cookie of response.headers.getSetCookie?.() || []) {
      const first=cookie.split(';')[0];
      const split=first.indexOf('=');
      if (split>0) this.cookies.set(first.slice(0,split), first.slice(split+1));
    }
  }
  cookieHeader() {
    return [...this.cookies.entries()].map(([k,v])=>`${k}=${v}`).join('; ');
  }
  async request(path, method='GET', body=null) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(), this.timeout);
    try {
      const url = new URL(path, this.settings.url);
      const headers = {'Accept':'application/json'};
      const cookie = this.cookieHeader();
      if (cookie) headers.Cookie = cookie;
      if (body !== null) {
        headers['Content-Type'] = 'application/json';
      }
      const response = await this.fetch(url, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual'
      });
      this.rememberCookies(response);
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!response.ok) {
        const msg = data?.msg || data?.message || text || `HTTP ${response.status}`;
        throw new AppError(msg, response.status);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  async login() {
    if (this.hasSession) return;
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      const data = await this.request('login', 'POST', {
        username: this.settings.username,
        password: this.settings.password
      });
      if (data?.success === false) throw new AppError(data.msg || 'Login failed');
      this.hasSession = true;
    })();
    try {
      await this.loginPromise;
    } finally {
      this.loginPromise = null;
    }
  }
  async ensure() {
    await this.login();
  }
  async getInbounds() {
    await this.ensure();
    const data = await this.request('panel/api/inbounds/list');
    return data?.obj || data || [];
  }
  async getInbound(id) {
    await this.ensure();
    const data = await this.request(`panel/api/inbounds/get/${id}`);
    return data?.obj || data;
  }
  async addClient(id, client) {
    await this.ensure();
    return this.request(`panel/api/inbounds/addClient`, 'POST', {id, settings: JSON.stringify({clients:[client]})});
  }
  async updateClient(id, clientId, client) {
    await this.ensure();
    return this.request(`panel/api/inbounds/updateClient/${clientId}`, 'POST', {id, settings: JSON.stringify({clients:[client]})});
  }
  async delClient(id, key) {
    await this.ensure();
    return this.request(`panel/api/inbounds/${id}/delClient/${encodeURIComponent(key)}`, 'POST');
  }
  resetClient(id, email) {
    return this.request(`panel/api/inbounds/${id}/resetClientTraffic/${encodeURIComponent(email)}`, 'POST');
  }
}
