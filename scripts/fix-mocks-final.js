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
  'src/__tests__/temporal-snapshots.test.ts',
  'src/__tests__/candidate-intelligence.test.ts',
  'src/services/recruiter-intelligence/infrastructure/__tests__/vector-store.tenant-isolation.test.ts',
  'src/services/company/__tests__/company.service.security.test.ts',
  'src/routes/__tests__/company-intelligence.routes.test.ts',
];

const DBROUTER = `  dbRouter: {
    read: jest.fn().mockReturnValue(prisma),
    write: jest.fn().mockReturnValue(prisma),
    withReplicaFallback: jest.fn(),
    getHealth: jest.fn(),
    disconnect: jest.fn(),
  },`;

for (const file of files) {
  const fp = path.join(process.cwd(), file);
  if (!fs.existsSync(fp)) {
    console.log('MISSING:', file);
    continue;
  }
  
  let content = fs.readFileSync(fp, 'utf8');
  if (content.includes('dbRouter:')) {
    console.log('SKIP (has dbRouter):', file);
    continue;
  }
  
  // Find the jest.mock block for config/database
  const startMarker = "jest.mock('../config/database', () => ({";
  const startMarker2 = 'jest.mock("../config/database", () => ({';
  
  let startIdx = content.indexOf(startMarker);
  let marker = startMarker;
  if (startIdx === -1) {
    startIdx = content.indexOf(startMarker2);
    marker = startMarker2;
  }
  
  if (startIdx === -1) {
    console.log('NO MOCK:', file);
    continue;
  }
  
  // Find the matching })); after the ({ 
  const afterMarker = startIdx + marker.length;
  let depth = 1;
  let pos = afterMarker;
  while (depth > 0 && pos < content.length) {
    if (content[pos] === '{') depth++;
    else if (content[pos] === '}') depth--;
    pos++;
  }
  
  // Now find )); 
  while (pos < content.length && content.slice(pos, pos + 3) !== '));') {
    pos++;
  }
  
  const endIdx = pos + 3;
  const oldMock = content.slice(startIdx, endIdx);
  
  // Extract the object content between ({ and })
  const objContent = content.slice(afterMarker, pos - 1);
  
  // Find prisma: { ... } in the object content
  const prismaIdx = objContent.indexOf('prisma:');
  if (prismaIdx === -1) {
    console.log('NO PRISMA PROP:', file);
    continue;
  }
  
  // Find the start of prisma value
  const prismaValueStart = objContent.indexOf('{', prismaIdx);
  
  // Find matching closing brace for prisma value
  let pdepth = 1;
  let ppos = prismaValueStart + 1;
  while (pdepth > 0 && ppos < objContent.length) {
    if (objContent[ppos] === '{') pdepth++;
    else if (objContent[ppos] === '}') pdepth--;
    ppos++;
  }
  
  const prismaValue = objContent.slice(prismaValueStart, ppos);
  const beforePrisma = objContent.slice(0, prismaIdx);
  const afterPrisma = objContent.slice(ppos);
  
  // Build new mock
  const newMock = `jest.mock('../config/database', () => {
  const prisma = ${prismaValue};
  return {
    prisma,
${DBROUTER}
  };
});`;
  
  content = content.replace(oldMock, newMock);
  fs.writeFileSync(fp, content);
  console.log('FIXED:', file);
}
