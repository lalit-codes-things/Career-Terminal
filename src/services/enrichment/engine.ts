import { EnrichmentRecord } from './model';
import { EnrichmentProviderRegistry } from './registry';
import { CompanyDataStorage } from '../company-intelligence/storage/storage.types';

export class EnrichmentEngine {
  constructor(
    private registry: EnrichmentProviderRegistry,
    private storage: CompanyDataStorage,
    private redis: any
  ) {}

  public validate(record: EnrichmentRecord): void {
    const providerDef = this.registry.get(record.provider);
    if (!providerDef) {
      throw new Error(`Unknown provider: ${record.provider}`);
    }
    if (!providerDef.supportedCategories.includes(record.category)) {
      throw new Error(`Provider ${record.provider} does not support category ${record.category}`);
    }
    if (record.confidence < 0 || record.confidence > 1) {
      throw new Error('Confidence must be between 0 and 1');
    }
  }

  public resolveConflict(records: EnrichmentRecord[]): EnrichmentRecord | undefined {
    if (records.length === 0) return undefined;
    
    return records.sort((a, b) => {
      const pA = this.registry.get(a.provider)?.priority ?? 0;
      const pB = this.registry.get(b.provider)?.priority ?? 0;
      if (pA !== pB) return pB - pA;
      
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      
      return b.validFrom.getTime() - a.validFrom.getTime();
    })[0];
  }

  public async cacheEnrichment(entityId: string, resolvedRecords: EnrichmentRecord[]): Promise<void> {
    if (this.redis) {
      await this.redis.set(`enrichment:${entityId}`, JSON.stringify(resolvedRecords), 'EX', 3600);
    }
  }

  public async storeHistory(entityId: string, records: EnrichmentRecord[]): Promise<void> {
    const uri = `enrichment/${entityId}/history.json`;
    let existing: EnrichmentRecord[] = [];
    if (await this.storage.exists(uri)) {
      const data = await this.storage.readText(uri);
      existing = JSON.parse(data);
    }
    existing.push(...records);
    await this.storage.write(uri, JSON.stringify(existing));
  }
}
