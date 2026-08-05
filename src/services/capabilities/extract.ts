/**
 * extract capability
 *
 * Pulls structured entities (name, title, org, skills, technologies, interview
 * stage, compensation) out of raw text.  Uses the entity-extraction template.
 */

import { CapabilityBase } from './capability.base';
import type { CapabilityName } from './types';

export class ExtractCapability extends CapabilityBase {
  readonly name: CapabilityName = 'extract';

  protected defaultTemplateId(): string {
    return 'recruiter-entity-extraction';
  }
}

export const extractCapability = new ExtractCapability();
