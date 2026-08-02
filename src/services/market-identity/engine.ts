import { MarketIdentifier, ListingHistory } from './model';
import { IdentifierRegistry } from './registry';

export class MarketIdentityEngine {
  constructor(private registry: IdentifierRegistry) {}

  public validateIdentifier(identifier: MarketIdentifier): void {
    const typeDef = this.registry.get(identifier.id);
    if (!typeDef) {
      throw new Error(`Unknown identifier type: ${identifier.id}`);
    }
    if (!identifier.value) {
      throw new Error(`Identifier value cannot be empty`);
    }
  }

  public mapIdentifier(identifiers: MarketIdentifier[], targetIdType: string): MarketIdentifier | undefined {
    return identifiers.find(id => id.id === targetIdType);
  }

  public detectTickerReuse(history: ListingHistory[], newListing: ListingHistory): boolean {
    return history.some(h => 
      h.symbol === newListing.symbol &&
      h.exchange === newListing.exchange &&
      ((!h.validTo && newListing.validFrom > h.validFrom) || (h.validTo && newListing.validFrom > h.validTo))
    );
  }
}
