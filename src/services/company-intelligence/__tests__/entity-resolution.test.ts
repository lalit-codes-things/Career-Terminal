import type { NormalizedCompanyData } from '../contracts';
import { CompanyEntityResolver, EntityResolutionConflictError } from '../entities';
import { InMemoryCompanyIntelRepository } from '../repository';

const record = (
  overrides: Partial<NormalizedCompanyData> = {},
): NormalizedCompanyData => ({
  providerKey: 'companies-house',
  providerRecordId: '01234567',
  name: 'Acme Ltd',
  normalizedName: 'acme',
  jurisdiction: 'GB',
  countryCode: 'GB',
  aliases: [],
  identifiers: [{ type: 'company_number', value: '01234567', normalizedValue: '01234567' }],
  addresses: [],
  websites: [],
  industryClassifications: [],
  exchangeListings: [],
  status: 'active',
  fetchedAt: '2024-01-01T00:00:00.000Z',
  checksum: 'abc',
  ...overrides,
});

describe('CompanyEntityResolver', () => {
  let repo: InMemoryCompanyIntelRepository;
  let resolver: CompanyEntityResolver;

  beforeEach(() => {
    repo = new InMemoryCompanyIntelRepository();
    resolver = new CompanyEntityResolver(repo);
  });

  it('creates a new company when nothing matches', async () => {
    const result = await resolver.resolve(record());
    expect(result.created).toBe(true);
    expect(result.matched).toBe(false);
    expect(result.matchedBy).toEqual([]);
    expect(result.canonicalCompanyId).toMatch(/[0-9a-f-]{36}/);
  });

  it('matches an existing company by identifier', async () => {
    await repo.persistCompany(record(), await resolver.resolve(record()));

    const result = await resolver.resolve(record());
    expect(result.created).toBe(false);
    expect(result.matched).toBe(true);
    expect(result.matchedBy).toContain('identifier:company_number');
  });

  it('matches by domain when no identifier exists', async () => {
    const first = record({ identifiers: [], domain: 'acme.example' });
    await repo.persistCompany(first, await resolver.resolve(first));

    const second = record({ identifiers: [], domain: 'acme.example' });
    const result = await resolver.resolve(second);
    expect(result.matchedBy).toContain('domain');
    expect(result.created).toBe(false);
  });

  it('matches by exact name + jurisdiction as a fallback', async () => {
    const first = record({ identifiers: [] });
    await repo.persistCompany(first, await resolver.resolve(first));

    const second = record({ identifiers: [] });
    const result = await resolver.resolve(second);
    expect(result.matchedBy).toContain('name');
  });

  it('throws a conflict when identifiers point at different companies', async () => {
    const a = record({ identifiers: [{ type: 'company_number', value: '00000001', normalizedValue: '00000001' }] });
    await repo.persistCompany(a, await resolver.resolve(a));

    const b = record({
      providerRecordId: 'other',
      name: 'Beta Ltd',
      normalizedName: 'beta',
      identifiers: [{ type: 'company_number', value: '00000002', normalizedValue: '00000002' }],
    });
    await repo.persistCompany(b, await resolver.resolve(b));

    const conflicting = record({
      identifiers: [
        { type: 'company_number', value: '00000001', normalizedValue: '00000001' },
        { type: 'company_number', value: '00000002', normalizedValue: '00000002' },
      ],
    });

    await expect(resolver.resolve(conflicting)).rejects.toBeInstanceOf(
      EntityResolutionConflictError,
    );
  });
});
