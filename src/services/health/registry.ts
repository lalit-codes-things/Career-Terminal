export interface HealthIndicatorDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  weight: number; // Weight in overall health score (0-1)
}

export class HealthIndicatorRegistry {
  private indicators = new Map<string, HealthIndicatorDefinition>();

  register(def: HealthIndicatorDefinition) {
    if (this.indicators.has(def.id)) {
      throw new Error(`HealthIndicator ${def.id} already registered`);
    }
    this.indicators.set(def.id, def);
  }

  get(id: string) {
    return this.indicators.get(id);
  }

  getAll() {
    return Array.from(this.indicators.values());
  }
}

export const BUILT_IN_HEALTH_INDICATORS: HealthIndicatorDefinition[] = [
  { id: 'financial_health', name: 'Financial Health', description: 'Revenue and funding stability', version: '1.0', weight: 0.3 },
  { id: 'operational_health', name: 'Operational Health', description: 'Employee growth and retention', version: '1.0', weight: 0.2 },
  { id: 'corporate_activity', name: 'Corporate Activity', description: 'M&A and structural changes', version: '1.0', weight: 0.15 },
  { id: 'regulatory_activity', name: 'Regulatory Activity', description: 'Compliance and regulatory events', version: '1.0', weight: 0.15 },
  { id: 'public_presence', name: 'Public Presence', description: 'Brand and social visibility', version: '1.0', weight: 0.1 },
  { id: 'data_freshness', name: 'Data Freshness', description: 'Recency of data updates', version: '1.0', weight: 0.1 }
];
