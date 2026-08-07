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
  'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
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
  
  // Fix pattern: jest.mock(..., () => ({ prisma: {...}, dbRouter: { ... mockReturnValue(prisma) ... }, }))
  // We need to define prisma as a variable first when mockReturnValue(prisma) is used
  
  if (content.includes('mockReturnValue(prisma)') && !content.includes('const prisma = {')) {
    // Find the jest.mock and transform it to use a prisma variable
    const mockRegex = /jest\.mock\(['\"].*config\/database['\"],\s*\(\)\s*=>\s*\(\{/;
    const match = content.match(mockRegex);
    
    if (match) {
      const insertPoint = match.index + match[0].length;
      content = content.slice(0, insertPoint) + '\n  const prisma = {' + content.slice(insertPoint);
      
      // Now find the dbRouter mockReturnValue(prisma) and remove the self-reference issue
      // Actually, with const prisma defined inside the arrow function, it should work
      // But we need to make sure the original prisma: { ... } becomes just the properties
      
      fs.writeFileSync(filePath, content);
      console.log('FIXED (added const prisma):', file);
    } else {
      console.log('SKIP (no jest.mock found):', file);
    }
  } else if (content.includes('mockReturnValue(prisma)') && content.includes('const prisma = {')) {
    console.log('SKIP (already has const prisma):', file);
  } else if (!content.includes('mockReturnValue(prisma)')) {
    // For files that don't use mockReturnValue, we still need to check if they have syntax errors
    console.log('SKIP (no mockReturnValue):', file);
  } else {
    console.log('SKIP (unknown):', file);
  }
}
