/**
 * infer capability
 *
 * Derives hidden attributes (seniority, specialization, decision authority,
 * urgency, hiring focus) from structured facts.  Uses the reasoning-enrichment
 * template.  Always writes to Prediction; writes RecruiterFact when entity is
 * 'recruiter'.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName } from './types';

export class InferCapability extends CapabilityBase {
  readonly name: CapabilityName = 'infer';

  protected defaultTemplateId(): string {
    return 'recruiter-reasoning-enrichment';
  }
}

export const inferCapability = new InferCapability();
