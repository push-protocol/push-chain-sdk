#!/usr/bin/env ts-node
/**
 * CI runner — turns the scenario manifest into a single jest invocation.
 *
 * Usage (from packages/core):
 *   npx ts-node --transpile-only __e2e__/ci/run.ts [options]
 *
 *   --group <name>   One of: all (default), smoke, evm-r1, evm-r2, evm-r3,
 *                    svm-r1, svm-r2r3, pc20, push, cross-chain, known-fail
 *                    (`all` excludes known-fail — ask for it by name)
 *   --list           Print the selection and the jest argv, run nothing
 *   --verify         Check every `grep` against the real spec titles and exit
 *                    non-zero if any fragment matches 0 or >1 tests in its file
 *   --bail           Stop at the first failing scenario
 *
 * `--runInBand` is NOT optional. Every funds-moving suite broadcasts from a single key
 * per chain; parallel workers race for the nonce and produce the "worker force-exited /
 * suite failed with zero failed tests" mode described in docs-examples/README.md.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { scenariosFor, envFor, GROUPS, type Scenario } from './suite';

const CORE_ROOT = path.resolve(__dirname, '../..');
const LOG_DIR = path.join(CORE_ROOT, 'e2e-logs');
const RESULTS = path.join(LOG_DIR, 'ci-results.json');

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

const group = arg('group') ?? 'all';

// ---------------------------------------------------------------------------
// title extraction — used by --verify to catch manifest drift when a spec is
// retitled. Handles multi-line calls and the wrapper forms this suite uses:
//   describe.each(fx)('[$label]'   d('x')   (evmKey ? it : it.skip)('x')
// ---------------------------------------------------------------------------

const CALL = /\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g;

function classify(prefix: string): 'describe' | 'it' | null {
  const p = prefix.replace(/\s+$/, '');
  if (/\bdescribe\.each\s*\([\s\S]*\)$/.test(p)) return 'describe';
  if (/\b(it|test)\.each\s*\([\s\S]*\)$/.test(p)) return 'it';
  // ternary wrappers, e.g. (pc20Ready ? it : it.skip)
  if (/\?[\s\S]*\b(it|test)\b[\s\S]*\)$/.test(p)) return 'it';
  const m = p.match(/([A-Za-z_$][\w$]*)(?:\.(skip|only|failing|concurrent))?$/);
  if (!m) return null;
  if (/^(describe|d|dWrapper|xdescribe|fdescribe)$/.test(m[1])) return 'describe';
  if (/^(it|test|xit|fit|itWrapper|itIf)$/.test(m[1])) return 'it';
  return null;
}

/** Full jest test names (describe path + title, space-joined) for one spec file. */
function titlesOf(specPath: string): string[] {
  const src = fs.readFileSync(specPath, 'utf8');
  const depthAt = new Int32Array(src.length + 1);
  let d = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') d++;
    else if (c === '}') d--;
    depthAt[i + 1] = d;
  }

  const titles: string[] = [];
  const stack: { title: string; depth: number }[] = [];
  CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(src))) {
    const at = m.index;
    const kind = classify(src.slice(Math.max(0, at - 120), at));
    if (!kind) continue;
    const depth = depthAt[at];
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    if (kind === 'describe') stack.push({ title: m[2], depth });
    else titles.push(stack.map((s) => s.title).concat(m[2]).join(' '));
  }
  return titles;
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

let selected: Scenario[];
try {
  selected = scenariosFor(group);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

if (selected.length === 0) {
  console.error(`No scenarios in group "${group}".`);
  process.exit(1);
}

const files = [...new Set(selected.map((s) => s.file))];
const pattern = selected.map((s) => `(?:${s.grep})`).join('|');

const jestArgs = [
  'jest',
  '-c',
  'jest.e2e.config.ts',
  '--runInBand',
  '--forceExit',
  // Passing --reporters on the CLI replaces the config's list, so restate the two
  // from jest.e2e.config.ts and append ours. See ci-reporter.js for why we do not
  // use `--json` (it crashes on bigint assertions after the run completes).
  '--reporters=default',
  '--reporters=./__e2e__/shared/e2e-file-reporter.js',
  '--reporters=./__e2e__/ci/ci-reporter.js',
  ...(has('bail') ? ['--bail'] : []),
  ...(has('verbose') ? ['--verbose'] : []),
  '-t',
  pattern,
  '--runTestsByPath',
  ...files,
];

// ---------------------------------------------------------------------------
// --verify / --list
// ---------------------------------------------------------------------------

if (has('verify')) {
  let bad = 0;
  const seen = new Map<string, string[]>(); // full title -> scenario ids

  for (const s of selected) {
    const abs = path.join(CORE_ROOT, s.file);
    if (!fs.existsSync(abs)) {
      console.error(`✗ ${s.id}: spec not found — ${s.file}`);
      bad++;
      continue;
    }
    let re: RegExp;
    try {
      re = new RegExp(s.grep);
    } catch {
      console.error(`✗ ${s.id}: grep is not a valid regex — ${s.grep}`);
      bad++;
      continue;
    }
    const hits = titlesOf(abs).filter((t) => re.test(t));
    if (hits.length === 0) {
      console.error(`✗ ${s.id}: matches no test in ${s.file}`);
      console.error(`    grep: ${s.grep}`);
      bad++;
    } else {
      for (const h of hits) seen.set(h, (seen.get(h) ?? []).concat(s.id));
      console.log(`✓ ${s.id.padEnd(32)} ${hits.length} test${hits.length > 1 ? 's' : ''}`);
    }
  }

  const dupes = [...seen.entries()].filter(([, ids]) => ids.length > 1);
  for (const [title, ids] of dupes) {
    console.error(`✗ overlapping fragments — "${title}" claimed by ${ids.join(', ')}`);
    bad++;
  }

  // The `-t` union is applied across every file in --runTestsByPath, not per file.
  // A fragment scoped to one spec can therefore drag in a same-titled test from
  // another selected spec. Catch that here rather than discovering it as an
  // unexplained extra transaction on the bill.
  const union = new RegExp(selected.map((s) => `(?:${s.grep})`).join('|'));
  let extra = 0;
  for (const f of files) {
    const abs = path.join(CORE_ROOT, f);
    if (!fs.existsSync(abs)) continue;
    for (const t of titlesOf(abs)) {
      if (!union.test(t)) continue;
      const claimed = seen.get(t);
      if (!claimed) {
        console.error(`✗ collateral match in ${f}: "${t}"`);
        console.error('    matched by the union -t but claimed by no scenario');
        extra++;
      }
    }
  }
  bad += extra;

  console.log(
    `\n${selected.length} scenarios, ${files.length} spec files, ${seen.size} distinct tests.`
  );
  if (bad) {
    console.error(`\n${bad} problem(s). The manifest has drifted from the specs.`);
    process.exit(1);
  }
  console.log('Manifest is consistent with the specs.');
  process.exit(0);
}

if (has('list')) {
  const byGroup = new Map<string, Scenario[]>();
  for (const s of selected) byGroup.set(s.group, (byGroup.get(s.group) ?? []).concat(s));
  for (const g of GROUPS) {
    const rows = byGroup.get(g);
    if (!rows) continue;
    console.log(`\n${g} (${rows.length})`);
    for (const s of rows) {
      const cost = Object.entries(s.needs)
        .map(([a, v]) => `${a}=${v}`)
        .join(' ');
      console.log(`  ${s.id.padEnd(32)} ${cost || '(free)'}`);
    }
  }
  console.log(`\n${selected.length} scenarios across ${files.length} spec files.`);
  console.log(`\nnpx ${jestArgs.map((a) => (/[\s|()]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

fs.mkdirSync(LOG_DIR, { recursive: true });

console.log(`Running ${selected.length} scenarios (group: ${group}) across ${files.length} spec files.\n`);

const result = spawnSync('npx', jestArgs, {
  cwd: CORE_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Collapses the describe.each fixtures to Sepolia only. Without this the EVM
    // suites fan out over BNB / Arbitrum / Base as well.
    E2E_TARGET_CHAINS: 'Ethereum Sepolia',
    ...envFor(selected),
  },
});

writeSummary();
process.exit(result.status ?? 1);

// ---------------------------------------------------------------------------
// step summary
// ---------------------------------------------------------------------------

function writeSummary(): void {
  const target = process.env['GITHUB_STEP_SUMMARY'];
  if (!target || !fs.existsSync(RESULTS)) return;

  type Assertion = {
    fullName: string;
    status: string;
    duration: number | null;
    error: string | null;
  };
  let parsed: { tests?: Assertion[] };
  try {
    parsed = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
  } catch {
    return;
  }

  const all = parsed.tests ?? [];
  if (all.length === 0) return;

  const icon = (s: string) =>
    s === 'passed' ? '✅' : s === 'failed' ? '❌' : '⏭️';
  const secs = (ms: number | null) =>
    ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`;
  const esc = (s: string) => s.replace(/\|/g, '\\|');

  const passed = all.filter((a) => a.status === 'passed').length;
  const failed = all.filter((a) => a.status === 'failed').length;
  const skipped = all.length - passed - failed;

  // Skipped rows are the tests jest loaded but `-t` filtered out — noise here.
  const shown = all.filter((a) => a.status !== 'pending' && a.status !== 'skipped');

  const lines = [
    `## E2E — group \`${group}\``,
    '',
    `**${passed} passed · ${failed} failed · ${skipped} filtered out** of ${all.length} loaded tests`,
    '',
    '| | Test | Time |',
    '|---|---|---|',
    ...shown.map(
      (a) => `| ${icon(a.status)} | ${esc(a.fullName)} | ${secs(a.duration)} |`
    ),
    '',
  ];

  const failures = shown.filter((a) => a.status === 'failed');
  if (failures.length > 0) {
    lines.push('### Failures', '');
    for (const f of failures) {
      lines.push(`- **${esc(f.fullName)}**`, `  \`${esc(f.error ?? '')}\``);
    }
    lines.push('');
  }
  fs.appendFileSync(target, lines.join('\n'));
}
