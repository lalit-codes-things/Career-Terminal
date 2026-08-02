import { TimelineEvent, TimelineSnapshot } from './model';
import { EventRegistry } from './registry';

export class TimelineEngine {
  constructor(private registry: EventRegistry) {}

  public validate(event: TimelineEvent): void {
    if (!this.registry.get(event.typeId)) {
      throw new Error(`Unknown event type: ${event.typeId}`);
    }
  }

  public orderChronologically(events: TimelineEvent[]): TimelineEvent[] {
    return [...events].sort((a, b) => {
      const timeDiff = a.date.getTime() - b.date.getTime();
      if (timeDiff !== 0) return timeDiff;
      
      // Secondary sort by confidence if exact same time
      return b.confidence - a.confidence;
    });
  }

  public getHistoricalSnapshot(events: TimelineEvent[], date: Date): TimelineSnapshot {
    const pastEvents = events.filter(e => e.date <= date);
    return {
      date,
      events: this.orderChronologically(pastEvents)
    };
  }
}
