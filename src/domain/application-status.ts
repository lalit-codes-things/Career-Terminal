import { ApplicationStatus as PrismaApplicationStatus } from '@prisma/client';

export const ApplicationStatus = PrismaApplicationStatus;
export type ApplicationStatus = PrismaApplicationStatus;

export const APPLICATION_STATUSES = Object.freeze([
  ApplicationStatus.SAVED,
  ApplicationStatus.APPLIED,
  ApplicationStatus.SCREENING,
  ApplicationStatus.ASSESSMENT,
  ApplicationStatus.INTERVIEW,
  ApplicationStatus.OFFER,
  ApplicationStatus.REJECTED,
  ApplicationStatus.WITHDRAWN,
] as const);

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return APPLICATION_STATUSES.includes(value as ApplicationStatus);
}

export function normalizeApplicationStatus(value: string): ApplicationStatus | null {
  const normalized = value.trim().toUpperCase();
  return isApplicationStatus(normalized) ? normalized : null;
}
