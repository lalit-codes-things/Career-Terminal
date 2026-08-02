import { CompanyDataStorage } from '../company-intelligence/storage/storage.types';

export interface ClassificationMetadata {
  description?: string;
  source?: string;
  version?: string;
  validFrom?: Date;
  validTo?: Date;
  [key: string]: any;
}

export interface ClassificationNode {
  code: string;
  name: string;
  parentCode?: string | null;
  aliases?: string[];
  deprecated?: boolean;
  replacementCode?: string;
  metadata?: ClassificationMetadata;
  localizedNames?: Record<string, string>;
}

export abstract class ClassificationSystem {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;
  
  protected nodes: Map<string, ClassificationNode> = new Map();
  
  public get(code: string): ClassificationNode | undefined {
    return this.nodes.get(code);
  }

  public has(code: string): boolean {
    return this.nodes.has(code);
  }

  public getAll(): ClassificationNode[] {
    return Array.from(this.nodes.values());
  }

  public getHierarchy(code: string): ClassificationNode[] {
    const node = this.nodes.get(code);
    if (!node) return [];
    
    const hierarchy: ClassificationNode[] = [node];
    let current = node;
    while (current.parentCode) {
      const parent = this.nodes.get(current.parentCode);
      if (parent) {
        if (hierarchy.find(n => n.code === parent.code)) {
          break;
        }
        hierarchy.unshift(parent);
        current = parent;
      } else {
        break;
      }
    }
    return hierarchy;
  }
  
  public getChildren(code: string): ClassificationNode[] {
    return Array.from(this.nodes.values()).filter(n => n.parentCode === code);
  }

  public resolveAlias(alias: string): ClassificationNode | undefined {
    return Array.from(this.nodes.values()).find(
      n => n.aliases?.includes(alias) || n.code === alias || n.name === alias
    );
  }

  abstract load(storage: CompanyDataStorage): Promise<void>;
}
