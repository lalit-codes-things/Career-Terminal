import type { AiAdapterRequest, AiAdapterResponse, AiModelAdapter } from '../types';

export class StubAiAdapter implements AiModelAdapter {
  readonly provider = 'stub';
  readonly supportedModels = ['stub-fast', 'stub-balanced', 'stub-powerful'];

  private readonly responses = new Map<string, string>();

  registerResponse(keyword: string, jsonResponse: string): void {
    this.responses.set(keyword.toLowerCase(), jsonResponse);
  }

  async complete(request: AiAdapterRequest): Promise<AiAdapterResponse> {
    const start = Date.now();

    const combined = `${request.systemPrompt}\n${request.userPrompt}`.toLowerCase();
    let rawText = this.matchResponse(combined);

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

    if (prompt.includes('recruiter-entity-extraction') || prompt.includes('extract recruiter intelligence')) {
      return this.defaultEntityExtractionResponse();
    }
    if (prompt.includes('recruiter-reasoning-enrichment') || prompt.includes('infer hidden attributes') || prompt.includes('infer recruiter attributes')) {
      return this.defaultReasoningResponse();
    }
    if (prompt.includes('recruiter intelligence profile') || prompt.includes('generate a recruiter intelligence profile')) {
      return this.defaultProfileResponse();
    }
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
    if (prompt.includes('recruiter-copilot') || prompt.includes('respond to the user query')) {
      return this.defaultCopilotResponse();
    }
    if (prompt.includes('autonomous-recruiter-intelligence') || prompt.includes('identify alerts (ghosting risks')) {
      return this.defaultAutonomousResponse();
    }
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
          value: { name: 'example-recruiter' },
          rawValue: 'example-recruiter',
          confidence: 0.92,
          evidence: [{ excerpt: 'example-recruiter', confidence: 0.92 }],
        },
        {
          field: 'recruiter_title',
          value: { title: 'example-recruiter-title' },
          rawValue: 'example-recruiter-title',
          confidence: 0.88,
          evidence: [{ excerpt: 'example-recruiter-title', confidence: 0.88 }],
        },
        {
          field: 'recruiter_organization',
          value: { name: 'example-organization' },
          rawValue: 'example-organization',
          confidence: 0.85,
          evidence: [{ excerpt: 'example-organization', confidence: 0.85 }],
        },
        {
          field: 'technology',
          value: { name: 'example-technology' },
          rawValue: 'example-technology',
          confidence: 0.9,
          evidence: [{ excerpt: 'example-technology', confidence: 0.9 }],
        },
        {
          field: 'interview_stage',
          value: { stage: 'example_stage' },
          rawValue: 'example stage',
          confidence: 0.82,
          evidence: [{ excerpt: 'example stage', confidence: 0.82 }],
        },
        {
          field: 'compensation_mention',
          value: { mentioned: true, amount: 0, currency: 'USD' },
          rawValue: 'example-compensation',
          confidence: 0.95,
          evidence: [{ excerpt: 'example-compensation', confidence: 0.95 }],
        },
      ],
    });
  }

  private defaultReasoningResponse(): string {
    return JSON.stringify({
      inferences: [
        {
          attribute: 'seniority',
          value: 'mid',
          reasoning: 'Title and message indicate mid-level responsibility with structured communication patterns.',
          confidence: 0.87,
          supportingEvidence: ['example-title evidence', 'Structured communication detected'],
        },
        {
          attribute: 'specialization',
          value: 'example-domain',
          reasoning: 'References example-technology which are domain-specific signals.',
          confidence: 0.91,
          supportingEvidence: ['example-technology mentioned', 'example-domain signals'],
        },
        {
          attribute: 'hiringFocus',
          value: ['example-role-primary', 'example-role-secondary'],
          reasoning: 'References indicate focus on key professional roles.',
          confidence: 0.82,
          supportingEvidence: ['example-technology', 'example-domain'],
        },
        {
          attribute: 'technicalDomains',
          value: ['example-domain-1', 'example-domain-2'],
          reasoning: 'Domain indicators suggest general professional focus areas.',
          confidence: 0.85,
          supportingEvidence: ['example-technology'],
        },
        {
          attribute: 'urgency',
          value: 'medium',
          reasoning: 'Message includes follow-up request with standard timeline.',
          confidence: 0.9,
          supportingEvidence: ['Timeline mentioned', 'follow-up requested'],
        },
        {
          attribute: 'decisionAuthority',
          value: 'evaluator',
          reasoning: 'References to decision-making and scheduling indicate evaluation-level authority.',
          confidence: 0.78,
          supportingEvidence: ['Scheduling reference', 'Decision-making signals'],
        },
        {
          attribute: 'communicationIntent',
          value: 'scheduling',
          reasoning: 'Primary ask is to schedule a meeting by a specific date.',
          confidence: 0.93,
          supportingEvidence: ['Please schedule an interview by Friday'],
        },
        {
          attribute: 'followUpRequirements',
          value: ['Send availability', 'Confirm format'],
          reasoning: 'Explicit asks for candidate availability and confirmation.',
          confidence: 0.88,
          supportingEvidence: ['Please reply with availability'],
        },
      ],
    });
  }

  private defaultProfileResponse(): string {
    return JSON.stringify({
      summary: 'example-recruiter is an example-recruiter-title at example-organization. They communicate with standard urgency and clear action items.',
      hiringFocus: ['example-role-primary', 'example-role-secondary'],
      technicalFocus: ['example-technology', 'example-domain'],
      industryFocus: ['example-industry'],
      organizationContext: {
        organization: 'example-organization',
        department: 'example-department',
        seniorityLevel: 'example-level',
      },
      communicationStyle: 'Structured with clear action items and standard timelines.',
      recruitingStyle: 'Standard screening with early information sharing.',
      hiringVelocitySignals: {
        urgency: 'medium',
        typicalResponseWindow: '24-48 hours',
        pipelineStage: 'active_screening',
      },
      relationshipStrength: {
        score: 0.62,
        signals: ['first_contact', 'inbound_reach_out'],
      },
      candidateFitSignals: [
        'example-technology proficiency preferred',
        'Availability within the week',
      ],
    });
  }

  private defaultBehavioralResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'communicationStyle',
          value: 'structured',
          confidence: 0.88,
          evidence: [{ excerpt: 'Structured communication with clear action items.' }],
        },
        {
          field: 'activityPatterns',
          value: {
            preferredDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday'],
            preferredTimeOfDay: 'morning',
            averageResponseWindowHours: 24,
            messagingFrequency: 'standard',
            peakActivityDescription: 'Consistent weekday morning activity patterns.',
          },
          confidence: 0.75,
          evidence: [{ excerpt: 'Consistent weekday communication patterns.' }],
        },
        {
          field: 'schedulingBehavior',
          value: 'prefers_self_schedule',
          confidence: 0.82,
          evidence: [{ excerpt: 'Availability request for scheduling.' }],
        },
        {
          field: 'recruiterPreferences',
          value: ['example-profile-a', 'example-profile-b'],
          confidence: 0.85,
          evidence: [{ excerpt: 'Requirements mentioned for role matching.' }],
        },
        {
          field: 'responsivenessTrends',
          value: {
            direction: 'stable',
            magnitude: 'negligible',
            periodDays: 30,
            description: 'Consistent communication patterns with no notable trend change.',
          },
          confidence: 0.70,
          evidence: [{ excerpt: 'Stable communication frequency across interactions.' }],
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
          evidence: [{ excerpt: 'Standard urgency and explicit follow-up asks suggest reliable responses.' }],
        },
        {
          field: 'communication_professionalism',
          value: 0.88,
          confidence: 0.82,
          evidence: [{ excerpt: 'Structured professional outreach with clear role description.' }],
        },
        {
          field: 'ghosting_probability',
          value: 0.78,
          confidence: 0.72,
          evidence: [{ excerpt: 'Standard urgency and specific follow-up asks reduce ghosting likelihood.' }],
        },
        {
          field: 'candidate_experience',
          value: 0.76,
          confidence: 0.70,
          evidence: [{ excerpt: 'Early information and clear stage signals suggest positive candidate experience.' }],
        },
      ],
    });
  }

  private defaultSpecializationResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'hiringDomains',
          value: ['example-domain', 'example-subdomain'],
          confidence: 0.88,
          evidence: [{ excerpt: 'Domain indicators suggest general professional focus areas.' }],
        },
        {
          field: 'technologyStacks',
          value: [
            {
              stackName: 'example-stack',
              components: ['example-component-1', 'example-component-2'],
              confidence: 0.90,
            },
          ],
          confidence: 0.87,
          evidence: [{ excerpt: 'example-component-1, example-component-2 mentioned in context.' }],
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
          evidence: [{ excerpt: 'Active screening stage with explicit timeline — moderate-to-high interview likelihood.' }],
        },
        {
          field: 'response_likelihood',
          value: 0.88,
          confidence: 0.85,
          evidence: [{ excerpt: 'Standard urgency and specific request indicate likely to respond.' }],
        },
        {
          field: 'offer_probability',
          value: 0.55,
          confidence: 0.72,
          evidence: [{ excerpt: 'Compensation and decision authority signals suggest moderate offer probability.' }],
        },
        {
          field: 'engagement_probability',
          value: 0.84,
          confidence: 0.78,
          evidence: [{ excerpt: 'Engaged recruiter with explicit availability request — sustained engagement likely.' }],
        },
      ],
    });
  }

  private defaultInsightsResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'Priority Action',
          value: 'Reply within standard timeframe with availability. The role has specific requirements.',
          confidence: 0.90,
          evidence: [{ excerpt: 'Urgency: standard, Intent: scheduling, Requirements clearly stated.' }],
        },
        {
          field: 'Communication Strategy',
          value: 'Match the recruiter structured communication style with concise, action-oriented replies.',
          confidence: 0.85,
          evidence: [{ excerpt: 'Communication style: structured.' }],
        },
        {
          field: 'Timing Recommendation',
          value: 'Send availability within 48 hours and confirm format explicitly.',
          confidence: 0.88,
          evidence: [{ excerpt: 'Standard urgency with specific request.' }],
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
          value: 'Based on the latest data, this recruiter is engaged and specializes in example-domain roles.',
          confidence: 0.88,
          evidence: [{ excerpt: 'Specializes in example-domain' }],
        },
        {
          field: 'suggestedFollowUps',
          value: ['What is their typical response time?', 'Are they hiring for relevant roles?'],
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
              title: 'Follow-up Required',
              description: 'No response within expected timeframe. Follow-up recommended.',
              severity: 'medium',
              suggestedActions: [
                { type: 'draft_message', description: 'Draft a follow-up message', priority: 'normal' }
              ]
            }
          ],
          confidence: 0.82,
          evidence: [{ excerpt: 'No response within expected timeframe' }],
        }
      ],
    });
  }

  // ─── Job Email Classification ───────────────────────────────────────────────
  private defaultJobEmailClassificationResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'category',
          value: 'Job Application',
          rawValue: 'Application received',
          confidence: 0.85,
          evidence: [{ excerpt: 'Application received', confidence: 0.85 }],
        },
        {
          field: 'company',
          value: 'example-organization',
          rawValue: 'example-organization',
          confidence: 0.82,
          evidence: [{ excerpt: 'recruiting@example-organization', confidence: 0.82 }],
        },
        {
          field: 'role',
          value: 'example-role',
          rawValue: 'example-role',
          confidence: 0.9,
          evidence: [{ excerpt: 'Application received — example-role', confidence: 0.9 }],
        },
      ],
    });
  }

  private defaultResumeExtractionResponse(): string {
    return JSON.stringify({
      fields: [
        {
          field: 'skill',
          value: 'example-skill',
          rawValue: 'example-skill',
          confidence: 0.85,
          evidence: [{ excerpt: 'example-skill', confidence: 0.85 }],
        },
        {
          field: 'technology',
          value: 'example-technology',
          rawValue: 'example-technology',
          confidence: 0.85,
          evidence: [{ excerpt: 'example-technology', confidence: 0.85 }],
        },
        {
          field: 'occupation',
          value: 'example-occupation',
          rawValue: 'example-occupation',
          confidence: 0.8,
          evidence: [{ excerpt: 'example-occupation', confidence: 0.8 }],
        },
        {
          field: 'experience',
          value: { role: 'example-role', company: 'example-organization', dates: '2020-Present', years: 4 },
          rawValue: 'example-role at example-organization (2020-Present)',
          confidence: 0.82,
          evidence: [{ excerpt: 'example-role at example-organization', confidence: 0.82 }],
        },
        {
          field: 'education',
          value: { degree: 'example-degree', field: 'example-field', institution: 'example-institution', year: '2016' },
          rawValue: 'example-degree example-field, example-institution, 2016',
          confidence: 0.8,
          evidence: [{ excerpt: 'example-institution', confidence: 0.8 }],
        },
      ],
    });
  }
}
