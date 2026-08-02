import { ClassificationSystem } from './system';
import { CompanyDataStorage } from '../company-intelligence/storage/storage.types';

export class ClassificationRegistry {
  private systems: Map<string, ClassificationSystem> = new Map();

  constructor(private storage: CompanyDataStorage) {}

  public register(system: ClassificationSystem): void {
    if (this.systems.has(system.id)) {
      throw new Error(`ClassificationSystem with id ${system.id} is already registered.`);
    }
    this.systems.set(system.id, system);
  }

  public get(id: string): ClassificationSystem | undefined {
    return this.systems.get(id);
  }

  public getAll(): ClassificationSystem[] {
    return Array.from(this.systems.values());
  }

  public async loadAll(): Promise<void> {
    const promises = Array.from(this.systems.values()).map(system => system.load(this.storage));
    await Promise.all(promises);
  }
}
