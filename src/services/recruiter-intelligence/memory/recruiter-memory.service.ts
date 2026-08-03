import type { StructuredRecruiterFact } from '../intelligence/communication-intelligence.service';

export interface RecruiterMemoryFact extends StructuredRecruiterFact {
  id: string;
  recruiterId: string;
  validFrom: Date;
  validTo?: Date;
  supersededById?: string;
  supersededAt?: Date;
}

export class RecruiterMemoryService {
  consolidate(
    existing: RecruiterMemoryFact[],
    incoming: RecruiterMemoryFact,
    now = new Date(),
  ): RecruiterMemoryFact[] {
    const current = existing.find(
      (fact) =>
        !fact.supersededAt &&
        fact.factType === incoming.factType &&
        JSON.stringify(fact.value) !== JSON.stringify(incoming.value),
    );
    if (!current)
      return [...existing, incoming].sort(
        (a, b) => a.observedAt.getTime() - b.observedAt.getTime(),
      );

    return existing
      .map((fact) =>
        fact.id === current.id
          ? { ...fact, validTo: incoming.validFrom, supersededAt: now, supersededById: incoming.id }
          : fact,
      )
      .concat(incoming)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }

  retrieve(
    facts: RecruiterMemoryFact[],
    query: { factType?: string; asOf?: Date },
  ): RecruiterMemoryFact[] {
    return facts.filter((fact) => {
      if (query.factType && fact.factType !== query.factType) return false;
      if (!query.asOf) return !fact.supersededAt;
      return fact.validFrom <= query.asOf && (!fact.validTo || fact.validTo > query.asOf);
    });
  }

  reconstructTimeline(
    facts: RecruiterMemoryFact[],
  ): Array<{ occurredAt: Date; type: string; factId: string; confidence: number }> {
    return facts
      .flatMap((fact) => [
        {
          occurredAt: fact.observedAt,
          type: `fact.observed.${fact.factType}`,
          factId: fact.id,
          confidence: fact.confidence,
        },
        ...(fact.supersededAt
          ? [
              {
                occurredAt: fact.supersededAt,
                type: `fact.superseded.${fact.factType}`,
                factId: fact.id,
                confidence: fact.confidence,
              },
            ]
          : []),
      ])
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }
}
