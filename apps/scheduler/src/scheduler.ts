import path from 'node:path';
import { BrowserType, Job, TestCase, TestPriority } from '../../../packages/common/src/index.js';
import { generateJobId } from '../../../packages/common/src/index.js';
import { DEFAULT_E2E_DIR, loadE2eCatalog } from './e2e-catalog.js';

export interface DistributionSummary {
  short: number;
  medium: number;
  long: number;
}

export const createDummyTestCaseSet = (count: number, browser: BrowserType): TestCase[] => {
  const cases: TestCase[] = [];

  for (let i = 1; i <= count; i += 1) {
    const testNumber = i.toString().padStart(6, '0');
    const roll = (i * 13) % 100;
    let estimatedDuration = 10000;
    if (roll >= 60 && roll < 95) {
      estimatedDuration = 30000;
    } else if (roll >= 95) {
      estimatedDuration = 60000;
    }

    const suite = ['checkout', 'login', 'search', 'profile', 'billing'][i % 5] ?? 'checkout';
    const priority: TestPriority = i % 17 === 0 ? 'HIGH' : i % 29 === 0 ? 'CRITICAL' : 'NORMAL';

    cases.push({
      testId: `TC-${testNumber}`,
      testName: `Dummy test ${i}`,
      suite,
      estimatedDuration,
      browser,
      priority,
      tags: ['dummy', suite],
      enabled: true
    });
  }

  return cases;
};

export const createE2eTestCaseSet = (browser: BrowserType, testDir: string = DEFAULT_E2E_DIR): TestCase[] =>
  loadE2eCatalog(testDir).map((entry) => ({
    testId: entry.testId,
    testName: entry.term,
    suite: path.basename(path.dirname(entry.specFile)) || 'e2e',
    estimatedDuration: 30000,
    browser,
    priority: 'NORMAL' as TestPriority,
    tags: ['e2e'],
    enabled: true,
    specFile: entry.specFile
  }));

export const distributionSummary = (cases: TestCase[]): DistributionSummary => ({
  short: cases.filter((caseItem) => caseItem.estimatedDuration === 10000).length,
  medium: cases.filter((caseItem) => caseItem.estimatedDuration === 30000).length,
  long: cases.filter((caseItem) => caseItem.estimatedDuration === 60000).length
});

export const generateScheduledJobs = (
  runId: string,
  testId: string,
  testName: string,
  suite: string,
  browser: BrowserType,
  estimatedDuration: number,
  maxRetries: number,
  priority: TestPriority,
  attempt: number = 1,
  specFile?: string,
  runName?: string
): Job[] => [{
  jobId: generateJobId(runId, testId, attempt),
  runId,
  runName,
  testId,
  testName,
  browser,
  attempt,
  maxRetries,
  priority,
  createdAt: new Date().toISOString(),
  suite,
  estimatedDuration,
  specFile
}];

export const scheduleJobsForRun = (
  runId: string,
  tests: TestCase[],
  maxJobs: number,
  maxRetries: number,
  browser: BrowserType,
  runName?: string
): Job[] => {
  const name = runName?.trim() || runId;
  return tests
    .slice(0, maxJobs)
    .sort((a, b) => {
      const priorityOrder = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
      return (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
    })
    .flatMap((test) => generateScheduledJobs(
      runId,
      test.testId,
      test.testName,
      test.suite,
      browser,
      test.estimatedDuration,
      maxRetries,
      test.priority,
      1,
      test.specFile,
      name
    ));
};
