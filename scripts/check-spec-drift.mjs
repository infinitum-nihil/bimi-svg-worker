#!/usr/bin/env node
// Queries the IETF datatracker for current revisions of the drafts this
// project implements. Compares against the versions pinned in src/rules.ts.
// If drift is detected, opens or updates a tracking issue on the repo.
//
// Designed to run in GitHub Actions, but also runs standalone locally:
//   node scripts/check-spec-drift.mjs

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Drafts we track. name = IETF draft name (without the -NN version suffix)
const TRACKED_DRAFTS = [
  { key: 'svgTinyPS',        name: 'draft-svg-tiny-ps-abrotman' },
  { key: 'fetchValidation',  name: 'draft-fetch-validation-vmc-wchuang' },
];

// Extract the version strings currently in the code
function readImplementedVersions() {
  const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
  const result = {};
  // SPEC_VERSIONS is defined as:  svgTinyPS: 'draft-...-10',
  for (const d of TRACKED_DRAFTS) {
    const re = new RegExp(`${d.key}:\\s*'(${d.name}-\\d+)'`);
    const m = src.match(re);
    if (!m) throw new Error(`Could not find ${d.key} version in rules.ts`);
    result[d.key] = m[1];
  }
  return result;
}

// Fetch current latest revision from IETF datatracker, with retry for transient failures
async function fetchCurrentRevision(draftName, maxAttempts = 4) {
  const url = `https://datatracker.ietf.org/api/v1/doc/document/?name=${draftName}&format=json`;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      if (r.status >= 500 && r.status < 600) {
        lastError = new Error(`datatracker returned ${r.status} for ${draftName}`);
        const backoff = 1000 * 2 ** (attempt - 1);
        console.error(`  attempt ${attempt}/${maxAttempts}: ${r.status}; retrying in ${backoff}ms`);
        await new Promise((res) => setTimeout(res, backoff));
        continue;
      }
      if (!r.ok) throw new Error(`datatracker returned ${r.status} for ${draftName}`);
      const data = await r.json();
      const obj = data.objects?.[0];
      if (!obj) throw new Error(`No document found for ${draftName}`);
      return {
        rev: obj.rev,
        time: obj.time,
        abstract: obj.abstract,
        fullName: `${draftName}-${obj.rev}`,
      };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        const backoff = 1000 * 2 ** (attempt - 1);
        console.error(`  attempt ${attempt}/${maxAttempts}: ${err.message}; retrying in ${backoff}ms`);
        await new Promise((res) => setTimeout(res, backoff));
      }
    }
  }
  throw lastError;
}

async function main() {
  const implemented = readImplementedVersions();
  const drift = [];

  for (const d of TRACKED_DRAFTS) {
    const current = await fetchCurrentRevision(d.name);
    const implVersion = implemented[d.key];
    console.log(`${d.name}: implemented=${implVersion}, current=${current.fullName} (updated ${current.time})`);

    if (implVersion !== current.fullName) {
      drift.push({
        name: d.name,
        implemented: implVersion,
        current: current.fullName,
        updated: current.time,
      });
    }
  }

  if (drift.length === 0) {
    console.log('\nNo drift detected. All drafts are at their latest revision.');
    return;
  }

  console.log(`\nDrift detected in ${drift.length} draft(s).`);

  // If running in GitHub Actions, open or update an issue
  if (process.env.GH_TOKEN && process.env.REPO) {
    await fileIssue(drift);
  } else {
    console.log('(Not in CI; skipping issue filing.)');
    process.exitCode = 1;
  }
}

async function fileIssue(drift) {
  const title = `Spec drift detected: ${drift.map((d) => d.name).join(', ')}`;
  const body = [
    'The IETF datatracker reports newer revisions of drafts this project implements:',
    '',
    ...drift.map((d) => [
      `### ${d.name}`,
      `- Implemented: \`${d.implemented}\``,
      `- Current:     \`${d.current}\` (published ${d.updated})`,
      `- Diff:        https://datatracker.ietf.org/doc/html/${d.current} (compare with ${d.implemented})`,
      '',
    ].join('\n')),
    '',
    '## Review checklist',
    '- [ ] Read the diff between the implemented and current revision',
    '- [ ] Identify new/changed/removed rules',
    '- [ ] Update `SPEC_VERSIONS` in `src/rules.ts`',
    '- [ ] Add/update rules with spec citations to the new section numbers',
    '- [ ] Update `README.md` compliance matrix if rules changed',
    '- [ ] Run the integration test suite',
    '',
    '*This issue was opened automatically by `.github/workflows/check-spec-drift.yml`.*',
  ].join('\n');

  const repo = process.env.REPO;

  // Check for existing open drift issue (avoid spam)
  const existing = execSync(
    `gh issue list --repo ${repo} --state open --label spec-drift --json number,title`,
    { encoding: 'utf8' }
  );
  const existingIssues = JSON.parse(existing);
  if (existingIssues.length > 0) {
    const num = existingIssues[0].number;
    console.log(`Updating existing issue #${num}`);
    execSync(
      `gh issue comment ${num} --repo ${repo} --body ${JSON.stringify('Spec drift check re-ran:\n\n' + body)}`,
      { stdio: 'inherit' }
    );
  } else {
    console.log('Opening new issue');
    execSync(
      `gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label spec-drift`,
      { stdio: 'inherit' }
    );
  }
}

main().catch((err) => {
  console.error('check-spec-drift failed:', err);
  process.exit(1);
});
