/**
 * Sender-based detection patterns for job-related emails.
 */

/** Local-parts commonly used by recruiting teams. */
export const RECRUITER_LOCAL_PARTS: readonly string[] = [
  'recruiting',
  'recruiter',
  'talent',
  'careers',
  'jobs',
  'hiring',
  'hr',
  'people',
  'staffing',
  'campusrecruiting',
  'universityrecruiting',
];

/** Generic noreply addresses often used by ATS systems. */
export const ATS_NOREPLY_LOCAL_PARTS: readonly string[] = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'notifications',
  'mailer',
];

export interface ParsedSender {
  email: string;
  localPart: string;
  domain: string;
}

/** Parses "Name <email@domain.com>" or plain email addresses. */
export function parseSender(sender: string): ParsedSender | null {
  const trimmed = sender.trim();
  const bracketMatch = /<([^>]+)>/.exec(trimmed);
  const email = (bracketMatch?.[1] ?? trimmed).trim().toLowerCase();
  const atIndex = email.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === email.length - 1) {
    return null;
  }

  return {
    email,
    localPart: email.slice(0, atIndex),
    domain: email.slice(atIndex + 1),
  };
}

export function isRecruiterSender(parsed: ParsedSender): boolean {
  const local = parsed.localPart.replace(/[._+-]/g, '');
  return RECRUITER_LOCAL_PARTS.some(
    (part) => local === part || local.startsWith(part) || local.includes(part),
  );
}

export function isAtsNoreplySender(parsed: ParsedSender): boolean {
  return ATS_NOREPLY_LOCAL_PARTS.some((part) => parsed.localPart.startsWith(part));
}
