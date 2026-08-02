import { ClassificationRegistry } from '../registry';
import { BuiltInClassificationSystem, NAICS_SYSTEM } from '../builtin';
import { ClassificationValidator } from '../validator';
import { ClassificationNode } from '../system';
import { ImporterFactory } from '../importer';
import { CompanyDataStorage } from '../../company-intelligence/storage/storage.types';

const mockStorage: CompanyDataStorage = {
  kind: 'local',
  read: async () => Buffer.from(''),
  readText: async () => '',
  write: async () => {},
  list: async () => [],
  exists: async () => false,
  openStream: async () => ({} as any)
};

describe('Global Classification Framework', () => {
  describe('ClassificationRegistry & Hierarchy', () => {
    it('registers systems and allows hierarchy traversal', () => {
      const registry = new ClassificationRegistry(mockStorage);
      registry.register(NAICS_SYSTEM);

      expect(registry.get('naics')).toBeDefined();
      
      const naics = registry.get('naics') as BuiltInClassificationSystem;
      naics.addNode({ code: '11', name: 'Agriculture' });
      naics.addNode({ code: '111', name: 'Crop Production', parentCode: '11' });
      naics.addNode({ code: '1111', name: 'Oilseed and Grain', parentCode: '111' });

      const hierarchy = naics.getHierarchy('1111');
      expect(hierarchy.map(h => h.code)).toEqual(['11', '111', '1111']);
      
      const children = naics.getChildren('11');
      expect(children.map(c => c.code)).toEqual(['111']);
    });
  });

  describe('ClassificationValidator', () => {
    it('detects duplicate codes', () => {
      const nodes: ClassificationNode[] = [
        { code: 'A', name: 'A' },
        { code: 'A', name: 'A2' }
      ];
      expect(() => ClassificationValidator.validate(nodes)).toThrow(/Duplicate/);
    });

    it('detects missing parents', () => {
      const nodes: ClassificationNode[] = [
        { code: 'A', name: 'A', parentCode: 'B' }
      ];
      expect(() => ClassificationValidator.validate(nodes)).toThrow(/Missing parent/);
    });

    it('detects circular hierarchies', () => {
      const nodes: ClassificationNode[] = [
        { code: 'A', name: 'A', parentCode: 'C' },
        { code: 'B', name: 'B', parentCode: 'A' },
        { code: 'C', name: 'C', parentCode: 'B' }
      ];
      expect(() => ClassificationValidator.validate(nodes)).toThrow(/Circular hierarchy/);
    });
  });

  describe('Importer Framework', () => {
    it('parses JSON format via factory', async () => {
      const importer = ImporterFactory.create('json');
      const data = [{ code: 'test', name: 'test name' }];
      const parsed = await importer.parse(Buffer.from(JSON.stringify(data)));
      expect(parsed[0].code).toBe('test');
    });
  });
});
