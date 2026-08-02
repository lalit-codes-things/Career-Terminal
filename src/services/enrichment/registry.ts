export interface EnrichmentProviderDefinition {
  id: string;
  name: string;
  description: string;
  priority: number;
  supportedCategories: string[];
}

export class EnrichmentProviderRegistry {
  private providers = new Map<string, EnrichmentProviderDefinition>();

  register(def: EnrichmentProviderDefinition) {
    if (this.providers.has(def.id)) {
      throw new Error(`Provider ${def.id} already registered`);
    }
    this.providers.set(def.id, def);
  }

  get(id: string) {
    return this.providers.get(id);
  }

  getAll() {
    return Array.from(this.providers.values());
  }
}

export const BUILT_IN_ENRICHMENT_CATEGORIES = [
  'Website', 'Description', 'Industry', 'Revenue', 'Employee Count', 
  'Technology Stack', 'Social Links', 'Compliance', 'Awards', 'Certifications'
];
