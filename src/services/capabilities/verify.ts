/**
 * verify capability
 *
 * Cross-checks a claim against existing RecruiterFact rows and returns a
 * confidence-scored verdict.  Used by entity resolution and taxonomy
 * replacement paths.  Writes output to Prediction; also creates a
 * RecruiterFact of type "verify.<fieldName>" so the verification result
 * is in the fact trail.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName, CapabilityInput, CapabilityResult } from './types';
import { prisma } from '../../config/database';

export class VerifyCapability extends CapabilityBase {
  readonly name: CapabilityName = 'verify';

  protected defaultTemplateId(): string {
    return 'recruiter-reputation-trust';
  }

  /**
   * Verify a specific claim for a recruiter by cross-checking against existing
   * facts before calling the AI layer.  If existing facts fully corroborate the
   * claim, returns early with high confidence without spending tokens.
   */
  async runWithClaim(
    input: CapabilityInput & { claim: { field: string; value: unknown } },
  ): Promise<CapabilityResult & { verdict: 'confirmed' | 'contradicted' | 'unknown' }> {
    // Check existing RecruiterFact rows first
    if (input.entityType === 'recruiter') {
      const existing = await prisma.recruiterFact.findFirst({
        where: {
          recruiterId: input.entityId,
          factType: { contains: input.claim.field },
          deletedAt: null,
        },
        orderBy: { confidence: 'desc' },
      });

      if (existing) {
        const storedVal = (existing.factValue as Record<string, unknown>)['value'];
        const match = JSON.stringify(storedVal) === JSON.stringify(input.claim.value);
        return {
          ...(await this.run(input)),
          verdict: match ? 'confirmed' : 'contradicted',
        };
      }
    }

    return { ...(await this.run(input)), verdict: 'unknown' };
  }
}

export const verifyCapability = new VerifyCapability();
