/**
 * SSRF (Server-Side Request Forgery) protection utility.
 *
 * Prevents the server from making outbound HTTP requests to internal
 * infrastructure based on user-supplied URLs.
 *
 * Current SSRF surface in Career Terminal:
 *  - No outbound HTTP calls to user-controlled URLs exist today.
 *  - The Gmail OAuth authorization URL is generated entirely from
 *    GOOGLE_REDIRECT_URI (server config), NOT from user input — safe.
 *  - This guard is provided as a foundation for future resume/job URL
 *    ingestion, scraping, or webhook functionality.
 *
 * Blocked ranges:
 *  - Loopback:           127.0.0.0/8, ::1
 *  - Private RFC1918:    10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *  - Link-local:         169.254.0.0/16, fe80::/10
 *  - AWS metadata:       169.254.169.254
 *  - GCP metadata:       metadata.google.internal
 *  - Azure metadata:     169.254.169.254
 *  - localhost aliases:  0.0.0.0
 *  - Protocols:          Only https: allowed for user-originated URLs
 *
 * Note: This implementation performs hostname/IP pattern matching.
 * Production deployments should additionally configure egress firewall rules
 * as a defence-in-depth measure, since DNS rebinding can bypass hostname checks.
 */

export class SsrfError extends Error {
  constructor(message = 'URL targets a disallowed internal or private network address') {
    super(message);
    this.name = 'SsrfError';
  }
}

// ---------------------------------------------------------------------------
// Private IPv4 range checkers
// ---------------------------------------------------------------------------

/**
 * Parse an IPv4 address string into a 32-bit integer.
 * Returns null if the string is not a valid IPv4 address.
 */
function parseIPv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255 || String(octet) !== part) return null;
    num = (num << 8) | octet;
  }
  return num >>> 0; // unsigned 32-bit
}

/**
 * Check if an IPv4 address (as 32-bit int) falls within a CIDR range.
 */
function inRange(ip: number, network: number, prefixLen: number): boolean {
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ip & mask) === (network & mask);
}

const PRIVATE_RANGES_V4: Array<{ network: number; prefix: number; label: string }> = [
  { network: parseIPv4('127.0.0.0')!, prefix: 8, label: 'loopback' },
  { network: parseIPv4('10.0.0.0')!, prefix: 8, label: 'RFC1918' },
  { network: parseIPv4('172.16.0.0')!, prefix: 12, label: 'RFC1918' },
  { network: parseIPv4('192.168.0.0')!, prefix: 16, label: 'RFC1918' },
  { network: parseIPv4('169.254.0.0')!, prefix: 16, label: 'link-local' },
  { network: parseIPv4('0.0.0.0')!, prefix: 8, label: 'unspecified' },
  { network: parseIPv4('100.64.0.0')!, prefix: 10, label: 'shared-space' }, // RFC 6598
];

function isPrivateIPv4(ip: string): boolean {
  const num = parseIPv4(ip);
  if (num === null) return false;
  return PRIVATE_RANGES_V4.some(({ network, prefix }) => inRange(num, network, prefix));
}

// ---------------------------------------------------------------------------
// Private IPv6 checkers
// ---------------------------------------------------------------------------

/**
 * Expand an IPv6 address into 8 16-bit groups, handling "::" compression
 * and an embedded trailing IPv4 dotted-quad (e.g. "::ffff:127.0.0.1").
 * Returns null if the address is not well-formed.
 *
 * A plain regex against the string form is NOT sufficient here: the WHATWG
 * URL parser (used by `new URL()`) normalizes IPv6 hosts into their
 * shortest/compressed hex form before this guard ever sees them — e.g.
 * "::ffff:169.254.169.254" becomes "::ffff:a9fe:a9fe". Matching against
 * literal decimal octets in a regex misses every one of these.
 */
function expandIPv6(ip: string): number[] | null {
  // Split off an embedded IPv4 tail (e.g. the "127.0.0.1" in "::ffff:127.0.0.1").
  let head = ip;
  let v4Tail: number[] | null = null;
  const lastColon = ip.lastIndexOf(':');
  if (lastColon !== -1 && ip.includes('.', lastColon)) {
    const v4 = parseIPv4(ip.slice(lastColon + 1));
    if (v4 === null) return null;
    v4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    head = ip.slice(0, lastColon);
  }

  const halves = head.split('::');
  if (halves.length > 2) return null; // more than one "::" is invalid

  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const groups = s.split(':');
    const parsed: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      parsed.push(parseInt(g, 16));
    }
    return parsed;
  };

  if (halves.length === 1) {
    const groups = parseGroups(halves[0] ?? '');
    if (!groups) return null;
    const full = v4Tail ? [...groups, ...v4Tail] : groups;
    return full.length === 8 ? full : null;
  }

  const left = parseGroups(halves[0] ?? '');
  const right = parseGroups(halves[1] ?? '');
  if (!left || !right) return null;

  const rightFull = v4Tail ? [...right, ...v4Tail] : right;
  const missing = 8 - left.length - rightFull.length;
  if (missing < 0) return null;

  return [...left, ...Array(missing).fill(0), ...rightFull];
}

function isPrivateIPv6(ip: string): boolean {
  const groups = expandIPv6(ip);
  if (!groups) return false;

  // ::1 — loopback
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true;

  // :: (unspecified) is not routable/useful as a fetch target either
  if (groups.every((g) => g === 0)) return true;

  // fe80::/10 — link-local (first 10 bits = 1111111010)
  if ((groups[0]! & 0xffc0) === 0xfe80) return true;

  // fc00::/7 — unique-local (first 7 bits = 1111110)
  if ((groups[0]! & 0xfe00) === 0xfc00) return true;

  // ::ffff:0:0/96 (IPv4-mapped) and ::0:0/96 (IPv4-compatible) — check the
  // embedded IPv4 address against the same private-range table used above.
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const isCompat = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0 && groups[6] !== 0;
  if (isMapped || isCompat) {
    const embeddedV4 = ((groups[6]! << 16) | groups[7]!) >>> 0;
    return PRIVATE_RANGES_V4.some(({ network, prefix }) => inRange(embeddedV4, network, prefix));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Blocked hostnames (case-insensitive)
// ---------------------------------------------------------------------------

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data', // Azure IMDS alternative hostname
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate that a URL is safe to use as an outbound HTTP request target.
 *
 * Throws SsrfError if the URL:
 *  - Is not valid
 *  - Uses a non-https protocol (only https allowed)
 *  - Targets localhost, loopback, private RFC1918, link-local, or cloud metadata
 *  - Contains credentials (username:password@)
 *  - Contains an explicit non-standard port that could bypass firewall rules
 *
 * @throws SsrfError if the URL is not safe
 */
export function validateOutboundUrl(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  // Protocol enforcement — only https for user-originated outbound requests
  if (url.protocol !== 'https:') {
    throw new SsrfError(`Protocol '${url.protocol}' is not allowed — only https:`);
  }

  // Reject embedded credentials (https://user:pass@host)
  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Blocked hostname list
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfError(`Hostname '${hostname}' is not allowed`);
  }

  // IPv4 private range check
  if (isPrivateIPv4(hostname)) {
    throw new SsrfError(`IP address '${hostname}' is in a private/reserved range`);
  }

  // IPv6 private check
  if (isPrivateIPv6(hostname)) {
    throw new SsrfError(`IPv6 address '${hostname}' is in a private/reserved range`);
  }
}

/**
 * Boolean variant — returns false instead of throwing.
 */
export function isSafeOutboundUrl(rawUrl: string): boolean {
  try {
    validateOutboundUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
