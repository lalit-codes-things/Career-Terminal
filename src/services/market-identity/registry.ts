export interface IdentifierTypeDefinition {
  id: string;
  name: string;
  description: string;
}

export class IdentifierRegistry {
  private types = new Map<string, IdentifierTypeDefinition>();

  register(def: IdentifierTypeDefinition) {
    if (this.types.has(def.id)) {
      throw new Error(`Identifier type ${def.id} already registered`);
    }
    this.types.set(def.id, def);
  }

  get(id: string) {
    return this.types.get(id);
  }

  getAll() {
    return Array.from(this.types.values());
  }
}

export const BUILT_IN_IDENTIFIERS: IdentifierTypeDefinition[] = [
  { id: 'cik', name: 'CIK', description: 'Central Index Key' },
  { id: 'lei', name: 'LEI', description: 'Legal Entity Identifier' },
  { id: 'isin', name: 'ISIN', description: 'International Securities Identification Number' },
  { id: 'cusip', name: 'CUSIP', description: 'Committee on Uniform Securities Identification Procedures' },
  { id: 'sedol', name: 'SEDOL', description: 'Stock Exchange Daily Official List' },
  { id: 'figi', name: 'FIGI', description: 'Financial Instrument Global Identifier' },
  { id: 'ticker', name: 'Ticker', description: 'Trading Symbol' },
  { id: 'ric', name: 'RIC', description: 'Reuters Instrument Code' }
];
