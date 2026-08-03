import type { RecruiterIdentityProfile } from '../identity/identity.types';

export type ResolutionDecisionType =
  'exact_match' | 'normalized_match' | 'fuzzy_match' | 'duplicate_candidate' | 'human_review';

export interface AiIdentityResolutionAdapter {
  explainAmbiguousMatch(input: {
    source: RecruiterIdentityProfile;
    candidate: RecruiterIdentityProfile;
    deterministicScore: number;
  }): Promise<{ confidence: number; explanation: string }>;
}

export interface IdentityResolutionDecision {
  type: ResolutionDecisionType;
  sourceId: string;
  candidateId?: string;
  confidence: number;
  explanation: string;
  requiresHumanReview: boolean;
  evidence: string[];
}

function jaccard(left: string[], right: string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((item) => b.has(item)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function tokenSimilarity(left: string, right: string): number {
  return jaccard(left.split(' '), right.split(' '));
}

export class RecruiterIdentityResolutionService {
  constructor(private readonly ai?: AiIdentityResolutionAdapter) {}

  async resolve(
    source: RecruiterIdentityProfile,
    candidates: RecruiterIdentityProfile[],
  ): Promise<IdentityResolutionDecision> {
    const ranked = this.rankMergeCandidates(source, candidates);
    const best = ranked[0];

    if (!best) {
      return {
        type: 'human_review',
        sourceId: source.id,
        confidence: 0,
        explanation: 'No existing candidate identity was available for comparison.',
        requiresHumanReview: true,
        evidence: [],
      };
    }

    if (best.confidence >= 0.98)
      return { ...best, type: 'exact_match', requiresHumanReview: false };
    if (best.confidence >= 0.9)
      return { ...best, type: 'normalized_match', requiresHumanReview: false };
    if (best.confidence >= 0.72)
      return { ...best, type: 'fuzzy_match', requiresHumanReview: false };

    if (best.confidence >= 0.2 && this.ai) {
      const ai = await this.ai.explainAmbiguousMatch({
        source,
        candidate: bestCandidate(best, candidates),
        deterministicScore: best.confidence,
      });
      return {
        ...best,
        type: ai.confidence >= 0.72 ? 'duplicate_candidate' : 'human_review',
        confidence: Number(((best.confidence + ai.confidence) / 2).toFixed(4)),
        explanation: `${best.explanation} AI enrichment: ${ai.explanation}`,
        requiresHumanReview: ai.confidence < 0.86,
      };
    }

    return { ...best, type: 'human_review', requiresHumanReview: true };
  }

  rankMergeCandidates(
    source: RecruiterIdentityProfile,
    candidates: RecruiterIdentityProfile[],
  ): IdentityResolutionDecision[] {
    return candidates
      .filter((candidate) => candidate.id !== source.id && candidate.lifecycleState !== 'retired')
      .map((candidate) => this.scoreCandidate(source, candidate))
      .sort((a, b) => b.confidence - a.confidence);
  }

  private scoreCandidate(
    source: RecruiterIdentityProfile,
    candidate: RecruiterIdentityProfile,
  ): IdentityResolutionDecision {
    const sharedFingerprints = source.fingerprints.filter((fingerprint) =>
      candidate.fingerprints.includes(fingerprint),
    );
    const emailOverlap = jaccard(source.emails, candidate.emails);
    const phoneOverlap = jaccard(source.phones, candidate.phones);
    const socialOverlap = jaccard(source.socialProfiles, candidate.socialProfiles);
    const employerOverlap = jaccard(source.employers, candidate.employers);
    const nameScore = tokenSimilarity(source.normalizedName, candidate.normalizedName);
    const confidence = Math.min(
      0.99,
      Number(
        Math.max(
          sharedFingerprints.length ? 0.98 : 0,
          emailOverlap,
          phoneOverlap * 0.95,
          socialOverlap * 0.92,
          nameScore * 0.68 + employerOverlap * 0.22,
        ).toFixed(4),
      ),
    );
    const evidence = [
      sharedFingerprints.length ? `${sharedFingerprints.length} shared fingerprint(s)` : '',
      emailOverlap ? 'email overlap' : '',
      phoneOverlap ? 'phone overlap' : '',
      socialOverlap ? 'social profile overlap' : '',
      employerOverlap ? 'employer overlap' : '',
      nameScore ? `name similarity ${nameScore.toFixed(2)}` : '',
    ].filter(Boolean);

    return {
      type: confidence >= 0.72 ? 'duplicate_candidate' : 'human_review',
      sourceId: source.id,
      candidateId: candidate.id,
      confidence,
      explanation: evidence.length
        ? evidence.join('; ')
        : 'No deterministic identity overlap detected.',
      requiresHumanReview: confidence < 0.72,
      evidence,
    };
  }
}

function bestCandidate(
  decision: IdentityResolutionDecision,
  candidates: RecruiterIdentityProfile[],
): RecruiterIdentityProfile {
  const candidate = candidates.find((item) => item.id === decision.candidateId);
  if (!candidate) throw new Error('Resolution candidate disappeared during AI enrichment');
  return candidate;
}
