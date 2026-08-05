import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter, AiProviderKind } from '../types';

/**
 * StubAiAdapter — deterministic, zero-cost adapter for tests and local dev.
 * Returns predictable JSON so extraction and reasoning pipelines can be exercised
 * without real API keys. No network calls.
 */
export class StubAiAdapter implements AiModelAdapter {
  readonly provider: AiProviderKind = 'stub' as AiProviderKind;
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
    // ─── Batch 4 ──────────────────────────────────────────────────────────────
    if (prompt.includes('recruiter-behavioral-intelligence') || prompt.includes('infer behavioral dimensions')) {
      return this.defaultBehavioralResponse();
    }
    if (prompt.includes('recruiter-reputation-trust') || prompt.includes('estimate trust signals')) {
      return this.defaultReputationTrustResponse();
    }
    if (prompt.includes('recruiter-specialization-intelligence') || prompt.includes('infer specialization')) {
      return this.defaultSpecializationResponse();
    }
    if (prompt.includes('recruiter-decision-intelligence') || prompt.includes('predict decision probabilities')) {
      return this.defaultDecisionResponse();
    }
    if (prompt.includes('recruiter-insights-engine') || prompt.includes('generate actionable insights')) {
      return this.defaultInsightsResponse();
    }
    // ─── Batch 6 ──────────────────────────────────────────────────────────────
    if (prompt.includes('recruiter-copilot') || prompt.includes('respond to the user query')) {
      return this.defaultCopilotResponse();
    }
    if (prompt.includes('autonomous-recruiter-intelligence') || prompt.includes('identify alerts (ghosting risks')) {
      return this.defaultAutonomousResponse();
    }
    // ─── Job Email Classification ───────────────────────────────────────────────
    if (prompt.includes('job-email-classification') || prompt.includes('classify the following email')) {
      return this.defaultJobEmailClassificationResponse();
    }

    if (prompt.includes('resume-extraction') || prompt.includes('parse the following resume')) {
      return this.defaultResumeExtractionResponse();
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

  // ─── Batch 4 stub responses ────────────────────────────────────────────────

  private defaultBehavioralResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'communicationStyle',
          value: 'direct',
          confidence: 0.88,
          evidence: [{ excerpt: 'Direct deadline-driven messaging with explicit calls to action.' }],
        },
        {
          field: 'activityPatterns',
          value: {
            preferredDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
            preferredTimeOfDay: 'morning',
            averageResponseWindowHours: 24,
            messagingFrequency: 'frequent',
            peakActivityDescription: 'Highest activity Monday–Thursday mornings.',
          },
          confidence: 0.75,
          evidence: [{ excerpt: 'Outreach pattern suggests consistent weekday morning activity.' }],
        },
        {
          field: 'schedulingBehavior',
          value: 'self_schedules',
          confidence: 0.82,
          evidence: [{ excerpt: 'Please reply with availability — self-scheduling preference detected.' }],
        },
        {
          field: 'recruiterPreferences',
          value: ['TypeScript engineers', 'AWS expertise', 'backend experience'],
          confidence: 0.85,
          evidence: [{ excerpt: 'Explicitly requires TypeScript, AWS, Node.js experience.' }],
        },
        {
          field: 'responsivenessTrends',
          value: {
            direction: 'stable',
            magnitude: 'negligible',
            periodDays: 30,
            description: 'Consistent outreach patterns with no notable trend change.',
          },
          confidence: 0.70,
          evidence: [{ excerpt: 'Stable messaging frequency across observed interactions.' }],
        },
      ],
    });
  }

  private defaultReputationTrustResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'response_reliability',
          value: 0.82,
          confidence: 0.78,
          evidence: [{ excerpt: 'Urgent tone and explicit timelines suggest high response reliability.' }],
        },
        {
          field: 'communication_professionalism',
          value: 0.88,
          confidence: 0.82,
          evidence: [{ excerpt: 'Structured professional outreach with clear role description and compensation.' }],
        },
        {
          field: 'ghosting_probability',
          value: 0.78,  // inverted: high score = low ghosting = trustworthy
          confidence: 0.72,
          evidence: [{ excerpt: 'High urgency and explicit follow-up asks reduce ghosting likelihood.' }],
        },
        {
          field: 'candidate_experience',
          value: 0.76,
          confidence: 0.70,
          evidence: [{ excerpt: 'Compensation disclosed early, interview stage clear — positive candidate experience signal.' }],
        },
      ],
    });
  }

  private defaultSpecializationResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'hiringDomains',
          value: ['engineering', 'devops'],
          confidence: 0.88,
          evidence: [{ excerpt: 'Backend Engineering team, TypeScript, AWS, Node.js — strong engineering domain signals.' }],
        },
        {
          field: 'technologyStacks',
          value: [
            {
              stackName: 'Backend Web Stack',
              components: ['TypeScript', 'Node.js', 'AWS'],
              confidence: 0.90,
            },
          ],
          confidence: 0.87,
          evidence: [{ excerpt: 'TypeScript, AWS, Node.js explicitly mentioned as requirements.' }],
        },
      ],
    });
  }

  private defaultDecisionResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'interview_likelihood',
          value: 0.82,
          confidence: 0.80,
          evidence: [{ excerpt: 'Active technical screening stage with explicit timeline — high interview likelihood.' }],
        },
        {
          field: 'response_likelihood',
          value: 0.88,
          confidence: 0.85,
          evidence: [{ excerpt: 'High urgency and specific deadline request indicate very likely to respond.' }],
        },
        {
          field: 'offer_probability',
          value: 0.55,
          confidence: 0.72,
          evidence: [{ excerpt: 'Compensation disclosed ($180k) and decision authority signals suggest moderate-to-high offer probability.' }],
        },
        {
          field: 'engagement_probability',
          value: 0.84,
          confidence: 0.78,
          evidence: [{ excerpt: 'Highly engaged recruiter with explicit ask for availability — sustained engagement likely.' }],
        },
      ],
    });
  }

  private defaultInsightsResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'Priority Action',
          value: 'Respond within 24 hours with availability for a technical screening. This is a high-urgency role with compensation already disclosed.',
          confidence: 0.90,
          evidence: [{ excerpt: 'Urgency: high, Intent: scheduling, Compensation: $180k disclosed.' }],
        },
        {
          field: 'Communication Strategy',
          value: 'Match the recruiter direct communication style with concise, action-oriented replies.',
          confidence: 0.85,
          evidence: [{ excerpt: 'Communication style: direct, deadline-driven.' }],
        },
        {
          field: 'Timing Recommendation',
          value: 'Send availability within 48 hours and confirm interview format explicitly.',
          confidence: 0.88,
          evidence: [{ excerpt: 'High urgency with specific deadline request.' }],
        },
      ],
    });
  }

  // ─── Batch 6 ──────────────────────────────────────────────────────────────
  private defaultCopilotResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'intent',
          value: 'summarize_recruiter',
          confidence: 0.95,
          evidence: [],
        },
        {
          field: 'answerText',
          value: 'Based on the latest data, this recruiter is highly engaged and specializes in AI engineering roles.',
          confidence: 0.88,
          evidence: [{ excerpt: 'Specializes in AI engineering' }],
        },
        {
          field: 'suggestedFollowUps',
          value: ['What is their typical response time?', 'Are they hiring for senior roles?'],
          confidence: 0.90,
          evidence: [],
        },
      ],
    });
  }

  private defaultAutonomousResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'alerts',
          value: [
            {
              category: 'risk',
              title: 'Ghosting Risk Elevated',
              description: 'Recruiter has not responded to the latest message within their typical SLA.',
              severity: 'high',
              suggestedActions: [
                { type: 'draft_message', description: 'Draft a polite follow-up', priority: 'high' }
              ]
            }
          ],
          confidence: 0.82,
          evidence: [{ excerpt: 'No response in 72 hours' }],
        }
      ],
    });
  }

  private defaultJobEmailClassificationResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'category',
          value: 'Job Application',
          rawValue: 'Application received',
          confidence: 0.85,
          evidence: [{ excerpt: 'Application received — Software Engineer', confidence: 0.85 }],
        },
        {
          field: 'company',
          value: 'Example Corp',
          rawValue: 'Example Corp',
          confidence: 0.82,
          evidence: [{ excerpt: 'recruiting@example.com', confidence: 0.82 }],
        },
        {
          field: 'role',
          value: 'Software Engineer',
          rawValue: 'Software Engineer',
          confidence: 0.9,
           evidence: [{ excerpt: 'Application received — Software Engineer', confidence: 0.9 }],
        },
      ],
    });
  }

  private defaultResumeExtractionResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'skill',
          value: 'Project Management',
          rawValue: 'Project Management',
          confidence: 0.85,
          evidence: [{ excerpt: 'Project Management', confidence: 0.85 }],
        },
        {
          field: 'technology',
          value: 'Python',
          rawValue: 'Python',
          confidence: 0.85,
          evidence: [{ excerpt: 'Python', confidence: 0.85 }],
        },
        {
          field: 'occupation',
          value: 'Software Engineer',
          rawValue: 'Software Engineer',
          confidence: 0.8,
          evidence: [{ excerpt: 'Software Engineer', confidence: 0.8 }],
        },
        {
          field: 'experience',
          value: { role: 'Senior Engineer', company: 'Acme Corp', dates: '2020-Present', years: 4 },
          rawValue: 'Senior Engineer at Acme Corp (2020-Present)',
          confidence: 0.82,
          evidence: [{ excerpt: 'Senior Engineer at Acme Corp', confidence: 0.82 }],
        },
        {
          field: 'education',
          value: { degree: 'B.S.', field: 'Computer Science', institution: 'Stanford University', year: '2016' },
          rawValue: 'B.S. Computer Science, Stanford University, 2016',
          confidence: 0.8,
          evidence: [{ excerpt: 'Stanford University', confidence: 0.8 }],
        },
      ],
    });
  }
}
