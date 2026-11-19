import {randomUUID, randomBytes} from 'node:crypto';
import {AppError} from './xui.mjs';

export const CLIENT_PROTOCOLS = new Set(['vless','vmess','trojan','shadowsocks']);

export function inboundId(inbound) {
  return String(inbound?.id ?? inbound?.Id ?? '');
}

export function validateInbound(inbound) {
  if (!inbound || typeof inbound !== 'object') throw new AppError('Invalid inbound');
  if (!inboundId(inbound)) throw new AppError('Inbound id is missing');
  return inbound;
}

export function validateClient(client, protocol) {
  if (!client || typeof client !== 'object') throw new AppError('Invalid client');
  if (!client.email || typeof client.email !== 'string' || client.email.length > 128) throw new AppError('Client email/remark is required');
  return client;
}

export function flattenClients(inbounds=[]) {
  const list = [];
  for (const inbound of inbounds) {
    const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings || '{}') : (inbound.settings || {});
    const clients = settings.clients || [];
    for (const client of clients) {
      list.push({inbound, client, protocol: inbound.protocol});
    }
  }
  return list;
}

export function findClient(inbounds, email) {
  for (const item of flattenClients(inbounds)) {
    if (item.client.email === email) return item;
  }
  return null;
}

export function generateLinks(inbound, client, settings) {
  const warn = [];
  const protocol = inbound.protocol;
  const host = settings?.publicHost || '127.0.0.1';
  const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const stream = typeof inbound.streamSettings === 'string' ? JSON.parse(inbound.streamSettings || '{}') : (inbound.streamSettings || {});
  const network = stream.network || 'tcp';
  const security = stream.security || 'none';
  const params = new URLSearchParams();
  params.set('type', network === 'raw' ? 'tcp' : network);
  params.set('security', security);
  if (security === 'tls' || security === 'reality') {
    const tls = stream.tlsSettings || stream.realitySettings || {};
    if (tls.serverName) params.set('sni', tls.serverName);
    if (tls.fingerprint) params.set('fp', tls.fingerprint);
    if (tls.alpn) params.set('alpn', Array.isArray(tls.alpn) ? tls.alpn.join(',') : tls.alpn);
    if (security === 'reality') {
      if (tls.publicKey) params.set('pbk', tls.publicKey);
      if (tls.shortId) params.set('sid', Array.isArray(tls.shortId) ? tls.shortId[0] : tls.shortId);
      if (tls.spiderX) params.set('spx', tls.spiderX);
    }
  }
  if (network === 'ws') {
    params.set('path', stream.wsSettings?.path || '/');
    if (stream.wsSettings?.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
  }
  if (network === 'grpc') {
    params.set('serviceName', stream.grpcSettings?.serviceName || '');
    params.set('mode', stream.grpcSettings?.multiMode ? 'multi' : 'gun');
  }
  if (network === 'xhttp') {
    const x = stream.xhttpSettings || {};
    params.set('path', x.path || '/');
    params.set('mode', x.mode || 'auto');
    if (x.host) params.set('host', x.host);
  }
  if (network === 'tcp' || network === 'raw') {
    const tcp = stream.tcpSettings || stream.rawSettings || {};
    params.set('headerType', tcp.header?.type || 'none');
    const request = tcp.header?.request;
    if (request?.path?.length) params.set('path', request.path.join(','));
    if (request?.headers?.Host?.length) params.set('host', request.headers.Host.join(','));
  }
  const label = encodeURIComponent(`${inbound.remark || 'batx-ui'} · ${client.email}`);
  let link;
  if (protocol === 'vless' || protocol === 'trojan') {
    if (protocol === 'vless') {
      params.set('encryption', 'none');
      if (client.flow) params.set('flow', client.flow);
    }
    const key = protocol === 'trojan' ? client.password : client.id;
    if (!key) return {links: [], subscription: null, warning: 'Client credential is missing.'};
    link = `${protocol}://${encodeURIComponent(key)}@${address}:${inbound.port}?${params}#${label}`;
  } else if (protocol === 'vmess') {
    const v = {
      v: '2',
      ps: `${inbound.remark || 'batx-ui'} · ${client.email}`,
      add: host,
      port: String(inbound.port),
      id: client.id,
      aid: '0',
      scy: client.security || 'auto',
      net: network === 'raw' ? 'tcp' : network,
      type: params.get('headerType') || 'none',
      host: params.get('host') || '',
      path: network === 'grpc' ? params.get('serviceName') : (params.get('path') || ''),
      tls: security === 'tls' ? 'tls' : '',
      sni: params.get('sni') || '',
      alpn: params.get('alpn') || '',
      fp: params.get('fp') || ''
    };
    link = 'vmess://' + Buffer.from(JSON.stringify(v), 'utf8').toString('base64');
  } else {
    const ss = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings || '{}') : (inbound.settings || {});
    if (!ss.method || String(ss.method).startsWith('2022-')) {
      return {links: [], subscription: null, warning: 'Shadowsocks 2022 requires client-specific configuration.'};
    }
    link = `ss://${Buffer.from(`${ss.method}:${client.password}`).toString('base64url')}@${address}:${inbound.port}#${label}`;
  }
  if (client.enable === false || inbound.enable === false) warn.push('This client or inbound is disabled.');
  const subscription = settings?.subscriptionBase ? `${settings.subscriptionBase}${client.subId || client.email}` : null;
  return {links: [link], subscription, warning: warn.length ? warn.join(' ') : null};
}

export async function listConfigs(store) {
  const settings = store.settings();
  if (!settings) return [];
  const xui = new (await import('./xui.mjs')).XUI(settings);
  const inbounds = await xui.getInbounds();
  return flattenClients(inbounds).map(({inbound, client, protocol}) => ({
    id: `${inboundId(inbound)}:${client.email}`,
    email: client.email,
    protocol,
    inboundId: inboundId(inbound),
    enable: client.enable !== false && inbound.enable !== false,
    ...generateLinks(inbound, client, settings)
  }));
}

export async function getConfig(store, id) {
  const configs = await listConfigs(store);
  const found = configs.find(c => c.id === id);
  if (!found) throw new AppError('Config not found', 404);
  return found;
}

export async function createConfig(store, body) {
  throw new AppError('Not implemented in this build');
}

export async function updateConfig(store, id, body) {
  throw new AppError('Not implemented in this build');
}

export async function deleteConfig(store, id) {
  throw new AppError('Not implemented in this build');
}
