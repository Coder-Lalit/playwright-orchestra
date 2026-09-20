import { describe, expect, it } from 'vitest';
import { createDummyTestCaseSet, createE2eTestCaseSet, distributionSummary, generateScheduledJobs, scheduleJobsForRun } from '../apps/scheduler/src/scheduler.js';

describe('scheduler', () => {
  it('creates 10k dummy tests with correct distributions', () => {
    const tests = createDummyTestCaseSet(10000, 'chromium');
    const summary = distributionSummary(tests);

    expect(tests).toHaveLength(10000);
    expect(summary.short).toBeGreaterThan(5900);
    expect(summary.medium).toBeGreaterThan(3400);
    expect(summary.long).toBeGreaterThan(400);
    expect(summary.long).toBeLessThan(700);
  });

  it('builds jobs in priority order and respects max count', () => {
    const tests = createDummyTestCaseSet(50, 'chromium');
    const jobs = scheduleJobsForRun('RUN-1', tests, 5, 2, 'chromium');

    expect(jobs).toHaveLength(5);
    expect(jobs[0].runId).toBe('RUN-1');
    expect(jobs[0].runName).toBe('RUN-1');
    expect(jobs[0].attempt).toBe(1);
  });

  it('schedules one job per spec in the given folder', () => {
    const tests = createE2eTestCaseSet('chromium', 'tests/e2e/wiki_1');
    const jobs = scheduleJobsForRun('RUN-E2E', tests, tests.length, 2, 'chromium', 'Wikipedia nightly');
    expect(jobs).toHaveLength(10);
    expect(jobs.every((job) => String(job.specFile).startsWith('tests/e2e/wiki_1/'))).toBe(true);
    expect(jobs.every((job) => job.runName === 'Wikipedia nightly')).toBe(true);
  });

  it('includes nested folders when a parent directory is specified', () => {
    const tests = createE2eTestCaseSet('chromium', 'tests/e2e');
    expect(tests.some((item) => item.specFile?.includes('/wiki_1/'))).toBe(true);
    expect(tests.some((item) => item.specFile?.includes('/wiki_2/'))).toBe(true);
    expect(tests.length).toBeGreaterThanOrEqual(20);
  });

  it('generates jobs for a run with retry metadata', () => {
    const [job] = generateScheduledJobs('RUN-1', 'TC-1', 'Dummy test 1', 'checkout', 'chromium', 10000, 2, 'NORMAL');
    expect(job.jobId).toContain('RUN-1');
    expect(job.maxRetries).toBe(2);
    expect(job.attempt).toBe(1);
  });
});
