# ADR-001: Recruiter Intelligence Domain Architecture

## Status
Accepted

## Context

Epic 6 requires a scalable, provider-independent architecture for recruiter intelligence that supports identity resolution, knowledge graphs, temporal memory, communication intelligence, and AI-driven enrichment without future rewrites.

## Decision

We will organize Recruiter Intelligence as a set of bounded contexts with explicit contracts and event-driven orchestration. These contexts will communicate through asynchronous events and application services rather than shared mutable state.

## Consequences

- Clear module boundaries and lower coupling.
- Easier future extraction into separate services.
- Stronger observability and event replay support.
- A clear path for eventual multi-region and multi-model AI expansion.
