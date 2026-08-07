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
  'src/__tests__/outcome-events.test.ts',
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
  'src/__tests__/temporal-snapshots.test.ts',
  'src/__tests__/candidate-intelligence.test.ts',
  'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
  'src/services/company/__tests__/company.service.security.test.ts',
  'src/routes/__tests__/company-intelligence.routes.test.ts',
];

const dbRouterMock = `  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
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
  
  // Check if dbRouter is already in the mock
  if (content.includes('dbRouter:')) {
    console.log('SKIP (already has dbRouter):', file);
    continue;
  }
  
  // Find jest.mock for config/database and add dbRouter before the closing }))
  const mockRegex = /jest\.mock\(['\"].*config\/database['\"],\s*\(\)\s*=>\s*\{/;
  const match = content.match(mockRegex);
  
  if (!match) {
    console.log('SKIP (no mock found):', file);
    continue;
  }
  
  const mockStart = match.index + match[0].length;
  
  // Find the matching closing })) for this jest.mock
  let braceCount = 1; // We already passed the opening {
  let pos = mockStart;
  while (braceCount > 0 && pos < content.length) {
    if (content[pos] === '{') braceCount++;
    else if (content[pos] === '}') braceCount--;
    pos++;
  }
  
  // Now pos is after the closing } of the arrow function
  // We need to find the closing )) of jest.mock
  while (pos < content.length && content.slice(pos, pos + 2) !== '))') {
    pos++;
  }
  
  const insertPoint = pos - 1; // Before the final })
  
  // Check if the mock returns prisma directly or via variable
  const mockBody = content.slice(mockStart, insertPoint);
  
  if (mockBody.includes('return { prisma }')) {
    // Pattern: return { prisma }  ->  return { prisma, dbRouter: ... }
    content = content.replace('return { prisma }', 'return { prisma, dbRouter: {\n    read: jest.fn().mockReturnValue(prisma),\n    write: jest.fn().mockReturnValue(prisma),\n    withReplicaFallback: jest.fn(),\n    getHealth: jest.fn(),\n    disconnect: jest.fn(),\n  } }');
    fs.writeFileSync(filePath, content);
    console.log('FIXED (return pattern):', file);
  } else if (mockBody.includes('return { prisma,')) {
    // Pattern: return { prisma, ... }  ->  add dbRouter before closing }
    const returnMatch = content.slice(mockStart, insertPoint).match(/return\s*\{\s*prisma,/);
    if (returnMatch) {
      const returnStart = mockStart + content.slice(mockStart, insertPoint).indexOf('return');
      const afterPrisma = returnStart + returnMatch[0].length;
      content = content.slice(0, afterPrisma) + '\n  dbRouter: {\n    read: jest.fn().mockReturnValue(prisma),\n    write: jest.fn().mockReturnValue(prisma),\n    withReplicaFallback: jest.fn(),\n    getHealth: jest.fn(),\n    disconnect: jest.fn(),\n  },' + content.slice(afterPrisma);
      fs.writeFileSync(filePath, content);
      console.log('FIXED (return with props):', file);
    } else {
      console.log('SKIP (unmatched return pattern):', file);
    }
  } else if (mockBody.includes('({')) {
    // Pattern: jest.mock(..., () => ({ prisma: {...} }))
    // Find the prisma object and add dbRouter after it
    const objectStart = mockStart + content.slice(mockStart, insertPoint).indexOf('({');
    const afterOpenBrace = objectStart + 2;
    
    // Find the closing } of the object
    let objBraceCount = 1;
    let objPos = afterOpenBrace;
    while (objBraceCount > 0 && objPos < content.length) {
      if (content[objPos] === '{') objBraceCount++;
      else if (content[objPos] === '}') objBraceCount--;
      objPos++;
    }
    
    const objCloseIdx = objPos - 1;
    
    // Insert dbRouter before the closing }
    content = content.slice(0, objCloseIdx) + dbRouterMock + '\n' + content.slice(objCloseIdx);
    fs.writeFileSync(filePath, content);
    console.log('FIXED (object pattern):', file);
  } else {
    console.log('SKIP (unknown pattern):', file);
  }
}
