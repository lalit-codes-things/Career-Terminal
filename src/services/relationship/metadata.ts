export interface RelationshipMetadata {
  confidence: number;
  source: string;
  provider: string;
  validFrom: Date;
  validTo?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

export interface EntityRelationship {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: string;
  metadata: RelationshipMetadata;
}
