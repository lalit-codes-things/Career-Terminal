import { EntityRelationship } from './metadata';
import { RelationshipRegistry } from './registry';

export class RelationshipEngine {
  constructor(private registry: RelationshipRegistry) {}

  public validate(rel: EntityRelationship): void {
    const typeDef = this.registry.get(rel.relationshipType);
    if (!typeDef) {
      throw new Error(`Unknown relationship type: ${rel.relationshipType}`);
    }
    
    if (rel.sourceEntityId === rel.targetEntityId) {
      throw new Error(`Self-referencing relationship not allowed for ${rel.relationshipType}`);
    }
  }

  public detectConflict(rel1: EntityRelationship, rel2: EntityRelationship): boolean {
    if (rel1.sourceEntityId === rel2.sourceEntityId && 
        rel1.targetEntityId === rel2.targetEntityId &&
        rel1.relationshipType === rel2.relationshipType) {
      const start1 = rel1.metadata.validFrom.getTime();
      const end1 = rel1.metadata.validTo?.getTime() ?? Infinity;
      const start2 = rel2.metadata.validFrom.getTime();
      const end2 = rel2.metadata.validTo?.getTime() ?? Infinity;

      // True if they overlap
      return start1 <= end2 && start2 <= end1;
    }
    return false;
  }

  public isDuplicate(rel1: EntityRelationship, rel2: EntityRelationship): boolean {
    return rel1.sourceEntityId === rel2.sourceEntityId &&
           rel1.targetEntityId === rel2.targetEntityId &&
           rel1.relationshipType === rel2.relationshipType &&
           rel1.metadata.provider === rel2.metadata.provider &&
           rel1.metadata.validFrom.getTime() === rel2.metadata.validFrom.getTime();
  }

  public detectCycle(relationships: EntityRelationship[], newRel: EntityRelationship): boolean {
    const graph = new Map<string, string[]>();
    for (const r of [...relationships, newRel]) {
      if (!graph.has(r.sourceEntityId)) graph.set(r.sourceEntityId, []);
      graph.get(r.sourceEntityId)!.push(r.targetEntityId);
    }
    
    return this.dfsCycle(newRel.sourceEntityId, graph, new Set(), new Set());
  }

  private dfsCycle(node: string, graph: Map<string, string[]>, visited: Set<string>, recStack: Set<string>): boolean {
    if (recStack.has(node)) return true;
    if (visited.has(node)) return false;

    visited.add(node);
    recStack.add(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (this.dfsCycle(neighbor, graph, visited, recStack)) {
        return true;
      }
    }
    recStack.delete(node);
    return false;
  }
}
