/**
 * Utility functions for parsing Gmail API responses.
 *
 * These helpers extract structured data from the raw Gmail API
 * message format (nested parts, base64 bodies, headers as arrays).
 */
import type { gmail_v1 } from 'googleapis';
import type { EmailRecipients } from '../models/gmail.types';

/**
 * Extracts a specific header value from a Gmail message's headers array.
 *
 * @param headers - The message headers array from the Gmail API
 * @param name - The header name (case-insensitive)
 * @returns The header value, or empty string if not found
 */
export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string {
  if (!headers) return '';
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? '';
}

/**
 * Parses recipient headers (To, Cc, Bcc) into a structured object.
 *
 * @param headers - The message headers array
 * @returns Structured recipients with to/cc/bcc arrays
 */
export function parseRecipients(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
): EmailRecipients {
  return {
    to: parseAddressList(getHeader(headers, 'To')),
    cc: parseAddressList(getHeader(headers, 'Cc')),
    bcc: parseAddressList(getHeader(headers, 'Bcc')),
  };
}

/**
 * Splits a comma-separated email address list into individual addresses.
 * Handles formats like "Name <email@example.com>, other@example.com".
 *
 * @param addressList - Raw comma-separated address string
 * @returns Array of trimmed address strings
 */
export function parseAddressList(addressList: string): string[] {
  if (!addressList) return [];
  return addressList
    .split(',')
    .map((addr) => addr.trim())
    .filter((addr) => addr.length > 0);
}

/**
 * Extracts the plain text body from a Gmail message payload.
 * Handles both simple and multipart message structures.
 *
 * @param payload - The message payload from the Gmail API
 * @returns Decoded plain text body, or undefined if not found
 */
export function extractBodyText(
  payload: gmail_v1.Schema$MessagePart | undefined,
): string | undefined {
  return extractBodyByMimeType(payload, 'text/plain');
}

/**
 * Extracts the HTML body from a Gmail message payload.
 *
 * @param payload - The message payload from the Gmail API
 * @returns Decoded HTML body, or undefined if not found
 */
export function extractBodyHtml(
  payload: gmail_v1.Schema$MessagePart | undefined,
): string | undefined {
  return extractBodyByMimeType(payload, 'text/html');
}

/**
 * Recursively searches the message payload tree for a part with
 * the specified MIME type and returns its decoded body.
 */
function extractBodyByMimeType(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: string,
): string | undefined {
  if (!part) return undefined;

  // Direct match
  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  // Recurse into multipart children
  if (part.parts) {
    for (const child of part.parts) {
      const result = extractBodyByMimeType(child, mimeType);
      if (result) return result;
    }
  }

  return undefined;
}

/**
 * Decodes a base64url-encoded string (as used by Gmail API).
 * Gmail uses URL-safe base64 encoding (- instead of +, _ instead of /).
 *
 * @param data - Base64url-encoded string
 * @returns Decoded UTF-8 string
 */
export function decodeBase64Url(data: string): string {
  // Convert base64url to standard base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

/**
 * Checks whether a Gmail message payload contains attachments.
 *
 * @param payload - The message payload
 * @returns true if the message has at least one attachment
 */
export function hasAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined,
): boolean {
  if (!payload) return false;

  if (payload.filename && payload.filename.length > 0 && payload.body?.attachmentId) {
    return true;
  }

  if (payload.parts) {
    return payload.parts.some((part) => hasAttachments(part));
  }

  return false;
}

/**
 * Parses an RFC 2822 date string into a Date object.
 * Falls back to current time if parsing fails.
 *
 * @param dateStr - The date string from the email header
 * @returns Parsed Date object
 */
export function parseEmailDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}
