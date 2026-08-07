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
  'src/__tests__/outcome-events.test.ts',
  'src/__tests__/placement.service.test.ts',
  'src/__tests__/provenance-pipeline.test.ts',
  'src/__tests__/recruiter.service.test.ts',
  'src/__tests__/security-hardening.test.ts',
  'src/__tests__/snapshot.service.test.ts',
  'src/__tests__/status-engine.service.test.ts',
  'src/__tests__/temporal-snapshots.test.ts',
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
  
  // Fix the pattern: dbRouter inserted inside prisma object
  // Pattern: "  dbRouter: {\n    ...\n  },,\n    <next prop>"
  // Should become: "    <next prop>\n  },\n  dbRouter: {\n    ...\n  },"

  const fixRegex = /(  dbRouter:\s*\{[\s\S]*?\}\s*,)\s*,\s*\n(\s*)(\w+:\s*\{)/g;
  
  if (fixRegex.test(content)) {
    content = content.replace(fixRegex, (match, dbRouterBlock, indent, nextProp) => {
      return `${indent}${nextProp}\n  },\n${dbRouterBlock}`;
    });
    
    fs.writeFileSync(filePath, content);
    console.log('FIXED:', file);
  } else {
    console.log('SKIP (pattern not found):', file);
  }
}
