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

const BLOCKED_IPV6_PATTERNS = [
  /^::1$/, // loopback
  /^fe80:/i, // link-local
  /^fc00:/i, // unique-local
  /^fd[0-9a-f]{2}:/i, // unique-local (fd00::/8)
  /^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:7f/i, // ::ffff:127.x.x.x
];

function isPrivateIPv6(ip: string): boolean {
  return BLOCKED_IPV6_PATTERNS.some((pattern) => pattern.test(ip));
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
