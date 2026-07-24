import { prisma } from '../../config/database';
import type { JobApplication } from '@prisma/client';
import type { ExtractedJobData } from '../application-tracking/application-tracking.service';
import type { ClassifiableEmail } from '../job-intelligence';

export interface MergeDecision {
  targetApplication: JobApplication | null;
  confidenceScore: number;
  reasons: string[];
}

export class ApplicationMergeService {
  /**
   * Evaluates incoming job application data against existing records to find a suitable merge target.
   */
  public async findMatch(
    userId: string,
    incomingData: ExtractedJobData,
    sourceEmail: ClassifiableEmail,
    candidateEmail?: string,
    atsApplicationId?: string,
  ): Promise<MergeDecision> {
    // 1. Fetch potential candidates for the user
    // To be efficient, we fetch all applications for the user, but in a real massive scale system
    // we would filter by companyDomain first. Since a user has bounded applications, fetching all or
    // filtering by company is fine.
    const candidates = await prisma.jobApplication.findMany({
      where: { userId },
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
      );

      // Always track the best reasons for debugging (including strict rejects at 0)
      if (confidence > highestConfidence || highestConfidence === -1) {
        highestConfidence = confidence;
        bestMatch = candidate;
        bestReasons = reasons;
      }
    }

    // Normalize (-1 means no candidates)
    if (highestConfidence === -1) highestConfidence = 0;

    // Threshold for merging
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
  ): { confidence: number; reasons: string[] } {
    let confidence = 0;
    const reasons: string[] = [];

    // STRICT REJECT: Different Companies
    // We check domains or exact name matches
    const sameDomain = existingApp.companyDomain === incomingData.company.domain;
    const sameName =
      existingApp.companyName.toLowerCase() === incomingData.company.name.toLowerCase();

    if (!sameDomain && !sameName) {
      return { confidence: 0, reasons: ['Strict Reject: Different companies'] };
    }

    // STRICT REJECT: Wildly different roles unless we have exact ATS id
    const sameRole = existingApp.roleTitle.toLowerCase() === incomingData.role.title.toLowerCase();
    const roleIsSubstring =
      existingApp.roleTitle.toLowerCase().includes(incomingData.role.title.toLowerCase()) ||
      incomingData.role.title.toLowerCase().includes(existingApp.roleTitle.toLowerCase());

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
    const existingDate = existingApp.appliedDate.getTime();
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
