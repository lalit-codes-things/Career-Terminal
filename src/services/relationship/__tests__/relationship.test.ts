import { RelationshipRegistry, BUILT_IN_RELATIONSHIPS } from '../registry';
import { RelationshipEngine } from '../engine';
import { EntityRelationship } from '../metadata';

describe('Company Relationship Framework', () => {
  let registry: RelationshipRegistry;
  let engine: RelationshipEngine;

  beforeEach(() => {
    registry = new RelationshipRegistry();
    BUILT_IN_RELATIONSHIPS.forEach(r => registry.register(r));
    engine = new RelationshipEngine(registry);
  });

  it('validates known relationships', () => {
    const rel: EntityRelationship = {
      id: '1',
      sourceEntityId: 'A',
      targetEntityId: 'B',
      relationshipType: 'parent',
      metadata: {
        confidence: 0.9,
        source: 'sec',
        provider: 'internal',
        validFrom: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    expect(() => engine.validate(rel)).not.toThrow();
  });

  it('detects cycles', () => {
    const r1: EntityRelationship = {
      id: '1', sourceEntityId: 'A', targetEntityId: 'B', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: new Date(), createdAt: new Date(), updatedAt: new Date() }
    };
    const r2: EntityRelationship = {
      id: '2', sourceEntityId: 'B', targetEntityId: 'C', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: new Date(), createdAt: new Date(), updatedAt: new Date() }
    };
    const newRel: EntityRelationship = {
      id: '3', sourceEntityId: 'C', targetEntityId: 'A', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: new Date(), createdAt: new Date(), updatedAt: new Date() }
    };

    expect(engine.detectCycle([r1, r2], newRel)).toBe(true);
  });

  it('detects duplicates', () => {
    const now = new Date();
    const r1: EntityRelationship = {
      id: '1', sourceEntityId: 'A', targetEntityId: 'B', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: now, createdAt: new Date(), updatedAt: new Date() }
    };
    const r2: EntityRelationship = {
      id: '2', sourceEntityId: 'A', targetEntityId: 'B', relationshipType: 'parent',
      metadata: { confidence: 0.8, source: 'test', provider: 'test', validFrom: now, createdAt: new Date(), updatedAt: new Date() }
    };
    expect(engine.isDuplicate(r1, r2)).toBe(true);
  });

  it('detects temporal conflict', () => {
    const now = new Date();
    const r1: EntityRelationship = {
      id: '1', sourceEntityId: 'A', targetEntityId: 'B', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: now, validTo: new Date(now.getTime() + 10000), createdAt: new Date(), updatedAt: new Date() }
    };
    const r2: EntityRelationship = {
      id: '2', sourceEntityId: 'A', targetEntityId: 'B', relationshipType: 'parent',
      metadata: { confidence: 1, source: 'test', provider: 'test', validFrom: new Date(now.getTime() + 5000), validTo: new Date(now.getTime() + 15000), createdAt: new Date(), updatedAt: new Date() }
    };
    expect(engine.detectConflict(r1, r2)).toBe(true);
  });
});
