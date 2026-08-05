/**
 * understand capability
 *
 * Extracts high-level intent, context, and metadata from a piece of content
 * (email thread, job description, document) without making deep factual claims.
 * Writes output to Prediction; writes RecruiterFact when entity is 'recruiter'.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName } from './types';

export class UnderstandCapability extends CapabilityBase {
  readonly name: CapabilityName = 'understand';

  protected defaultTemplateId(): string {
    return 'recruiter-insights-engine';
  }
}

export const understandCapability = new UnderstandCapability();
