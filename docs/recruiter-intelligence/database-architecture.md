# Database Architecture

## Storage Model

- Primary operational store: PostgreSQL.
- All recruiter facts, identity state, relationships, memory entries, and evidence references are stored as versioned records.
- Temporal semantics are handled with bi-temporal columns and explicit validity windows.

## Core Table Families

1. Recruiter identity tables
   - recruiter_identities
   - recruiter_identity_aliases
   - recruiter_identity_evidence

2. Knowledge graph tables
   - recruiter_graph_nodes
   - recruiter_graph_edges
   - recruiter_graph_edge_versions

3. Communication intelligence tables
   - recruiter_communications
   - recruiter_communication_embeddings
   - recruiter_communication_evidence

4. Memory and timeline tables
   - recruiter_memory_facts
   - recruiter_timeline_events
   - recruiter_fact_versions

5. Governance and compliance tables
   - recruiter_consent_records
   - recruiter_retention_policies
   - recruiter_audit_events

## Partitioning Strategy

- Partition large fact tables by time range.
- Partition communication and event tables by tenant or region where needed.
- Keep write-heavy tables horizontally partitionable for future sharding.

## Indexing Guidance

- B-tree indexes for identity lookups and tenant filtering.
- GIN/GiST indexes for JSONB metadata and semantic search features.
- Covering indexes for timeline and memory reads.
- Hash indexes for high-cardinality or hot-path joins.

## Materialized Views

- recruiter_organization_summary
- recruiter_relationship_snapshot
- recruiter_memory_current_state
- recruiter_activity_analytics

## Read/Write Optimization

- Primary write path: transactional writes and outbox emission.
- Read path: materialized views and denormalized projections for search and analytics.
- Use read replicas for analytics and non-critical retrieval.

## Future Compatibility

- Keep schema normalized for PostgreSQL-first operations.
- Use explicit edge and temporal tables to support future graph database migration or hybrid graph/vector storage.
