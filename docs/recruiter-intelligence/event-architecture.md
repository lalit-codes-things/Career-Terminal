# Event Architecture

## Event Model

- All cross-module state changes are emitted as versioned domain events.
- Events must be durable, traceable, and replayable.
- Events carry correlation identifiers and causation identifiers.

## Command Model

- Commands are used for explicit state transitions such as resolving identity or ingesting communication data.
- Commands are handled by application services and translated into domain events.

## Naming Convention

- Event names should follow the pattern: Domain.Context.Action.
- Example: Recruiter.IdentityResolved
- Versioning is explicit via eventVersion.

## Reliability

- Use outbox-based publication for transactional consistency.
- Queue handlers are idempotent and support retry and DLQ behavior.
- BullMQ is the default async transport, with future Kafka compatibility preserved through event envelope contracts.

## Idempotency

- Commands and workers must use deterministic identifiers based on correlation ids and business keys.
- Replays must not produce duplicate state changes.

## Dead-Letter Handling

- Failed enrichment jobs are routed to DLQ with complete error context and replay metadata.
- DLQ messages must be manually reviewed or replayed by operators.
