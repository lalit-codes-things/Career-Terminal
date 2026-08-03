import type { RecruiterMessageInput } from '../communication/communication.service';

export type RecruiterFactType =
  | 'recruiter_name'
  | 'recruiter_title'
  | 'organization'
  | 'department'
  | 'seniority'
  | 'hiring_intent'
  | 'job_opening'
  | 'location'
  | 'skill'
  | 'technology'
  | 'interview_stage'
  | 'compensation_mention'
  | 'follow_up_request'
  | 'deadline'
  | 'commitment'
  | 'action_item';

export interface StructuredRecruiterFact {
  factType: RecruiterFactType;
  value: Record<string, unknown>;
  confidence: number;
  evidence: { messageId: string; excerpt: string };
  provenance: {
    extractor: string;
    method: 'deterministic' | 'ai_assisted';
    sourceProvider: string;
  };
  observedAt: Date;
}

export interface AiCommunicationExtractor {
  extract(message: RecruiterMessageInput): Promise<StructuredRecruiterFact[]>;
}

export class RecruiterCommunicationIntelligenceService {
  constructor(private readonly aiExtractor?: AiCommunicationExtractor) {}

  async extract(message: RecruiterMessageInput): Promise<StructuredRecruiterFact[]> {
    const deterministic = this.extractDeterministicFacts(message);
    const aiFacts = this.aiExtractor ? await this.aiExtractor.extract(message) : [];
    return [...deterministic, ...aiFacts].map((fact) => ({
      ...fact,
      confidence: Math.max(0, Math.min(1, fact.confidence)),
      value: this.normalizeFactValue(fact.factType, fact.value),
    }));
  }

  extractDeterministicFacts(message: RecruiterMessageInput): StructuredRecruiterFact[] {
    const text = `${message.subject ?? ''}\n${message.snippet ?? ''}`;
    const facts: StructuredRecruiterFact[] = [];
    const add = (
      factType: RecruiterFactType,
      value: Record<string, unknown>,
      confidence: number,
      excerpt: string,
    ) => {
      facts.push({
        factType,
        value,
        confidence,
        evidence: { messageId: message.providerMessageId, excerpt },
        provenance: {
          extractor: 'deterministic-recruiter-communication-v1',
          method: 'deterministic',
          sourceProvider: message.provider,
        },
        observedAt: message.sentAt,
      });
    };

    const title = text.match(
      /\b(recruiter|talent acquisition|sourcer|hiring manager|recruiting coordinator)\b/i,
    )?.[0];
    if (message.from.displayName)
      add('recruiter_name', { name: message.from.displayName }, 0.85, message.from.displayName);
    if (title) add('recruiter_title', { title }, 0.78, title);
    if (/\b(interview|screen|onsite|loop)\b/i.test(text))
      add('interview_stage', { stage: 'interview' }, 0.82, text.slice(0, 180));
    if (
      /\b(deadline|by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|due)\b/i.test(
        text,
      )
    )
      add('deadline', { mentioned: true }, 0.74, text.slice(0, 180));
    if (/\b(follow up|checking in|circling back|please reply)\b/i.test(text))
      add('follow_up_request', { requested: true }, 0.8, text.slice(0, 180));
    if (/\b(compensation|salary|base pay|equity|bonus|\$\d{2,})\b/i.test(text))
      add('compensation_mention', { mentioned: true }, 0.78, text.slice(0, 180));
    if (/\b(commit|confirm|schedule|send|share|provide)\b/i.test(text))
      add('action_item', { requested: true }, 0.68, text.slice(0, 180));
    for (const skill of ['typescript', 'node', 'react', 'python', 'java', 'aws', 'kubernetes']) {
      if (new RegExp(`\\b${skill}\\b`, 'i').test(text))
        add(
          skill === 'aws' || skill === 'kubernetes' ? 'technology' : 'skill',
          { name: skill },
          0.72,
          skill,
        );
    }

    return facts;
  }

  private normalizeFactValue(
    factType: RecruiterFactType,
    value: Record<string, unknown>,
  ): Record<string, unknown> {
    if ('name' in value && typeof value.name === 'string')
      return { ...value, normalizedName: value.name.trim().toLowerCase() };
    if ('title' in value && typeof value.title === 'string')
      return { ...value, normalizedTitle: value.title.trim().toLowerCase() };
    if (factType === 'skill' || factType === 'technology')
      return {
        ...value,
        normalizedName: typeof value.name === 'string' ? value.name.trim().toLowerCase() : '',
      };
    return value;
  }
}
