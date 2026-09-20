import { config } from '../packages/config/src/index.js';

const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
const payload = {
  testCount: Number(process.env.TEST_COUNT ?? 10000),
  workerReplicas: Number(process.env.WORKER_REPLICAS ?? config.workerReplicas),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? config.workerConcurrency),
  maxConcurrentTests: Number(process.env.MAX_CONCURRENT_TESTS ?? config.maxConcurrentTests),
  browser: process.env.DEFAULT_BROWSER ?? config.defaultBrowser,
  targetDurationMinutes: Number(process.env.TARGET_DURATION_MINUTES ?? config.targetDurationMinutes)
};

async function startRun(): Promise<void> {
  console.log('Starting 10,000-test distributed execution simulation');
  console.log(JSON.stringify(payload, null, 2));

  const response = await fetch(`${orchestratorUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      testCount: payload.testCount,
      targetDurationMinutes: payload.targetDurationMinutes,
      browser: payload.browser,
      runName: process.env.RUN_NAME
    })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to start run: ${response.status} ${JSON.stringify(body)}`);
  }

  console.log('Run accepted');
  console.log(JSON.stringify(body, null, 2));
  console.log(`Status: ${orchestratorUrl}/runs/${body.runId}/status`);
}

startRun().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
