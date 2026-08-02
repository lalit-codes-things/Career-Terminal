export interface LocationTypeDefinition {
  id: string;
  name: string;
  description: string;
}

export class LocationTypeRegistry {
  private types = new Map<string, LocationTypeDefinition>();

  register(def: LocationTypeDefinition) {
    if (this.types.has(def.id)) {
      throw new Error(`Location type ${def.id} already registered`);
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

export const BUILT_IN_LOCATION_TYPES: LocationTypeDefinition[] = [
  { id: 'registered_office', name: 'Registered Office', description: 'Legal registered address' },
  { id: 'headquarters', name: 'Headquarters', description: 'Main corporate headquarters' },
  { id: 'branch', name: 'Branch', description: 'Branch office' },
  { id: 'office', name: 'Office', description: 'General office' },
  { id: 'warehouse', name: 'Warehouse', description: 'Storage facility or warehouse' },
  { id: 'retail', name: 'Retail', description: 'Retail store' },
  { id: 'factory', name: 'Factory', description: 'Manufacturing factory' },
  { id: 'remote_hub', name: 'Remote Hub', description: 'Remote work hub' },
  { id: 'data_center', name: 'Data Center', description: 'Data center facility' }
];
