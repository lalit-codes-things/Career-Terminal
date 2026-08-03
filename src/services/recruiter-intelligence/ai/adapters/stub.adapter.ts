import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter, AiProviderKind } from '../types';

/**
 * StubAiAdapter — deterministic, zero-cost adapter for tests and local dev.
 * Returns predictable JSON so extraction and reasoning pipelines can be exercised
 * without real API keys. No network calls.
 */
export class StubAiAdapter implements AiModelAdapter {
  readonly provider: AiProviderKind = 'stub';
  readonly supportedModels = ['stub-fast', 'stub-balanced', 'stub-powerful'];

  private readonly responses = new Map<string, string>();

  /**
   * Register a canned response for a specific keyword in the prompt.
   * Used in tests to control what the adapter returns.
   */
  registerResponse(keyword: string, jsonResponse: string): void {
    this.responses.set(keyword.toLowerCase(), jsonResponse);
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    const start = Date.now();

    const combined = `${request.systemPrompt}\n${request.userPrompt}`.toLowerCase();
    let rawText = this.matchResponse(combined);

    // Stream simulation
    if (request.stream && request.onChunk) {
      const chunks = rawText.match(/.{1,50}/g) ?? [rawText];
      for (let i = 0; i < chunks.length; i++) {
        request.onChunk({
          chunkIndex: i,
          delta: chunks[i] ?? '',
          finished: i === chunks.length - 1,
        });
      }
    }

    const inputTokens = Math.ceil((request.systemPrompt + request.userPrompt).length / 4);
    const outputTokens = Math.ceil(rawText.length / 4);

    return {
      rawText,
      inputTokens,
      outputTokens,
      model: request.model,
      finishReason: 'stop',
      latencyMs: Date.now() - start,
    };
  }

  private matchResponse(prompt: string): string {
    for (const [keyword, response] of this.responses) {
      if (prompt.includes(keyword)) return response;
    }

    // Default responses keyed by template pattern
    if (prompt.includes('recruiter-entity-extraction') || prompt.includes('extract recruiter intelligence')) {
      return this.defaultEntityExtractionResponse();
    }
    if (prompt.includes('recruiter-reasoning-enrichment') || prompt.includes('infer hidden attributes') || prompt.includes('infer recruiter attributes')) {
      return this.defaultReasoningResponse();
    }
    if (prompt.includes('recruiter intelligence profile') || prompt.includes('generate a recruiter intelligence profile')) {
      return this.defaultProfileResponse();
    }

    return JSON.stringify({ fields: [], inferences: [] });
  }

  private defaultEntityExtractionResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'recruiter_name',
          value: { name: 'Ada Recruiter' },
          rawValue: 'Ada Recruiter',
          confidence: 0.92,
          evidence: [{ excerpt: 'Ada Recruiter', confidence: 0.92 }],
        },
        {
          field: 'recruiter_title',
          value: { title: 'Senior Technical Recruiter' },
          rawValue: 'Senior Technical Recruiter',
          confidence: 0.88,
          evidence: [{ excerpt: 'Senior Technical Recruiter', confidence: 0.88 }],
        },
        {
          field: 'recruiter_organization',
          value: { name: 'Example Corp' },
          rawValue: 'Example Corp',
          confidence: 0.85,
          evidence: [{ excerpt: 'Example Corp', confidence: 0.85 }],
        },
        {
          field: 'technology',
          value: { name: 'TypeScript' },
          rawValue: 'TypeScript',
          confidence: 0.9,
          evidence: [{ excerpt: 'TypeScript', confidence: 0.9 }],
        },
        {
          field: 'interview_stage',
          value: { stage: 'technical_screen' },
          rawValue: 'technical screening',
          confidence: 0.82,
          evidence: [{ excerpt: 'technical screening', confidence: 0.82 }],
        },
        {
          field: 'compensation_mention',
          value: { mentioned: true, amount: 180000, currency: 'USD' },
          rawValue: '$180k',
          confidence: 0.95,
          evidence: [{ excerpt: '$180k', confidence: 0.95 }],
        },
      ],
    });
  }

  private defaultReasoningResponse(): string {
    return JSON.stringify({
      inferences: [
        {
          attribute: 'seniority',
          value: 'senior',
          reasoning: 'Title contains "Senior" and message handles compensation negotiation independently, indicating autonomous decision authority.',
          confidence: 0.87,
          supportingEvidence: ['Title: Senior Technical Recruiter', 'Discusses $180k independently'],
        },
        {
          attribute: 'specialization',
          value: 'engineering',
          reasoning: 'Mentions TypeScript, AWS, and technical screening which are engineering-specific signals.',
          confidence: 0.91,
          supportingEvidence: ['TypeScript mentioned', 'AWS experience required', 'technical screening stage'],
        },
        {
          attribute: 'hiringFocus',
          value: ['Software Engineer', 'Backend Engineer', 'Full-stack Engineer'],
          reasoning: 'TypeScript and AWS are backend/full-stack indicators. Interview stage is technical screen.',
          confidence: 0.82,
          supportingEvidence: ['TypeScript', 'AWS', 'technical_screen'],
        },
        {
          attribute: 'technicalDomains',
          value: ['Web Development', 'Cloud Infrastructure', 'Backend Systems'],
          reasoning: 'TypeScript is web/backend; AWS is cloud infrastructure.',
          confidence: 0.85,
          supportingEvidence: ['TypeScript', 'AWS'],
        },
        {
          attribute: 'urgency',
          value: 'high',
          reasoning: 'Message asks to reply by Friday with a specific deadline, indicating high urgency.',
          confidence: 0.9,
          supportingEvidence: ['Please schedule by Friday', 'deadline mentioned'],
        },
        {
          attribute: 'decisionAuthority',
          value: 'decision_maker',
          reasoning: 'Independently quotes compensation and schedules interviews without mentioned approval chain.',
          confidence: 0.78,
          supportingEvidence: ['Compensation: $180k', 'Direct scheduling request'],
        },
        {
          attribute: 'communicationIntent',
          value: 'scheduling',
          reasoning: 'Primary ask is to schedule an interview by a specific date.',
          confidence: 0.93,
          supportingEvidence: ['Please schedule an interview by Friday'],
        },
        {
          attribute: 'followUpRequirements',
          value: ['Send availability', 'Confirm interview format'],
          reasoning: 'Explicit asks for candidate availability and confirmation.',
          confidence: 0.88,
          supportingEvidence: ['Please reply with availability'],
        },
      ],
    });
  }

  private defaultProfileResponse(): string {
    return JSON.stringify({
      summary: 'Ada Recruiter is a Senior Technical Recruiter at Example Corp specializing in engineering talent. She focuses on backend and full-stack roles requiring TypeScript and cloud expertise, and communicates with high urgency and clear calls to action.',
      hiringFocus: ['Software Engineer', 'Backend Engineer', 'Full-stack Engineer'],
      technicalFocus: ['TypeScript', 'AWS', 'Cloud Infrastructure', 'Backend Systems'],
      industryFocus: ['Technology', 'Software'],
      organizationContext: {
        organization: 'Example Corp',
        department: 'Engineering Recruiting',
        seniorityLevel: 'Senior Recruiter',
      },
      communicationStyle: 'Direct and deadline-oriented with clear action items. Sets explicit timelines.',
      recruitingStyle: 'Technical-depth screening with compensation transparency early in the process.',
      hiringVelocitySignals: {
        urgency: 'high',
        typicalResponseWindow: '24-48 hours',
        pipelineStage: 'active_screening',
      },
      relationshipStrength: {
        score: 0.62,
        signals: ['first_contact', 'inbound_reach_out', 'compensation_disclosed'],
      },
      candidateFitSignals: [
        'TypeScript proficiency required',
        'AWS experience preferred',
        'Availability within the week',
      ],
    });
  }
}
