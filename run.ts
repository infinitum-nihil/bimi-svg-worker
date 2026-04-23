// Integration test: exercise the classify -> validate -> transform -> revalidate
// pipeline against fixtures committed in this repo.
//
// Run with: node --experimental-strip-types test/run.ts
//
// Exits non-zero if any case deviates from the expected outcome, so this can
// be wired into CI.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classify } from '../src/classify.ts';
import { validate } from '../src/validate.ts';
import { transform } from '../src/transform.ts';
import type { Classification } from '../src/types.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

interface TestCase {
  name: string;
  fixture: string;
  expectedClassification: Classification;
  expectedInitiallyCompliant: boolean;
  expectedCompliantAfterTransform: boolean;  // only checked if !expectedInitiallyCompliant
  minInitialIssues?: number;
}

const CASES: TestCase[] = [
  {
    name: 'Compliant reference SVG',
    fixture: 'compliant.svg',
    expectedClassification: 'fixable',
    expectedInitiallyCompliant: true,
    expectedCompliantAfterTransform: true,
  },
  {
    name: 'width="100%" — the classic Apple/Gmail reject pattern',
    fixture: 'bug-width-percentage.svg',
    expectedClassification: 'fixable',
    expectedInitiallyCompliant: false,
    expectedCompliantAfterTransform: true,
    minInitialIssues: 2,
  },
  {
    name: 'Hostile SVG — multiple violations across categories',
    fixture: 'hostile.svg',
    expectedClassification: 'fixable',
    expectedInitiallyCompliant: false,
    expectedCompliantAfterTransform: false,  // colors.insufficient is not auto-fixable
    minInitialIssues: 8,
  },
  {
    name: 'Raster-wrapped (base64 PNG in SVG shell)',
    fixture: 'raster-wrapped.svg',
    expectedClassification: 'raster-wrapped',
    expectedInitiallyCompliant: false,
    expectedCompliantAfterTransform: false,
  },
];

function hr(label: string) {
  console.log(`\n${'='.repeat(70)}\n${label}\n${'='.repeat(70)}`);
}

let failures = 0;

for (const tc of CASES) {
  hr(tc.name);
  const svg = readFileSync(join(FIXTURES, tc.fixture), 'utf8');
  console.log(`Fixture: ${tc.fixture} (${svg.length} bytes)`);

  const c = classify(svg);
  const passClass = c === tc.expectedClassification;
  console.log(`Classification: ${c} ${passClass ? '✓' : `✗ (expected ${tc.expectedClassification})`}`);
  if (!passClass) failures++;

  const v = validate(svg);
  console.log(`Initial validation: ${v.issues.length} issues, compliant=${v.compliant}`);
  for (const issue of v.issues) {
    const flag = issue.autoFixable ? '[auto]' : '[skip]';
    const src = issue.spec.section
      ? `${issue.spec.document}§${issue.spec.section}`
      : issue.spec.document;
    console.log(`  ${flag} ${issue.severity.padEnd(7)} ${issue.code.padEnd(35)} [${src}]`);
  }

  const passInitialCompliant = v.compliant === tc.expectedInitiallyCompliant;
  if (!passInitialCompliant) {
    console.log(`  ✗ Initial compliance mismatch: got ${v.compliant}, expected ${tc.expectedInitiallyCompliant}`);
    failures++;
  }
  if (tc.minInitialIssues !== undefined && v.issues.length < tc.minInitialIssues) {
    console.log(`  ✗ Expected at least ${tc.minInitialIssues} issues, got ${v.issues.length}`);
    failures++;
  }

  // Only run transform when classification is fixable and initial input not compliant
  if (c === 'fixable' && !v.compliant) {
    const t = transform(svg, v.issues);
    const v2 = validate(t.svg);
    console.log(`\nTransform: ${t.sizeBefore} → ${t.sizeAfter} bytes, applied ${t.applied.length}, skipped ${t.skipped.length}`);
    console.log(`Post-transform validation: ${v2.issues.length} issues, compliant=${v2.compliant}`);
    for (const issue of v2.issues) {
      console.log(`  ${issue.severity.padEnd(7)} ${issue.code}: ${issue.message}`);
    }
    const passPostTransform = v2.compliant === tc.expectedCompliantAfterTransform;
    if (!passPostTransform) {
      console.log(`  ✗ Post-transform compliance mismatch: got ${v2.compliant}, expected ${tc.expectedCompliantAfterTransform}`);
      failures++;
    }
  }
}

console.log();
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) did not match expected outcomes`);
  process.exit(1);
}
console.log('All checks passed.');
