import { dbRouter } from '../../config/database';
import type { JobApplication } from '@prisma/client';
import type { ExtractedJobData } from '../application-tracking/application-tracking.service';
import type { ClassifiableEmail } from '../job-intelligence';
import { userOwnershipFilter } from '../../utils/user-ownership';

export interface MergeDecision {
  targetApplication: JobApplication | null;
  confidenceScore: number;
  reasons: string[];
}

export class ApplicationMergeService {
  /**
   * Evaluates incoming job application data against existing records to find a suitable merge target.
   *
   * When `incomingOpportunityId` is provided (from canonical Opportunity resolution),
   * any existing application sharing the same `opportunity_id` is treated as a near-certain
   * match (100 confidence) — this is the strongest deduplication signal.
   */
  public async findMatch(
    userId: string,
    incomingData: ExtractedJobData,
    sourceEmail: ClassifiableEmail,
    candidateEmail?: string,
    atsApplicationId?: string,
    incomingOpportunityId?: string,
  ): Promise<MergeDecision> {
    const where: Record<string, unknown> = {
      ...userOwnershipFilter(userId),
      status: {
        notIn: ['REJECTED', 'WITHDRAWN'],
      },
    };

    if (incomingOpportunityId) {
      where.opportunityId = incomingOpportunityId;
    } else if (atsApplicationId) {
      where.atsApplicationId = atsApplicationId;
    } else if (incomingData.company.domain) {
      where.companyDomain = incomingData.company.domain;
    }

    const candidates = await dbRouter.read().jobApplication.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      take: 50,
    });

    let bestMatch: JobApplication | null = null;
    let highestConfidence = -1;
    let bestReasons: string[] = [];

    for (const candidate of candidates) {
      const { confidence, reasons } = this.calculateConfidence(
        candidate,
        incomingData,
        sourceEmail,
        candidateEmail,
        atsApplicationId,
        incomingOpportunityId,
      );

      if (confidence > highestConfidence || highestConfidence === -1) {
        highestConfidence = confidence;
        bestMatch = candidate;
        bestReasons = reasons;
      }
    }

    if (highestConfidence === -1) highestConfidence = 0;

    if (highestConfidence >= 80 && bestMatch) {
      return {
        targetApplication: bestMatch,
        confidenceScore: highestConfidence,
        reasons: bestReasons,
      };
    }

    return { targetApplication: null, confidenceScore: highestConfidence, reasons: bestReasons };
  }

  private calculateConfidence(
    existingApp: JobApplication,
    incomingData: ExtractedJobData,
    sourceEmail: ClassifiableEmail,
    candidateEmail?: string,
    atsApplicationId?: string,
    incomingOpportunityId?: string,
  ): { confidence: number; reasons: string[] } {
    let confidence = 0;
    const reasons: string[] = [];

    // ── Strongest signal: canonical opportunity_id match ────────────────────
    // When both sides have resolved to the same opportunity, treat it as a
    // definitive match.  This short-circuits the company/role text checks.
    if (
      incomingOpportunityId &&
      (existingApp as JobApplication & { opportunityId?: string | null }).opportunityId ===
        incomingOpportunityId
    ) {
      return {
        confidence: 100,
        reasons: ['+100: Exact canonical opportunity_id match'],
      };
    }

    // STRICT REJECT: Different Companies
    // We check domains or exact name matches
    const sameDomain = existingApp.companyDomain === incomingData.company.domain;
    const sameName =
      existingApp.companyName?.toLowerCase() === incomingData.company.name.toLowerCase();

    if (!sameDomain && !sameName) {
      return { confidence: 0, reasons: ['Strict Reject: Different companies'] };
    }

    // STRICT REJECT: Wildly different roles unless we have exact ATS id
    const sameRole = existingApp.roleTitle?.toLowerCase() === incomingData.role.title.toLowerCase();
    const roleIsSubstring =
      existingApp.roleTitle?.toLowerCase().includes(incomingData.role.title.toLowerCase()) ||
      incomingData.role.title.toLowerCase().includes(existingApp.roleTitle?.toLowerCase() ?? '');

    if (!sameRole && !roleIsSubstring && existingApp.atsApplicationId !== atsApplicationId) {
      return { confidence: 0, reasons: ['Strict Reject: Different roles without ATS ID override'] };
    }

    // Primary Signals
    if (atsApplicationId && existingApp.atsApplicationId === atsApplicationId) {
      confidence += 100;
      reasons.push('+100: Exact ATS Application ID match');
    } else {
      if (sameRole) {
        confidence += 50;
        reasons.push('+50: Exact role match');
      } else if (roleIsSubstring) {
        confidence += 30;
        reasons.push('+30: Role fuzzy match');
      }

      if (candidateEmail && existingApp.candidateEmail === candidateEmail) {
        confidence += 20;
        reasons.push('+20: Candidate email match');
      }
    }

    // Secondary Signals
    if (sourceEmail.threadId && existingApp.threadIds?.includes(sourceEmail.threadId)) {
      confidence += 30;
      reasons.push('+30: Thread ID match');
    }

    if (
      incomingData.recruiter.email &&
      existingApp.recruiterEmail === incomingData.recruiter.email
    ) {
      confidence += 20;
      reasons.push('+20: Recruiter email match');
    }

    // Date proximity (within 14 days)
    const existingDate = existingApp.appliedDate?.getTime() ?? 0;
    const incomingDate = incomingData.appliedDate.getTime();
    const diffDays = Math.abs(existingDate - incomingDate) / (1000 * 60 * 60 * 24);

    if (diffDays <= 14) {
      confidence += 15;
      reasons.push(`+15: Close application date (${diffDays.toFixed(1)} days apart)`);
    }

    return { confidence: Math.min(confidence, 100), reasons };
  }
}

export const applicationMergeService = new ApplicationMergeService();
