export interface HiringSignalDefinition {
  id: string;
  name: string;
  description: string;
}

export class HiringSignalRegistry {
  private signals = new Map<string, HiringSignalDefinition>();

  register(def: HiringSignalDefinition) {
    if (this.signals.has(def.id)) {
      throw new Error(`HiringSignal ${def.id} already registered`);
    }
    this.signals.set(def.id, def);
  }

  get(id: string) {
    return this.signals.get(id);
  }

  getAll() {
    return Array.from(this.signals.values());
  }
}

export const BUILT_IN_HIRING_SIGNALS: HiringSignalDefinition[] = [
  { id: 'current_hiring', name: 'Current Hiring', description: 'Actively hiring now' },
  { id: 'hiring_growth', name: 'Hiring Growth', description: 'Increase in open positions' },
  { id: 'hiring_slowdown', name: 'Hiring Slowdown', description: 'Decrease in open positions' },
  { id: 'hiring_pause', name: 'Hiring Pause', description: 'Hiring freeze or pause' },
  { id: 'expansion', name: 'Expansion', description: 'Opening new offices or departments' },
  { id: 'regional_growth', name: 'Regional Growth', description: 'Hiring growth in specific regions' }
];
