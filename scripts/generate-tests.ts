import { createDummyTestCaseSet, distributionSummary } from '../apps/scheduler/src/scheduler.js';

const count = Number(process.env.TEST_COUNT ?? 10000);
const tests = createDummyTestCaseSet(count, 'chromium');
const summary = distributionSummary(tests);

console.log(JSON.stringify({
  generated: tests.length,
  short: summary.short,
  medium: summary.medium,
  long: summary.long,
  sample: tests.slice(0, 3)
}, null, 2));
