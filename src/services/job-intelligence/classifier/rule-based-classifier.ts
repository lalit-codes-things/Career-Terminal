/**
 * Rule-based job email classifier.
 *
 * Scores each category using keyword matches and sender signals, then selects
 * the highest-scoring category. Designed to be replaced or augmented by an ML
 * model via JobEmailClassifier.
 */
import {
  JobEmailCategory,
  type ClassifiableEmail,
  type RuleClassificationResult,
} from '../models/job-intelligence.types';
import { extractCompany } from './extractors/company.extractor';
import { extractRole } from './extractors/role.extractor';
import { isAtsPlatformDomain } from './signals/ats-platforms';
import {
  CATEGORY_KEYWORD_RULES,
  SENDER_CATEGORY_BOOSTS,
} from './signals/keyword-patterns';
import {
  isAtsNoreplySender,
  isRecruiterSender,
  parseSender,
} from './signals/sender-patterns';

const ALL_CATEGORIES = Object.values(JobEmailCategory);

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSearchText(email: ClassifiableEmail): string {
  const textBody = email.bodyText?.trim() ?? '';
  const htmlBody = email.bodyHtml ? stripHtml(email.bodyHtml) : '';
  const body = textBody || htmlBody;
  return `${email.subject}\n${body}`.toLowerCase();
}

function initScores(): Record<JobEmailCategory, number> {
  return ALL_CATEGORIES.reduce<Record<JobEmailCategory, number>>(
    (acc, category) => {
      acc[category] = 0;
      return acc;
    },
    {} as Record<JobEmailCategory, number>
  );
}

function applyKeywordRules(
  searchText: string,
  scores: Record<JobEmailCategory, number>,
  matchedSignals: string[]
): void {
  for (const rule of CATEGORY_KEYWORD_RULES) {
    for (const pattern of rule.patterns) {
      if (searchText.includes(pattern.toLowerCase())) {
        scores[rule.category] += rule.weight;
        matchedSignals.push(`keyword:${pattern}`);
      }
    }
  }
}

function applySenderSignals(
  sender: string,
  scores: Record<JobEmailCategory, number>,
  matchedSignals: string[]
): void {
  const parsed = parseSender(sender);
  if (!parsed) {
    return;
  }

  const fromAts = isAtsPlatformDomain(parsed.domain);
  const fromRecruiter = isRecruiterSender(parsed);
  const fromAtsNoreply = isAtsNoreplySender(parsed);

  if (fromAts || fromAtsNoreply) {
    scores[JobEmailCategory.JOB_APPLICATION] =
      (scores[JobEmailCategory.JOB_APPLICATION] ?? 0) + 0.25;
    scores[JobEmailCategory.INTERVIEW_INVITATION] =
      (scores[JobEmailCategory.INTERVIEW_INVITATION] ?? 0) + 0.2;
    scores[JobEmailCategory.ASSESSMENT_TEST] =
      (scores[JobEmailCategory.ASSESSMENT_TEST] ?? 0) + 0.2;
    scores[JobEmailCategory.REJECTION] =
      (scores[JobEmailCategory.REJECTION] ?? 0) + 0.15;
    scores[JobEmailCategory.OFFER] = (scores[JobEmailCategory.OFFER] ?? 0) + 0.15;
    matchedSignals.push(`sender:ats:${parsed.domain}`);
  }

  if (fromRecruiter) {
    scores[JobEmailCategory.RECRUITER_OUTREACH] =
      (scores[JobEmailCategory.RECRUITER_OUTREACH] ?? 0) + 0.35;
    scores[JobEmailCategory.INTERVIEW_INVITATION] =
      (scores[JobEmailCategory.INTERVIEW_INVITATION] ?? 0) + 0.1;
    matchedSignals.push(`sender:recruiter:${parsed.localPart}`);
  }

  if (fromAts || fromRecruiter || fromAtsNoreply) {
    for (const [category, boost] of Object.entries(SENDER_CATEGORY_BOOSTS)) {
      const typedCategory = category as JobEmailCategory;
      scores[typedCategory] = (scores[typedCategory] ?? 0) + (boost ?? 0);
    }
  }
}

function resolveCategory(
  scores: Record<JobEmailCategory, number>
): JobEmailCategory {
  let bestCategory = JobEmailCategory.NOT_JOB_RELATED;
  let bestScore = 0;

  for (const category of ALL_CATEGORIES) {
    if (category === JobEmailCategory.NOT_JOB_RELATED) {
      continue;
    }
    const score = scores[category] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  if (bestScore < 0.35) {
    return JobEmailCategory.NOT_JOB_RELATED;
  }

  return bestCategory;
}

function scoreToConfidence(
  category: JobEmailCategory,
  score: number,
  signalCount: number
): number {
  if (category === JobEmailCategory.NOT_JOB_RELATED) {
    return Math.max(0.5, Math.min(0.85, 0.55 + signalCount * 0.02));
  }

  const normalized = Math.min(score / 1.5, 1);
  const signalBoost = Math.min(signalCount * 0.04, 0.15);
  return Math.max(0.35, Math.min(0.98, normalized * 0.75 + signalBoost + 0.15));
}

export class RuleBasedJobEmailClassifier {
  classify(email: ClassifiableEmail): RuleClassificationResult {
    const searchText = buildSearchText(email);
    const scores = initScores();
    const matchedSignals: string[] = [];

    applyKeywordRules(searchText, scores, matchedSignals);
    applySenderSignals(email.sender, scores, matchedSignals);

    const category = resolveCategory(scores);
    const winningScore =
      category === JobEmailCategory.NOT_JOB_RELATED ? 0 : (scores[category] ?? 0);

    return {
      category,
      confidence: scoreToConfidence(category, winningScore, matchedSignals.length),
      matchedSignals,
    };
  }

  /** Convenience helper that also extracts company and role entities. */
  classifyWithEntities(email: ClassifiableEmail): {
    result: RuleClassificationResult;
    detectedCompany: string | null;
    detectedRole: string | null;
  } {
    const result = this.classify(email);
    const body =
      email.bodyText?.trim() ??
      (email.bodyHtml ? stripHtml(email.bodyHtml) : '');

    return {
      result,
      detectedCompany: extractCompany(email.sender, email.subject, body),
      detectedRole: extractRole(email.subject, body),
    };
  }
}

export const ruleBasedJobEmailClassifier = new RuleBasedJobEmailClassifier();
