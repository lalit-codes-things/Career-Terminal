import { IdentifierRegistry, BUILT_IN_IDENTIFIERS } from '../registry';
import { MarketIdentityEngine } from '../engine';
import { MarketIdentifier, ListingHistory } from '../model';

describe('Market Identity Framework', () => {
  let registry: IdentifierRegistry;
  let engine: MarketIdentityEngine;

  beforeEach(() => {
    registry = new IdentifierRegistry();
    BUILT_IN_IDENTIFIERS.forEach(i => registry.register(i));
    engine = new MarketIdentityEngine(registry);
  });

  it('validates known identifier', () => {
    const id: MarketIdentifier = { id: 'cik', value: '0000320193' };
    expect(() => engine.validateIdentifier(id)).not.toThrow();
  });

  it('rejects unknown identifier', () => {
    const id: MarketIdentifier = { id: 'unknown', value: '123' };
    expect(() => engine.validateIdentifier(id)).toThrow(/Unknown identifier type/);
  });

  it('maps identifier', () => {
    const ids: MarketIdentifier[] = [
      { id: 'cik', value: '123' },
      { id: 'ticker', value: 'AAPL' }
    ];
    const mapped = engine.mapIdentifier(ids, 'ticker');
    expect(mapped?.value).toBe('AAPL');
  });

  it('detects ticker reuse', () => {
    const history: ListingHistory[] = [
      { exchange: 'NASDAQ', symbol: 'TEST', validFrom: new Date('2000-01-01'), validTo: new Date('2010-01-01') }
    ];
    const newListing: ListingHistory = { exchange: 'NASDAQ', symbol: 'TEST', validFrom: new Date('2011-01-01') };
    expect(engine.detectTickerReuse(history, newListing)).toBe(true);
  });
});
