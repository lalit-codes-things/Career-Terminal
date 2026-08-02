import { EventRegistry, BUILT_IN_EVENTS } from '../registry';
import { TimelineEngine } from '../engine';
import { TimelineEvent } from '../model';

describe('Company Timeline Framework', () => {
  let registry: EventRegistry;
  let engine: TimelineEngine;

  beforeEach(() => {
    registry = new EventRegistry();
    BUILT_IN_EVENTS.forEach(e => registry.register(e));
    engine = new TimelineEngine(registry);
  });

  it('validates known events', () => {
    const event: TimelineEvent = {
      eventId: '1', typeId: 'company_created', companyId: 'C1',
      date: new Date(), provider: 'test', confidence: 1, data: {}, version: 1, timestamp: new Date()
    };
    expect(() => engine.validate(event)).not.toThrow();
  });

  it('rejects unknown events', () => {
    const event: TimelineEvent = {
      eventId: '1', typeId: 'unknown', companyId: 'C1',
      date: new Date(), provider: 'test', confidence: 1, data: {}, version: 1, timestamp: new Date()
    };
    expect(() => engine.validate(event)).toThrow(/Unknown event type/);
  });

  it('orders events chronologically', () => {
    const e1: TimelineEvent = { eventId: '1', typeId: 'listing', companyId: 'C1', date: new Date('2020-01-01'), provider: 'p', confidence: 1, data: {}, version: 1, timestamp: new Date() };
    const e2: TimelineEvent = { eventId: '2', typeId: 'name_change', companyId: 'C1', date: new Date('2021-01-01'), provider: 'p', confidence: 1, data: {}, version: 1, timestamp: new Date() };
    const e3: TimelineEvent = { eventId: '3', typeId: 'company_created', companyId: 'C1', date: new Date('2019-01-01'), provider: 'p', confidence: 1, data: {}, version: 1, timestamp: new Date() };

    const ordered = engine.orderChronologically([e1, e2, e3]);
    expect(ordered.map(e => e.typeId)).toEqual(['company_created', 'listing', 'name_change']);
  });

  it('generates historical snapshots', () => {
    const e1: TimelineEvent = { eventId: '1', typeId: 'company_created', companyId: 'C1', date: new Date('2019-01-01'), provider: 'p', confidence: 1, data: {}, version: 1, timestamp: new Date() };
    const e2: TimelineEvent = { eventId: '2', typeId: 'listing', companyId: 'C1', date: new Date('2020-01-01'), provider: 'p', confidence: 1, data: {}, version: 1, timestamp: new Date() };

    const snapshot = engine.getHistoricalSnapshot([e1, e2], new Date('2019-06-01'));
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]!.typeId).toBe('company_created');
  });
});
