/**
 * predict capability
 *
 * Produces probability scores for future outcomes (interview likelihood,
 * offer probability, response rate, ghosting risk).  Uses the decision-
 * intelligence template.  Output is always persisted to Prediction.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName } from './types';

export class PredictCapability extends CapabilityBase {
  readonly name: CapabilityName = 'predict';

  protected defaultTemplateId(): string {
    return 'recruiter-decision-intelligence';
  }
}

export const predictCapability = new PredictCapability();
