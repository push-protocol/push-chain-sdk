const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../../e2e-logs/ci-results.json');

/**
 * Machine-readable results for the CI step summary.
 *
 * Why not `jest --json --outputFile`: jest serialises the full result object,
 * including `failureDetails`, with a plain `JSON.stringify`. Several suites here
 * assert on `bigint` values (gas amounts, balances), so any failure in those files
 * crashes the run with "TypeError: Do not know how to serialize a BigInt" *after*
 * the tests have already finished — losing the whole report.
 *
 * This reporter extracts only primitives, so it cannot hit that.
 */
class CiReporter {
  onRunComplete(_testContexts, results) {
    const tests = [];

    for (const suite of results.testResults) {
      const file =
        suite.testFilePath.split('__e2e__/')[1] || suite.testFilePath;
      for (const tc of suite.testResults) {
        tests.push({
          file,
          fullName: String(tc.fullName),
          status: String(tc.status),
          duration: typeof tc.duration === 'number' ? tc.duration : null,
          // First line only — enough to identify the failure in the summary
          // table without dragging a serialised diff (and its bigints) along.
          error:
            tc.status === 'failed' && tc.failureMessages.length > 0
              ? String(tc.failureMessages[0]).split('\n')[0].slice(0, 300)
              : null,
        });
      }
    }

    const payload = {
      completedAt: new Date().toISOString(),
      numTotalTests: results.numTotalTests,
      numPassedTests: results.numPassedTests,
      numFailedTests: results.numFailedTests,
      numPendingTests: results.numPendingTests,
      success: Boolean(results.success),
      tests,
    };

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  }
}

module.exports = CiReporter;
