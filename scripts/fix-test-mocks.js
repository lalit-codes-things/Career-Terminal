const fs = require('fs');
const path = require('path');

const files = [
  'src/__tests__/email-worker.test.ts',
  'src/__tests__/user-action-log.test.ts',
  'src/__tests__/fact-correction.service.test.ts',
  'src/__tests__/event.service.test.ts',
  'src/__tests__/company.service.test.ts',
  'src/__tests__/resume-security.test.ts',
  'src/__tests__/outcome.service.test.ts',
  'src/__tests__/placement.service.test.ts',
  'src/__tests__/action.service.test.ts',
  'src/__tests__/fact.service.test.ts',
  'src/__tests__/checkpoint-resumability.test.ts',
  'src/__tests__/resume-versioning.service.test.ts',
  'src/__tests__/gmail-sync.test.ts',
  'src/__tests__/zzz-dbg.test.ts',
  'src/__tests__/application-merge.service.test.ts',
  'src/__tests__/outcome-tracking.test.ts',
  'src/__tests__/security-hardening.test.ts',
  'src/__tests__/opportunity.service.test.ts',
  'src/__tests__/gmail-oauth.test.ts',
  'src/__tests__/snapshot.service.test.ts',
  'src/__tests__/status-engine.service.test.ts',
  'src/__tests__/recruiter.service.test.ts',
  'src/__tests__/durable-checkpoint.test.ts',
  'src/__tests__/canonical-intelligence.test.ts',
  'src/__tests__/application-tracking.test.ts',
  'src/__tests__/checkpoint.service.test.ts',
  'src/__tests__/dashboard.service.test.ts',
  'src/__tests__/application-timeline.service.test.ts',
  'src/__tests__/provenance-pipeline.test.ts',
  'src/__tests__/job-analytics.service.test.ts',
  'src/__tests__/database-router.test.ts',
  'src/__tests__/snapshot-versioning.test.ts',
  'src/__tests__/candidate-intelligence.test.ts',
  'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
  'src/services/company/__tests__/company.service.security.test.ts',
  'src/routes/__tests__/company-intelligence.routes.test.ts',
];

const dbRouterMock = `
  dbRouter: {
    read: jest.fn(),
    write: jest.fn(),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },`;

for (const file of files) {
  const filePath = path.join(__dirname, '..', file);
  if (!fs.existsSync(filePath)) {
    console.log('SKIP (not found):', file);
    continue;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  
  if (content.includes('dbRouter:')) {
    console.log('SKIP (already has dbRouter):', file);
    continue;
  }

  // Find the prisma property in the jest.mock and add dbRouter after it
  // Pattern: prisma: { ... } or prisma: { ... },
  const prismaRegex = /(prisma\s*:\s*\{[\s\S]*?\})(,|\s*\n\s*\})/;
  const match = content.match(prismaRegex);
  
  if (match) {
    const fullMatch = match[0];
    const prismaObj = match[1];
    const afterPrisma = match[2];
    
    // Insert dbRouter after the prisma object
    const replacement = prismaObj + dbRouterMock + afterPrisma;
    content = content.replace(fullMatch, replacement);
    
    fs.writeFileSync(filePath, content);
    console.log('FIXED:', file);
  } else {
    console.log('SKIP (no prisma object found):', file);
  }
}
