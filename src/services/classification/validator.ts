import { ClassificationNode } from './system';

export class ClassificationValidator {
  public static validate(nodes: ClassificationNode[]): void {
    const codes = new Set<string>();
    
    // Check duplicates
    for (const node of nodes) {
      if (codes.has(node.code)) {
        throw new Error(`Duplicate classification code detected: ${node.code}`);
      }
      codes.add(node.code);
    }

    // Check missing parents
    for (const node of nodes) {
      if (node.parentCode && !codes.has(node.parentCode)) {
        throw new Error(`Missing parent code ${node.parentCode} for node ${node.code}`);
      }
    }

    // Check circular hierarchies
    for (const node of nodes) {
      this.detectCircular(node, nodes, new Set());
    }
  }

  private static detectCircular(node: ClassificationNode, nodes: ClassificationNode[], visited: Set<string>): void {
    if (visited.has(node.code)) {
      throw new Error(`Circular hierarchy detected at node: ${node.code}`);
    }
    visited.add(node.code);
    
    if (node.parentCode) {
      const parent = nodes.find(n => n.code === node.parentCode);
      if (parent) {
        this.detectCircular(parent, nodes, new Set(visited));
      }
    }
  }
}
