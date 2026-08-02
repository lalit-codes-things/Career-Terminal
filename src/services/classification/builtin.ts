import { ClassificationSystem, ClassificationNode } from './system';
import { CompanyDataStorage } from '../company-intelligence/storage/storage.types';

export class BuiltInClassificationSystem extends ClassificationSystem {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string,
    public readonly description: string
  ) {
    super();
  }

  public async load(_storage: CompanyDataStorage): Promise<void> {
    // Simulated loading process since datasets do not need to exist yet
    // In production, this would read from storage.readText(`classifications/${this.id}/${this.version}.json`)
    // and parse it via the Importer framework.
    return Promise.resolve();
  }

  // Internal test helper to inject nodes
  public addNode(node: ClassificationNode) {
    this.nodes.set(node.code, node);
  }
}

export const NAICS_SYSTEM = new BuiltInClassificationSystem(
  'naics',
  'North American Industry Classification System',
  '2022',
  'Standard used by Federal statistical agencies'
);

export const ISIC_SYSTEM = new BuiltInClassificationSystem(
  'isic',
  'International Standard Industrial Classification',
  'Rev.4',
  'United Nations industry classification system'
);

export const NACE_SYSTEM = new BuiltInClassificationSystem(
  'nace',
  'Statistical Classification of Economic Activities in the European Community',
  'Rev.2',
  'European industry standard'
);

export const SIC_SYSTEM = new BuiltInClassificationSystem(
  'sic',
  'Standard Industrial Classification',
  '1987',
  'US government system for classifying industries'
);
