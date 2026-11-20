'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));

const state = { user: null, settings: null, configs: [] };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <h1>batx-ui</h1>
        <p>ورود به پنل مدیریت</p>
        <form id="login-form">
          <div class="field"><label>نام کاربری</label><input name="username" value="admin" autocomplete="username" required></div>
          <div class="field"><label>رمز عبور</label><input name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary" type="submit">ورود</button>
        </form>
      </div>
    </div>`;
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
      await boot();
    } catch (err) {
      toast(err.message, 'err');
    }
  };
}

function renderShell() {
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><i>b</i> batx-ui</div>
        <nav class="nav">
          <button data-page="dashboard" class="active">داشبورد</button>
          <button data-page="settings">اتصال 3x-ui</button>
          <button data-page="configs">کانفیگ‌ها</button>
        </nav>
        <button class="btn sm" id="logout" style="margin-top:auto">خروج</button>
      </aside>
      <main class="main">
        <div class="topbar"><h1 id="page-title">داشبورد</h1></div>
        <div id="content"></div>
      </main>
    </div>`;
  $('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    location.reload();
  };
  $$('.nav button').forEach(btn => {
    btn.onclick = () => {
      $$('.nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      route(btn.dataset.page);
    };
  });
  route('dashboard');
}

async function route(page) {
  const title = { dashboard: 'داشبورد', settings: 'اتصال 3x-ui', configs: 'کانفیگ‌ها' }[page] || page;
  $('#page-title').textContent = title;
  const content = $('#content');
  if (page === 'dashboard') {
    content.innerHTML = `<div class="card"><p class="muted">خوش آمدید. از منوی سمت راست اتصال 3x-ui را تنظیم کنید و سپس کانفیگ‌ها را ببینید.</p></div>`;
  } else if (page === 'settings') {
    const s = state.settings || {};
    content.innerHTML = `
      <div class="card">
        <form id="settings-form">
          <div class="field"><label>آدرس کامل پنل 3x-ui (با path مخفی)</label><input name="url" value="${esc(s.url || '')}" placeholder="https://127.0.0.1:8443/secret/" required></div>
          <div class="field"><label>API Token (توصیه می‌شود — از Settings → Security → API Token)</label><input name="apiToken" type="password" value="" placeholder="${s.apiToken ? '•••••••• (خالی بگذارید اگر تغییر نمی‌دهید)' : 'Bearer token'}"></div>
          <div class="field"><label>نام کاربری 3x-ui (اختیاری اگر توکن دارید)</label><input name="username" value="${esc(s.username || '')}"></div>
          <div class="field"><label>رمز عبور 3x-ui (اختیاری اگر توکن دارید)</label><input name="password" type="password" value="" placeholder="${s.password ? '••••••••' : ''}"></div>
          <div class="field"><label>Public Host (برای ساخت لینک اشتراک)</label><input name="publicHost" value="${esc(s.publicHost || '')}" placeholder="gkoo.elvamk.shop"></div>
          <div class="field"><label>Subscription Base (اختیاری)</label><input name="subscriptionBase" value="${esc(s.subscriptionBase || '')}"></div>
          <button class="btn primary" type="submit">ذخیره</button>
        </form>
      </div>`;
    $('#settings-form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        url: fd.get('url'),
        apiToken: fd.get('apiToken') || undefined,
        username: fd.get('username') || undefined,
        password: fd.get('password') || undefined,
        publicHost: fd.get('publicHost'),
        subscriptionBase: fd.get('subscriptionBase')
      };
      try {
        state.settings = await api('/api/settings', { method: 'PUT', body });
        toast('تنظیمات ذخیره شد');
      } catch (err) {
        toast(err.message, 'err');
      }
    };
  } else if (page === 'configs') {
    content.innerHTML = `<div class="card"><p class="muted">در حال بارگذاری...</p></div>`;
    try {
      state.configs = await api('/api/configs');
      if (!state.configs.length) {
        content.innerHTML = `<div class="card empty">هنوز کانفیگی نیست یا لیست خالی است.</div>`;
        return;
      }
      content.innerHTML = `
        <div class="card">
          <table class="table">
            <thead><tr><th>ایمیل / نام</th><th>پروتکل</th><th>وضعیت</th><th></th></tr></thead>
            <tbody>
              ${state.configs.map(c => `
                <tr>
                  <td>${esc(c.email)}</td>
                  <td>${esc(c.protocol)}</td>
                  <td><span class="badge ${c.enable ? 'on' : 'off'}">${c.enable ? 'فعال' : 'غیرفعال'}</span></td>
                  <td><button class="btn sm" data-id="${esc(c.id)}">کپی لینک</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
      $$('[data-id]').forEach(btn => {
        btn.onclick = async () => {
          const cfg = state.configs.find(x => x.id === btn.dataset.id);
          const link = cfg?.links?.[0] || '';
          if (!link) return toast('لینکی موجود نیست', 'warn');
          await navigator.clipboard.writeText(link);
          toast('لینک کپی شد');
        };
      });
    } catch (err) {
      content.innerHTML = `<div class="card"><p class="muted">${esc(err.message)}</p></div>`;
    }
  }
}

async function boot() {
  try {
    state.user = await api('/api/me');
    try { state.settings = await api('/api/settings'); } catch {}
    renderShell();
  } catch {
    renderLogin();
  }
}

boot();
