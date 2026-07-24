/**
 * Known Applicant Tracking System (ATS) sender domains and subdomains.
 */
export const ATS_PLATFORM_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'workday.com',
  'myworkdayjobs.com',
  'icims.com',
  'smartrecruiters.com',
  'ashbyhq.com',
  'jobvite.com',
  'breezy.hr',
  'recruitee.com',
  'taleo.net',
  'successfactors.com',
  'brassring.com',
  'jazz.co',
  'jazzhr.com',
  'comeet.co',
  'comeet.com',
  'bamboohr.com',
  'paylocity.com',
  'ultipro.com',
  'eightfold.ai',
  'hirevue.com',
  'codility.com',
  'hackerrank.com',
  'testgorilla.com',
  'criteria.com',
];

/** Returns true when the email domain belongs to a known ATS platform. */
export function isAtsPlatformDomain(domain: string): boolean {
  const normalized = domain.toLowerCase();
  return ATS_PLATFORM_DOMAINS.some(
    (atsDomain) => normalized === atsDomain || normalized.endsWith(`.${atsDomain}`),
  );
}
