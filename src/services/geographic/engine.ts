import { GeographicLocation } from './model';
import { LocationTypeRegistry } from './registry';

export class GeographicEngine {
  constructor(private registry: LocationTypeRegistry) {}

  public validate(location: GeographicLocation): void {
    const typeDef = this.registry.get(location.locationType);
    if (!typeDef) {
      throw new Error(`Unknown location type: ${location.locationType}`);
    }

    if (!location.hierarchy.countryCode || location.hierarchy.countryCode.length !== 2) {
      throw new Error('Valid ISO 3166-1 alpha-2 country code is required');
    }

    if (location.coordinates) {
      const { latitude, longitude } = location.coordinates;
      if (latitude < -90 || latitude > 90) throw new Error('Latitude must be between -90 and 90');
      if (longitude < -180 || longitude > 180) throw new Error('Longitude must be between -180 and 180');
    }
  }

  public normalize(location: GeographicLocation): GeographicLocation {
    return {
      ...location,
      hierarchy: {
        ...location.hierarchy,
        countryCode: location.hierarchy.countryCode.toUpperCase(),
        stateOrProvince: location.hierarchy.stateOrProvince?.toUpperCase(),
        city: location.hierarchy.city?.trim()
      }
    };
  }
}
