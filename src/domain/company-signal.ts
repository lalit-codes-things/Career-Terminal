/**
 * CompanySignal domain contracts — Section 7 of the architecture directive.
 *
 * Represents external signals about a company that may affect opportunity
 * quality, hiring velocity, or strategic fit.
 */

export interface CompanySignalInput {
  readonly companyId: string;
  readonly signalType: string;
  readonly category: string;
  readonly headline: string;
  readonly description?: string;
  readonly sourceUrl?: string;
  readonly sourceName?: string;
  readonly publicationTime?: Date;
  readonly confidence?: number;
  readonly affectedAreas?: readonly string[];
  readonly estimatedImpact?: string;
}

export interface CompanySignalRecord {
  readonly id: string;
  readonly companyId: string;
  readonly signalType: string;
  readonly category: string;
  readonly headline: string;
  readonly description: string | null;
  readonly sourceUrl: string | null;
  readonly sourceName: string | null;
  readonly publicationTime: Date | null;
  readonly discoveryTime: Date;
  readonly confidence: number;
  readonly affectedAreas: readonly string[];
  readonly estimatedImpact: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const COMPANY_SIGNAL_TYPES = {
  HIRING_VELOCITY: 'HIRING_VELOCITY',
  HIRING_SLOWDOWN: 'HIRING_SLOWDOWN',
  LAYOFFS: 'LAYOFFS',
  EXPANSION: 'EXPANSION',
  FUNDING: 'FUNDING',
  ACQUISITION: 'ACQUISITION',
  RESTRUCTURING: 'RESTRUCTURING',
  LEADERSHIP_CHANGE: 'LEADERSHIP_CHANGE',
  PRODUCT_LAUNCH: 'PRODUCT_LAUNCH',
  REVENUE_CHANGE: 'REVENUE_CHANGE',
  MARKET_ANNOUNCEMENT: 'MARKET_ANNOUNCEMENT',
} as const;

export type CompanySignalType = (typeof COMPANY_SIGNAL_TYPES)[keyof typeof COMPANY_SIGNAL_TYPES];
