import { Opportunity, OpportunityVersion } from './model';
import { OpportunityTypeRegistry } from './registry';

export interface ValidationError {
  field: string;
  message: string;
}

export interface IntelligenceResult {
  opportunityId: string;
  isValid: boolean;
  errors: ValidationError[];
  confidence: number;
  explanation: string;
  evaluatedAt: Date;
}

export class OpportunityIntelligenceEngine {
  constructor(private registry: OpportunityTypeRegistry) {}

  // ─── Validation ──────────────────────────────────────────────────────────────

  public validate(opportunity: Opportunity): IntelligenceResult {
    const errors: ValidationError[] = [];
    const typeDef = this.registry.get(opportunity.opportunityTypeId);

    if (!typeDef) {
      errors.push({ field: 'opportunityTypeId', message: `Unknown opportunity type: '${opportunity.opportunityTypeId}'` });
    } else {
      if (typeDef.requiresCompany && !opportunity.companyId && !opportunity.companyName) {
        errors.push({ field: 'companyId', message: `Opportunity type '${typeDef.name}' requires a company reference` });
      }
    }

    if (!opportunity.title?.trim()) {
      errors.push({ field: 'title', message: 'Title is required' });
    }

    if (opportunity.confidence < 0 || opportunity.confidence > 1) {
      errors.push({ field: 'confidence', message: 'Confidence must be between 0 and 1' });
    }

    if (!opportunity.location?.countryCode || opportunity.location.countryCode.length !== 2) {
      errors.push({ field: 'location.countryCode', message: 'Valid ISO 3166-1 alpha-2 country code required' });
    }

    if (opportunity.validTo && opportunity.validTo < opportunity.validFrom) {
      errors.push({ field: 'validTo', message: 'validTo must be after validFrom' });
    }

    const isValid = errors.length === 0;
    const explanation = this.buildExplanation(opportunity, errors, typeDef?.name);

    return {
      opportunityId: opportunity.id,
      isValid,
      errors,
      confidence: isValid ? opportunity.confidence : 0,
      explanation,
      evaluatedAt: new Date()
    };
  }

  // ─── Versioning ───────────────────────────────────────────────────────────────

  public applyUpdate(
    existing: Opportunity,
    patch: Partial<Opportunity>,
    changedBy: string
  ): Opportunity {
    const snapshot: Partial<Opportunity> = {};
    for (const key of Object.keys(patch) as (keyof Opportunity)[]) {
      (snapshot as any)[key] = (existing as any)[key];
    }

    const version: OpportunityVersion = {
      version: existing.currentVersion,
      changedAt: new Date(),
      changedBy,
      snapshot
    };

    return {
      ...existing,
      ...patch,
      currentVersion: existing.currentVersion + 1,
      versions: [...existing.versions, version]
    };
  }

  // ─── Explainability ──────────────────────────────────────────────────────────

  private buildExplanation(
    opportunity: Opportunity,
    errors: ValidationError[],
    typeName?: string
  ): string {
    const parts: string[] = [];

    if (typeName) {
      parts.push(`Evaluated as opportunity type '${typeName}'.`);
    }

    parts.push(`Source: ${opportunity.source}.`);
    parts.push(`Confidence: ${(opportunity.confidence * 100).toFixed(0)}%.`);
    parts.push(`Remote model: ${opportunity.location.remoteModel}.`);
    parts.push(`Employment type: ${opportunity.employmentType}.`);
    parts.push(`Provenance: collected by '${opportunity.provenance.provider}' on ${opportunity.provenance.collectedAt.toISOString()}.`);

    if (errors.length > 0) {
      parts.push(`Validation failed with ${errors.length} error(s): ${errors.map(e => e.message).join('; ')}.`);
    } else {
      parts.push('Validation passed.');
    }

    return parts.join(' ');
  }
}
