export interface EventTypeDefinition {
  id: string;
  name: string;
  description: string;
}

export class EventRegistry {
  private types = new Map<string, EventTypeDefinition>();

  register(def: EventTypeDefinition) {
    if (this.types.has(def.id)) {
      throw new Error(`Event type ${def.id} already registered`);
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

export const BUILT_IN_EVENTS: EventTypeDefinition[] = [
  { id: 'company_created', name: 'Company Created', description: 'Initial registration of the company' },
  { id: 'listing', name: 'Listing', description: 'Public market listing' },
  { id: 'delisting', name: 'Delisting', description: 'Removal from public market' },
  { id: 'address_change', name: 'Address Change', description: 'Change of headquarters or registered address' },
  { id: 'name_change', name: 'Name Change', description: 'Change of legal or trading name' },
  { id: 'relationship_change', name: 'Relationship Change', description: 'M&A or parent/subsidiary change' },
  { id: 'import_completed', name: 'Import Completed', description: 'Data ingestion milestone' }
];
