# ADR-002: PostgreSQL-First, Graph-Ready Storage

## Status
Accepted

## Context

The recruiter intelligence platform requires graph-like relationships, temporal facts, evidence, and future analytics while avoiding the operational complexity of introducing a graph database in the initial architecture.

## Decision

We will keep PostgreSQL as the primary operational store, using normalized relational tables, temporal fact tables, and graph edge tables that remain compatible with future graph database migration or hybrid storage strategies.

## Consequences

- Simpler initial deployment and operational model.
- Strong support for bi-temporal facts and evidence.
- Clear compatibility with future graph or vector indexing extensions.
