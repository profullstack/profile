/**
 * Fetch a public HTTPS document supplied by an authenticated profile owner.
 * Every redirect is checked again, DNS answers must all be public, and the
 * request uses those validated addresses for its TLS connection. Callers must
 * parse/validate the document instead of returning its raw body.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { Readable } from 'node:stream';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

const BLOCKED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4Int(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function blockedV4(address) {
  const value = ipv4Int(address);
  if (value === null) return true;
  return BLOCKED_V4.some(([base, bits]) => {
    const baseValue = ipv4Int(base);
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

function expandV6(address) {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '');
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = ipv4Int(dotted[1]);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    text = `${text.slice(0, dotted.index)}${hi}:${lo}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part) => {
    if (!part) return [];
    const groups = part.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (head === null || tail === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const zeros = 8 - head.length - tail.length;
  return zeros < 1 ? null : [...head, ...new Array(zeros).fill(0), ...tail];
}

function blockedV6(address) {
  const groups = expandV6(address);
  if (!groups) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // link local
  if ((groups[0] & 0xff00) === 0xff00) return true; // multicast
  if ((groups[0] & 0xe000) !== 0x2000) return true; // only global unicast
  if (groups[0] === 0x2002) return true; // 6to4 embeds IPv4 destinations
  if (groups[0] === 0x2001 && groups[1] === 0) return true; // Teredo embeds IPv4 destinations
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation

  const zeroPrefix = groups.slice(0, 5).every((group) => group === 0);
  if (zeroPrefix && (groups[5] === 0xffff || groups[5] === 0)) {
    const address4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
    return blockedV4(address4);
  }
  // Well-known NAT64 embeds IPv4 in the last 32 bits.
  if (groups.slice(0, 6).every((group, index) => group === [0x0064, 0xff9b, 0, 0, 0, 0][index])) {
    const address4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
    return blockedV4(address4);
  }
  return false;
}

function blockedAddress(address) {
  const family = isIP(address.replace(/^\[|\]$/g, ''));
  if (family === 4) return blockedV4(address);
  if (family === 6) return blockedV6(address);
  return true;
}

async function resolvePublicUrl(raw, lookup = dnsLookup) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || BLOCKED_HOSTS.has(hostname) || /\.(localhost|internal|local)$/.test(hostname)) return null;

  const family = isIP(hostname.replace(/^\[|\]$/g, ''));
  if (family) return blockedAddress(hostname) ? null : { url, addresses: [{ address: hostname, family }] };

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }
  if (!addresses?.length || addresses.some(({ address }) => blockedAddress(address))) return null;
  return { url, addresses };
}

export async function checkPublicUrl(raw, lookup = dnsLookup) {
  return (await resolvePublicUrl(raw, lookup))?.url ?? null;
}

function pinnedHttpsRequest(url, addresses, signal) {
  return new Promise((resolve, reject) => {
    let addressIndex = 0;
    const lookup = (hostname, options, callback) => {
      const requestedHost = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
      const expectedHost = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
      if (requestedHost !== expectedHost) {
        callback(new Error('Unexpected hostname during pinned request'));
        return;
      }
      if (options?.all) {
        callback(null, addresses);
        return;
      }
      const address = addresses[addressIndex % addresses.length];
      addressIndex += 1;
      callback(null, address.address, address.family);
    };
    const request = https.request(url, {
      method: 'GET',
      headers: { Accept: 'text/markdown, text/plain;q=0.9' },
      lookup,
      signal,
      maxHeaderSize: 16 * 1024,
    }, (response) => {
      const status = response.statusCode ?? 502;
      const body = [204, 205, 304].includes(status) ? null : Readable.toWeb(response);
      resolve(new Response(body, { status, headers: response.headers }));
    });
    request.once('error', reject);
    request.end();
  });
}

export async function safeFetchPublicUrl(raw, {
  fetcher = globalThis.fetch,
  lookup = dnsLookup,
  maxRedirects = 3,
  timeoutMs = 10_000,
} = {}) {
  let current = raw;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const destination = await resolvePublicUrl(current, lookup);
    if (!destination) return { ok: false, kind: 'blocked' };
    const { url, addresses } = destination;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = fetcher === globalThis.fetch
        ? await pinnedHttpsRequest(url, addresses, controller.signal)
        : await fetcher(url.toString(), {
          headers: { Accept: 'text/markdown, text/plain;q=0.9' },
          redirect: 'manual',
          signal: controller.signal,
        });
    } catch {
      return { ok: false, kind: 'transport' };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status < 300 || response.status >= 400) return { ok: true, response };
    const location = response.headers.get('location');
    void response.body?.cancel().catch(() => {});
    if (!location) return { ok: true, response };
    current = new URL(location, url).toString();
  }
  return { ok: false, kind: 'blocked' };
}

export async function readBoundedText(response, maxBytes = 256 * 1024, timeoutMs = 12_000) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    void response.body?.cancel().catch(() => {});
    return { ok: false, reason: 'too-large' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { ok: false, reason: 'unreadable' };
  const chunks = [];
  let size = 0;
  let timer;
  try {
    const reading = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) return { ok: false, reason: 'too-large' };
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { ok: true, text: new TextDecoder().decode(bytes) };
    };
    const expired = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'unreadable' }), timeoutMs);
    });
    return await Promise.race([reading(), expired]);
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
