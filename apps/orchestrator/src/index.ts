import express, { Request, Response } from 'express';
import { config, queueNames } from '../../../packages/config/src/index.js';
import { generateRunId, RunStatus, TestRun, TestCase } from '../../../packages/common/src/index.js';
import { RabbitMqQueueClient } from '../../../packages/queue/src/index.js';
import { createDummyTestCaseSet, createE2eTestCaseSet, scheduleJobsForRun } from '../../scheduler/src/scheduler.js';

interface RunState extends TestRun {
  tests: TestCase[];
  jobsPublished: number;
}

const app = express();
const queue = new RabbitMqQueueClient(config.rabbitmqUrl);
const runs = new Map<string, RunState>();

app.use(express.json());

async function ensureQueue() {
  await queue.connect();
  await queue.assertQueues();
}

app.get('/health', async (_req: Request, res: Response) => {
  try {
    await queue.connect();
    return res.json({ status: 'ok', rabbitmq: 'connected' });
  } catch (error) {
    return res.status(503).json({ status: 'degraded', error: (error as Error).message });
  }
});

app.post('/runs', async (req: Request, res: Response) => {
  const browser = (req.body?.browser ?? config.defaultBrowser) as TestRun['browser'];
  const targetMinutes = Number(req.body?.targetDurationMinutes ?? config.targetDurationMinutes);
  const source = String(req.body?.source ?? 'dummy');

  const runId = generateRunId();
  const requestedName = String(req.body?.runName ?? req.body?.name ?? '').trim();
  const runName = requestedName || runId;
  const testDir = String(req.body?.testDir ?? req.body?.e2eDir ?? process.env.E2E_DIR ?? 'tests/e2e');
  let tests;
  try {
    tests = source === 'e2e'
      ? createE2eTestCaseSet(browser, testDir)
      : createDummyTestCaseSet(Math.max(1, Number(req.body?.testCount ?? config.testCount)), browser);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  if (source === 'e2e' && tests.length === 0) {
    return res.status(400).json({ error: `No spec files found in ${testDir}` });
  }
  const totalTests = tests.length;
  const state: RunState = {
    id: runId,
    name: runName,
    status: 'QUEUED',
    totalTests,
    queued: totalTests,
    running: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
    completedAt: undefined,
    targetDurationMinutes: targetMinutes,
    browser,
    tests,
    jobsPublished: 0
  };

  try {
    await ensureQueue();
    const jobs = scheduleJobsForRun(runId, tests, totalTests, config.maxRetries, browser, runName);
    for (const job of jobs) {
      await queue.publishJob(queueNames.execution, job);
      state.jobsPublished += 1;
    }
    state.status = 'RUNNING';
    state.queued = totalTests;
    runs.set(runId, state);
    return res.status(202).json({
      runId,
      runName,
      totalTests,
      status: state.status,
      source,
      ...(source === 'e2e' ? { testDir } : {})
    });
  } catch (error) {
    state.status = 'FAILED';
    runs.set(runId, state);
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/runs/:runId', (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const run = runs.get(runId);
  if (!run) {
    return res.status(404).json({ message: 'run not found' });
  }
  return res.json(run);
});

app.get('/runs/:runId/status', (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const run = runs.get(runId);
  if (!run) {
    return res.status(404).json({ message: 'run not found' });
  }

  return res.json({
    runId: run.id,
    runName: run.name,
    status: run.status,
    totalTests: run.totalTests,
    queued: run.queued,
    running: run.running,
    passed: run.passed,
    failed: run.failed,
    retries: 0,
    throughputPerMinute: Math.max(1, run.passed > 0 ? Math.round(run.passed / Math.max(1, (Date.now() - new Date(run.startedAt ?? Date.now()).getTime()) / 60000)) : 0),
    etaMinutes: Math.ceil(Math.max(0, run.totalTests - run.passed) / Math.max(1, Math.max(1, run.passed > 0 ? Math.round(run.passed / Math.max(1, (Date.now() - new Date(run.startedAt ?? Date.now()).getTime()) / 60000)) : 1)))
  });
});

app.post('/runs/:runId/cancel', (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const run = runs.get(runId);
  if (!run) {
    return res.status(404).json({ message: 'run not found' });
  }
  run.status = 'CANCELLED';
  return res.json({ runId: run.id, status: run.status });
});

const port = Number(process.env.ORCHESTRATOR_PORT ?? config.port);
app.listen(port, () => {
  console.log(`Orchestrator listening on http://0.0.0.0:${port}`);
});
