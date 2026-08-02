export interface RelationshipTypeDefinition {
  id: string;
  name: string;
  description: string;
  directed: boolean;
}

export class RelationshipRegistry {
  private types = new Map<string, RelationshipTypeDefinition>();

  register(def: RelationshipTypeDefinition) {
    if (this.types.has(def.id)) {
      throw new Error(`RelationshipType ${def.id} already registered`);
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

export const BUILT_IN_RELATIONSHIPS: RelationshipTypeDefinition[] = [
  { id: 'parent', name: 'Parent', description: 'Parent company', directed: true },
  { id: 'subsidiary', name: 'Subsidiary', description: 'Subsidiary company', directed: true },
  { id: 'branch', name: 'Branch', description: 'Branch office', directed: true },
  { id: 'merged', name: 'Merged', description: 'Merged with', directed: false },
  { id: 'acquired', name: 'Acquired', description: 'Acquired by', directed: true },
  { id: 'spun_off', name: 'Spun Off', description: 'Spun off from', directed: true },
  { id: 'joint_venture', name: 'Joint Venture', description: 'Joint Venture', directed: false },
  { id: 'partner', name: 'Partner', description: 'Partnered with', directed: false },
  { id: 'supplier', name: 'Supplier', description: 'Supplier for', directed: true },
  { id: 'customer', name: 'Customer', description: 'Customer of', directed: true },
  { id: 'competitor', name: 'Competitor', description: 'Competitor to', directed: false },
  { id: 'brand_owner', name: 'Brand Owner', description: 'Owns brand', directed: true }
];
