export interface AuthenticityRuleDefinition {
  id: string;
  name: string;
  description: string;
  weight: number; // Importance of this rule
}

export class AuthenticityRuleRegistry {
  private rules = new Map<string, AuthenticityRuleDefinition>();

  register(def: AuthenticityRuleDefinition) {
    if (this.rules.has(def.id)) {
      throw new Error(`AuthenticityRule ${def.id} already registered`);
    }
    this.rules.set(def.id, def);
  }

  get(id: string) {
    return this.rules.get(id);
  }

  getAll() {
    return Array.from(this.rules.values());
  }
}

export const BUILT_IN_AUTHENTICITY_RULES: AuthenticityRuleDefinition[] = [
  { id: 'identity_consistency', name: 'Identity Consistency', description: 'Names and identifiers match across sources', weight: 0.25 },
  { id: 'provider_agreement', name: 'Provider Agreement', description: 'Multiple providers report the same core data', weight: 0.25 },
  { id: 'registration_status', name: 'Registration Status', description: 'Active status in official registries', weight: 0.2 },
  { id: 'corporate_activity', name: 'Corporate Activity', description: 'Presence of recent corporate filings', weight: 0.15 },
  { id: 'listing_consistency', name: 'Listing Consistency', description: 'Consistency of public listings', weight: 0.15 }
];
