import express from 'express';
import request from 'supertest';
import { companyIntelligenceRouter } from '../company-intelligence.routes';

const app = express();
app.use(express.json());
app.use('/api/company-intelligence', companyIntelligenceRouter);

describe('Company Intelligence API', () => {
  it('GET /lookup/:id returns wrapped response', async () => {
    const res = await request(app).get('/api/company-intelligence/lookup/C123');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('C123');
    expect(res.body.version).toBe('1.0.0');
    expect(res.body.provenance).toContain('internal');
    expect(res.body.timestamp).toBeDefined();
  });

  it('GET /search returns wrapped response', async () => {
    const res = await request(app).get('/api/company-intelligence/search?q=test');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.version).toBe('1.0.0');
  });

  it('GET /:id/health returns health info', async () => {
    const res = await request(app).get('/api/company-intelligence/C123/health');
    expect(res.status).toBe(200);
    expect(res.body.data.score).toBeDefined();
    expect(res.body.provenance).toContain('health-framework');
  });

  it('GET /:id/authenticity returns trust score', async () => {
    const res = await request(app).get('/api/company-intelligence/C123/authenticity');
    expect(res.status).toBe(200);
    expect(res.body.data.trustScore).toBeDefined();
    expect(res.body.provenance).toContain('authenticity-framework');
  });

  it('POST /bulk-lookup returns bulk results', async () => {
    const res = await request(app).post('/api/company-intelligence/bulk-lookup').send({ ids: ['C1', 'C2'] });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toMatchObject({ requestedId: 'C1' });
  });

  it('GET /metadata returns metadata envelope', async () => {
    const res = await request(app).get('/api/company-intelligence/metadata');
    expect(res.status).toBe(200);
    expect(res.body.data.apiVersion).toBe('v1');
  });
});
