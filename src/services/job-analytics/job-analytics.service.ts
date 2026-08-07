import { dbRouter } from '../../config/database';
import { ApplicationStatus } from '../../domain/application-status';
import { ApplicationTimelineEventType } from '../application-timeline';

export interface JobAnalytics {
  applications: number;
  responses: number;
  interviews: number;
  offers: number;
  conversionRates: {
    responseRate: number;
    interviewRate: number;
    offerRate: number;
  };
  averageResponseTimeDays: number;
  companiesAppliedTo: number;
  mostSuccessfulJobCategories: Array<{
    category: string;
    applications: number;
    interviews: number;
    interviewRate: number;
  }>;
}

export class JobAnalyticsService {
  public async getAnalytics(userId: string): Promise<JobAnalytics> {
    const applications = await dbRouter.read().jobApplication.findMany({
      where: { userId },
      select: {
        id: true,
        appliedDate: true,
        updatedAt: true,
        companyDomain: true,
        roleDepartment: true,
        status: true,
        timeline: {
          select: {
            eventType: true,
            description: true,
            timestamp: true,
          },
        },
      },
    });

    const totalApplications = applications.length;

    if (totalApplications === 0) {
      return {
        applications: 0,
        responses: 0,
        interviews: 0,
        offers: 0,
        conversionRates: {
          responseRate: 0,
          interviewRate: 0,
          offerRate: 0,
        },
        averageResponseTimeDays: 0,
        companiesAppliedTo: 0,
        mostSuccessfulJobCategories: [],
      };
    }

    const uniqueCompanies = new Set(applications.map((app) => app.companyDomain).filter(Boolean));
    const responseStatuses = new Set<ApplicationStatus>([
      ApplicationStatus.SCREENING,
      ApplicationStatus.INTERVIEW,
      ApplicationStatus.ASSESSMENT,
      ApplicationStatus.OFFER,
      ApplicationStatus.REJECTED,
      ApplicationStatus.WITHDRAWN,
    ]);
    const interviewStatuses = new Set<ApplicationStatus>([
      ApplicationStatus.INTERVIEW,
      ApplicationStatus.ASSESSMENT,
      ApplicationStatus.OFFER,
    ]);

    let responsesCount = 0;
    let interviewsCount = 0;
    let offersCount = 0;
    let totalResponseTimeMs = 0;
    let responseTimeCount = 0;

    const categoryStats = new Map<string, { applications: number; interviews: number }>();

    for (const app of applications) {
      const isResponseStatus = (status: string | undefined) =>
        status ? responseStatuses.has(status as ApplicationStatus) : false;

      const isInterviewStatus = (status: string | undefined) =>
        status ? interviewStatuses.has(status as ApplicationStatus) : false;

      const isOfferStatus = (status: string | undefined) => status === ApplicationStatus.OFFER;

      const allStatuses = [
        app.status,
        ...app.timeline.flatMap((timelineEvent) => this.mapTimelineEventToStatuses(timelineEvent)),
      ].filter(Boolean);

      const gotResponse = allStatuses.some(isResponseStatus);
      const gotInterview = allStatuses.some(isInterviewStatus);
      const gotOffer = allStatuses.some(isOfferStatus);

      if (gotResponse) {
        responsesCount++;

        // Calculate response time
        // Find the earliest timeline event that indicates a response
        const responseEvents = app.timeline.filter((timelineEvent) =>
          this.mapTimelineEventToStatuses(timelineEvent).some(isResponseStatus),
        );

        if (responseEvents.length > 0) {
          const earliestResponse = new Date(
            Math.min(...responseEvents.map((e) => e.timestamp.getTime())),
          );
          const responseTimeMs = earliestResponse.getTime() - (app.appliedDate?.getTime() ?? 0);
          if (responseTimeMs >= 0) {
            totalResponseTimeMs += responseTimeMs;
            responseTimeCount++;
          }
        } else if (isResponseStatus(app.status)) {
          // Fallback if no timeline event but status is a response status
          const responseTimeMs = app.updatedAt.getTime() - (app.appliedDate?.getTime() ?? 0);
          if (responseTimeMs >= 0) {
            totalResponseTimeMs += responseTimeMs;
            responseTimeCount++;
          }
        }
      }

      if (gotInterview) {
        interviewsCount++;
      }

      if (gotOffer) {
        offersCount++;
      }

      // Group by category
      const category = app.roleDepartment || 'Other';
      if (!categoryStats.has(category)) {
        categoryStats.set(category, { applications: 0, interviews: 0 });
      }
      const stats = categoryStats.get(category)!;
      stats.applications++;
      if (gotInterview) {
        stats.interviews++;
      }
    }

    const averageResponseTimeDays =
      responseTimeCount > 0
        ? Math.round((totalResponseTimeMs / responseTimeCount / (1000 * 60 * 60 * 24)) * 10) / 10
        : 0;

    const mostSuccessfulJobCategories = Array.from(categoryStats.entries())
      .map(([category, stats]) => ({
        category,
        applications: stats.applications,
        interviews: stats.interviews,
        interviewRate: stats.applications > 0 ? stats.interviews / stats.applications : 0,
      }))
      .sort((a, b) => b.interviewRate - a.interviewRate || b.applications - a.applications)
      .slice(0, 5);

    return {
      applications: totalApplications,
      responses: responsesCount,
      interviews: interviewsCount,
      offers: offersCount,
      conversionRates: {
        responseRate: responsesCount / totalApplications,
        interviewRate: interviewsCount / totalApplications,
        offerRate: offersCount / totalApplications,
      },
      averageResponseTimeDays,
      companiesAppliedTo: uniqueCompanies.size,
      mostSuccessfulJobCategories,
    };
  }

  private mapTimelineEventToStatuses(timelineEvent: {
    eventType: string;
    description?: string | null;
  }): string[] {
    switch (timelineEvent.eventType) {
      case ApplicationTimelineEventType.APPLICATION_SUBMITTED:
      case ApplicationTimelineEventType.APPLICATION_CONFIRMED:
        return [ApplicationStatus.APPLIED];
      case ApplicationTimelineEventType.RECRUITER_CONTACT:
        return [ApplicationStatus.SCREENING];
      case ApplicationTimelineEventType.ASSESSMENT:
      case ApplicationTimelineEventType.ASSESSMENT_COMPLETED:
        return [ApplicationStatus.ASSESSMENT];
      case ApplicationTimelineEventType.PHONE_SCREEN:
      case ApplicationTimelineEventType.INTERVIEW:
      case ApplicationTimelineEventType.FINAL_INTERVIEW:
        return [ApplicationStatus.INTERVIEW];
      case ApplicationTimelineEventType.OFFER:
        return [ApplicationStatus.OFFER];
      case ApplicationTimelineEventType.REJECTION:
        return [ApplicationStatus.REJECTED];
      case ApplicationTimelineEventType.WITHDRAWN:
        return [ApplicationStatus.WITHDRAWN];
      default: {
        const legacyMatch = timelineEvent.description?.match(/updated to (.*)/);
        return legacyMatch?.[1] ? [legacyMatch[1]] : [];
      }
    }
  }
}

export const jobAnalyticsService = new JobAnalyticsService();
