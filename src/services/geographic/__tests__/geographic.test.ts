import { LocationTypeRegistry, BUILT_IN_LOCATION_TYPES } from '../registry';
import { GeographicEngine } from '../engine';
import { GeographicLocation } from '../model';

describe('Geographic Intelligence Framework', () => {
  let registry: LocationTypeRegistry;
  let engine: GeographicEngine;

  beforeEach(() => {
    registry = new LocationTypeRegistry();
    BUILT_IN_LOCATION_TYPES.forEach(t => registry.register(t));
    engine = new GeographicEngine(registry);
  });

  it('validates correct location', () => {
    const loc: GeographicLocation = {
      id: '1',
      locationType: 'headquarters',
      hierarchy: { countryCode: 'US', stateOrProvince: 'CA', city: 'San Francisco' },
      coordinates: { latitude: 37.7749, longitude: -122.4194 }
    };
    expect(() => engine.validate(loc)).not.toThrow();
  });

  it('rejects invalid country code', () => {
    const loc: GeographicLocation = {
      id: '1',
      locationType: 'office',
      hierarchy: { countryCode: 'USA' }
    };
    expect(() => engine.validate(loc)).toThrow(/ISO 3166-1 alpha-2/);
  });

  it('rejects invalid coordinates', () => {
    const loc: GeographicLocation = {
      id: '1',
      locationType: 'office',
      hierarchy: { countryCode: 'US' },
      coordinates: { latitude: 100, longitude: 0 }
    };
    expect(() => engine.validate(loc)).toThrow(/Latitude/);
  });

  it('normalizes text fields', () => {
    const loc: GeographicLocation = {
      id: '1',
      locationType: 'office',
      hierarchy: { countryCode: 'us', stateOrProvince: 'ca', city: ' San Francisco ' }
    };
    const normalized = engine.normalize(loc);
    expect(normalized.hierarchy.countryCode).toBe('US');
    expect(normalized.hierarchy.stateOrProvince).toBe('CA');
    expect(normalized.hierarchy.city).toBe('San Francisco');
  });
});
