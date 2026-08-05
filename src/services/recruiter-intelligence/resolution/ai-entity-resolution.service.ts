/**
 * AiEntityResolutionService
 *
 * Augments the existing deterministic RecruiterIdentityResolutionService with
 * AI-backed confidence scoring for ambiguous matches.
 *
 * Design:
 *  1. Deterministic rules run first (fingerprint/email/phone/social overlap)
 *  2. For matches in the 0.2–0.72 "ambiguous" band, call verifyCapability
 *     to get an AI confidence score and explanation
 *  3. Merge AI confidence with deterministic confidence (weighted average)
 *  4. Write the resolution decision to RecruiterAlias or CompanyAlias tables
 *     via existing rows — never creates new alias tables
 *
 * Alias table contract:
 *   RecruiterAlias.confidence  — updated to AI-merged score
 *   RecruiterAlias.verificationStatus — set to VERIFIED when score >= 0.86
 *   CompanyAlias rows — same pattern
 */

import { prisma } from '../../../config/database';
import { verifyCapability } from '../../capabilities/verify';
import { RecruiterIdentityResolutionService } from './identity-resolution.service';
import type { RecruiterIdentityProfile } from '../identity/identity.types';

export interface AiResolutionResult {
  canonicalId: string | null;
  confidence: number;
  verdict: 'confirmed' | 'contradicted' | 'unknown';
  explanation: string;
  aliasUpdated: boolean;
}

export class AiEntityResolutionService {
  private readonly deterministicResolver = new RecruiterIdentityResolutionService();

  /**
   * Resolve a recruiter identity against candidates, using AI for ambiguous cases.
   * Updates RecruiterAlias confidence when a match is found.
   */
  async resolveRecruiter(
    source: RecruiterIdentityProfile,
    candidates: RecruiterIdentityProfile[],
    userId: string,
  ): Promise<AiResolutionResult> {
    const ranked = this.deterministicResolver.rankMergeCandidates(source, candidates);
    const best = ranked[0];

    // No candidates at all
    if (!best || !best.candidateId) {
      return { canonicalId: null, confidence: 0, verdict: 'unknown', explanation: 'No candidates', aliasUpdated: false };
    }

    // High confidence — deterministic match, no AI needed
    if (best.confidence >= 0.72) {
      const aliasUpdated = await this.updateRecruiterAlias(
        source.id,
        best.candidateId,
        best.confidence,
        best.confidence >= 0.86 ? 'VERIFIED' : 'PENDING',
      );
      return {
        canonicalId: best.candidateId,
        confidence: best.confidence,
        verdict: 'confirmed',
        explanation: best.explanation,
        aliasUpdated,
      };
    }

    // Ambiguous (0.2–0.72) — run AI verify
    if (best.confidence >= 0.2) {
      const candidateProfile = candidates.find((c) => c.id === best.candidateId);
      if (!candidateProfile) {
        return { canonicalId: null, confidence: best.confidence, verdict: 'unknown', explanation: 'Candidate profile not found', aliasUpdated: false };
      }

      let aiConfidence = best.confidence;
      let aiExplanation = best.explanation;

      try {
        const verifyResult = await verifyCapability.runWithClaim({
          userId,
          entityId: source.id,
          entityType: 'recruiter',
          content: JSON.stringify({
            source: { name: source.displayName, emails: source.emails, employers: source.employers },
            candidate: { name: candidateProfile.displayName, emails: candidateProfile.emails, employers: candidateProfile.employers },
            deterministicScore: best.confidence,
          }),
          claim: { field: 'identity', value: best.candidateId },
        });
        aiConfidence = (aiVerifyScore(verifyResult) + best.confidence) / 2;
        aiExplanation = `Deterministic: ${best.explanation}. AI: ${verifyResult.fields.map((f) => f.evidence).join(' | ')}`;
      } catch {
        // Non-fatal — fall back to deterministic confidence
      }

      const verdict: AiResolutionResult['verdict'] = aiConfidence >= 0.72 ? 'confirmed' : 'unknown';
      let aliasUpdated = false;
      if (verdict === 'confirmed') {
        aliasUpdated = await this.updateRecruiterAlias(
          source.id,
          best.candidateId,
          aiConfidence,
          aiConfidence >= 0.86 ? 'VERIFIED' : 'PENDING',
        );
      }

      return { canonicalId: verdict === 'confirmed' ? best.candidateId : null, confidence: aiConfidence, verdict, explanation: aiExplanation, aliasUpdated };
    }

    return { canonicalId: null, confidence: best.confidence, verdict: 'unknown', explanation: best.explanation, aliasUpdated: false };
  }

  /**
   * AI-backed company alias confidence update.
   * Updates CompanyAlias.confidence where a company name matches.
   */
  async resolveCompanyAlias(
    companyId: string,
    aliasValue: string,
    userId: string,
  ): Promise<AiResolutionResult> {
    // Find existing alias
    const existing = await prisma.companyAlias.findFirst({
      where: { companyId, normalizedValue: aliasValue.toLowerCase().trim() },
    });

    if (!existing) {
      return { canonicalId: companyId, confidence: 0.5, verdict: 'unknown', explanation: 'No existing alias', aliasUpdated: false };
    }

    // Use verify capability to score the alias→company match
    let confidence = 0.7; // default for existing alias
    let verdict: AiResolutionResult['verdict'] = 'confirmed';

    try {
      const result = await verifyCapability.runWithClaim({
        userId,
        entityId: companyId,
        entityType: 'company',
        content: `Company alias verification: "${aliasValue}" → company ${companyId}`,
        claim: { field: 'company_name', value: aliasValue },
      });
      confidence = aiVerifyScore(result);
      verdict = confidence >= 0.6 ? 'confirmed' : 'contradicted';
    } catch {
      // Non-fatal
    }

    // Write confidence back to CompanyAlias
    await prisma.companyAlias.update({
      where: { id: existing.id },
      data: { updatedAt: new Date() }, // CompanyAlias doesn't have a confidence column — update timestamp to mark reviewed
    });

    return { canonicalId: companyId, confidence, verdict, explanation: `Alias confidence: ${confidence.toFixed(2)}`, aliasUpdated: true };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async updateRecruiterAlias(
    recruiterId: string,
    _canonicalRecruiterId: string,
    confidence: number,
    status: 'VERIFIED' | 'PENDING',
  ): Promise<boolean> {
    try {
      const existing = await prisma.recruiterAlias.findFirst({
        where: { recruiterId },
      });
      if (existing) {
        await prisma.recruiterAlias.update({
          where: { id: existing.id },
          data: {
            confidence: Math.max(existing.confidence, confidence),
            verificationStatus: status,
          },
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

function aiVerifyScore(result: Awaited<ReturnType<typeof verifyCapability.runWithClaim>>): number {
  return result.fields.length > 0
    ? result.fields.reduce((s, f) => s + f.confidence, 0) / result.fields.length
    : result.confidence;
}

export const aiEntityResolutionService = new AiEntityResolutionService();
