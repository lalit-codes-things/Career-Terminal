export interface OpportunityTypeDefinition {
  id: string;
  name: string;
  description: string;
  requiresCompany: boolean;
  defaultConfidence: number;
}

export class OpportunityTypeRegistry {
  private types = new Map<string, OpportunityTypeDefinition>();

  register(def: OpportunityTypeDefinition): void {
    if (this.types.has(def.id)) {
      throw new Error(`OpportunityType '${def.id}' is already registered`);
    }
    this.types.set(def.id, def);
  }

  get(id: string): OpportunityTypeDefinition | undefined {
    return this.types.get(id);
  }

  getAll(): OpportunityTypeDefinition[] {
    return Array.from(this.types.values());
  }
}

export const BUILT_IN_OPPORTUNITY_TYPES: OpportunityTypeDefinition[] = [
  {
    id: 'external_job',
    name: 'External Job',
    description: 'Publicly posted job from an external source',
    requiresCompany: false,
    defaultConfidence: 0.85
  },
  {
    id: 'referral',
    name: 'Referral',
    description: 'Opportunity sourced via employee referral',
    requiresCompany: true,
    defaultConfidence: 0.95
  },
  {
    id: 'campus_hiring',
    name: 'Campus Hiring',
    description: 'University or educational institution hiring program',
    requiresCompany: true,
    defaultConfidence: 0.9
  },
  {
    id: 'recruiter_outreach',
    name: 'Recruiter Outreach',
    description: 'Direct contact initiated by a recruiter',
    requiresCompany: false,
    defaultConfidence: 0.8
  },
  {
    id: 'internal_opportunity',
    name: 'Internal Opportunity',
    description: 'Role opened within the candidate\'s current organization',
    requiresCompany: true,
    defaultConfidence: 1.0
  }
];
