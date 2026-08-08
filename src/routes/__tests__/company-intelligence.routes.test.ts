import express from 'express';
import request from 'supertest';
import { companyIntelligenceRouter } from '../company-intelligence.routes';
import { prisma } from '../../config/database';
import { authHeader } from '../../__tests__/test-utils';

jest.mock('../../config/database', () => {
  const prisma = {
    company: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    canonicalCompany: {
      findUnique: jest.fn(),
    },
    companyIdentifier: {
      findMany: jest.fn(),
    },
    companySignal: {
      findMany: jest.fn(),
    },
    companyAddress: {
      findMany: jest.fn(),
    },
  };
  return {
    prisma,
    dbRouter: {
      read: jest.fn().mockReturnValue(prisma),
      write: jest.fn().mockReturnValue(prisma),
      withReplicaFallback: jest.fn(),
      getHealth: jest.fn(),
      disconnect: jest.fn(),
    },
  };
});

const mockPrisma = prisma as unknown as {
  company: { findUnique: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  canonicalCompany: { findUnique: jest.Mock };
  companyIdentifier: { findMany: jest.Mock };
  companySignal: { findMany: jest.Mock };
  companyAddress: { findMany: jest.Mock };
};

const USER_ID = 'user-123';
const app = express();
app.use(express.json());
app.use('/api/company-intelligence', companyIntelligenceRouter);

describe('Company Intelligence API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /lookup/:id returns wrapped response for existing company', async () => {
    mockPrisma.company.findUnique.mockResolvedValue({
      id: 'C123',
      name: 'Example Corp',
      domain: 'example.com',
      industry: 'Software',
      headquarters: 'Remote',
      website: 'https://example.com',
    });

    const res = await request(app)
      .get('/api/company-intelligence/lookup/C123')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('C123');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.provenance).toContain('database');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /lookup/:id returns not-found for missing company', async () => {
    mockPrisma.company.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/company-intelligence/lookup/C999')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(false);
  });

  it('GET /search returns wrapped response', async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { id: 'C1', name: 'Test Co', domain: 'test.com' },
    ]);

    const res = await request(app)
      .get('/api/company-intelligence/search?q=test')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.version).toBe('1.0.0');
  });

  it('GET /:id/health returns health info', async () => {
    const res = await request(app)
      .get('/api/company-intelligence/C123/health')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBeDefined();
    expect(res.body.provenance).toContain('health-framework');
  });

  it('GET /:id/authenticity returns trust score', async () => {
    const res = await request(app)
      .get('/api/company-intelligence/C123/authenticity')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.trustScore).toBeDefined();
    expect(res.body.provenance).toContain('authenticity-framework');
  });

  it('POST /bulk-lookup returns bulk results', async () => {
    mockPrisma.company.findMany.mockResolvedValue([
      { id: 'C1', name: 'Company One', domain: 'co1.com' },
    ]);

    const res = await request(app)
      .post('/api/company-intelligence/bulk-lookup')
      .set(authHeader(USER_ID))
      .send({ ids: ['C1', 'C2'] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ requestedId: 'C1' });
    expect(res.body.data[1]).toMatchObject({ requestedId: 'C2', found: false });
  });

  it('GET /metadata returns metadata envelope', async () => {
    const res = await request(app)
      .get('/api/company-intelligence/metadata')
      .set(authHeader(USER_ID));
    expect(res.status).toBe(200);
    expect(res.body.data.apiVersion).toBe('v1');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/api/company-intelligence/lookup/C123');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST with 401', async () => {
    const res = await request(app)
      .post('/api/company-intelligence/bulk-lookup')
      .send({ ids: ['C1'] });
    expect(res.status).toBe(401);
  });
});
