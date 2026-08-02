export interface MarketMetadata {
  exchange?: string;
  currency?: string;
  isActive?: boolean;
  validFrom?: Date;
  validTo?: Date;
  [key: string]: any;
}

export interface MarketIdentifier {
  id: string;
  value: string;
  metadata?: MarketMetadata;
}

export interface CorporateAction {
  type: string;
  date: Date;
  details: Record<string, any>;
}

export interface ListingHistory {
  exchange: string;
  symbol: string;
  validFrom: Date;
  validTo?: Date;
  corporateActions?: CorporateAction[];
}
