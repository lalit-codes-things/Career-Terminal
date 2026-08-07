const fs = require('fs');
const path = require('path');

const files = [
  'src/__tests__/action.service.test.ts',
  'src/__tests__/application-merge.service.test.ts',
  'src/__tests__/application-timeline.service.test.ts',
  'src/__tests__/candidate-intelligence.test.ts',
  'src/__tests__/canonical-intelligence.test.ts',
  'src/__tests__/checkpoint-resumability.test.ts',
  'src/__tests__/checkpoint.service.test.ts',
  'src/__tests__/dashboard.service.test.ts',
  'src/__tests__/durable-checkpoint.test.ts',
  'src/__tests__/email-worker.test.ts',
  'src/__tests__/fact-correction.service.test.ts',
  'src/__tests__/fact.service.test.ts',
  'src/__tests__/gmail-oauth.test.ts',
  'src/__tests__/gmail-sync.test.ts',
  'src/__tests__/job-analytics.service.test.ts',
  'src/__tests__/opportunity.service.test.ts',
  'src/__tests__/outcome-tracking.test.ts',
  'src/__tests__/placement.service.test.ts',
  'src/__tests__/provenance-pipeline.test.ts',
  'src/__tests__/recruiter.service.test.ts',
  'src/__tests__/security-hardening.test.ts',
  'src/__tests__/snapshot.service.test.ts',
  'src/__tests__/status-engine.service.test.ts',
  'src/__tests__/snapshot-versioning.test.ts',
  'src/__tests__/user-action-log.test.ts',
  'src/__tests__/zzz-dbg.test.ts',
  'src/services/company/__tests__/company.service.security.test.ts',
  'src/routes/__tests__/company-intelligence.routes.test.ts',
];

for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log('SKIP (not found):', file);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  // Check if dbRouter mock already has mockReturnValue
  if (content.includes('dbRouter: {\n    read: jest.fn().mockReturnValue(prisma)')) {
    console.log('SKIP (already fixed):', file);
    continue;
  }
  
  // Replace dbRouter mock to return prisma from read() and write()
  const oldDbRouter = `  dbRouter: {
    read: jest.fn(),
    write: jest.fn(),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },`;
  
  const newDbRouter = `  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },`;
  
  if (content.includes(oldDbRouter)) {
    content = content.replace(oldDbRouter, newDbRouter);
    fs.writeFileSync(filePath, content);
    console.log('FIXED:', file);
  } else {
    console.log('SKIP (pattern not found):', file);
  }
}
