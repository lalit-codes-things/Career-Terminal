/**
 * recommend capability
 *
 * Generates actionable candidate-facing recommendations: when to follow up,
 * what angle to take, how to tailor application materials.
 * Uses the insights-engine template.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName } from './types';

export class RecommendCapability extends CapabilityBase {
  readonly name: CapabilityName = 'recommend';

  protected defaultTemplateId(): string {
    return 'recruiter-insights-engine';
  }
}

export const recommendCapability = new RecommendCapability();
