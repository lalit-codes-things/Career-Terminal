export interface GeographicMetadata {
  languages?: string[];
  currencies?: string[];
  timezone?: string;
  provider?: string;
  confidence?: number;
  [key: string]: any;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface AdministrativeHierarchy {
  countryCode: string;
  stateOrProvince?: string;
  district?: string;
  city?: string;
  postalCode?: string;
}

export interface GeographicLocation {
  id: string;
  locationType: string;
  hierarchy: AdministrativeHierarchy;
  coordinates?: Coordinates;
  metadata?: GeographicMetadata;
}
