import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, firefox, webkit, Browser, Page } from 'playwright';
import { config, queueNames } from '../../../packages/config/src/index.js';
import { buildFailureType, buildUniqueTestData, Job, FailureType, ExecutionLogEvent, TestExecutionStatus } from '../../../packages/common/src/index.js';
import { RabbitMqQueueClient } from '../../../packages/queue/src/index.js';
import { ensureBucket, putFile, screenshotKey } from '../../../packages/storage/src/index.js';

const queue = new RabbitMqQueueClient(config.rabbitmqUrl);
const workerId = process.env.WORKER_ID || process.env.HOSTNAME || osHostname();
const executionStoreUrl = config.executionStoreUrl;

function liveLogBuffer(job: Job): ExecutionLogEvent[] {
  const logs: ExecutionLogEvent[] = [];
  const originalPush = logs.push.bind(logs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  logs.push = ((...entries: ExecutionLogEvent[]) => {
    const length = originalPush(...entries);
    if (closed || timer) return length;
    timer = setTimeout(() => {
      timer = undefined;
      if (closed) return;
      void pushExecution('/executions/status', executionPayload(job, 'RUNNING', { logs: logs.slice() }));
    }, 250);
    return length;
  }) as typeof logs.push;
  Object.defineProperty(logs, 'close', {
    value: () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    }
  });
  return logs;
}

function log(event: string, details: Record<string, unknown>, sink?: ExecutionLogEvent[]): ExecutionLogEvent {
  const entry: ExecutionLogEvent = { ts: new Date().toISOString(), workerId, event, ...details };
  sink?.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
}

async function pushExecution(path: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch(`${executionStoreUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      console.error(JSON.stringify({
        event: 'EXECUTION_STORE_PUSH_FAILED',
        path,
        status: response.status,
        body: await response.text()
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: 'EXECUTION_STORE_PUSH_FAILED',
      path,
      error: error instanceof Error ? error.message : String(error)
    }));
  }
}

function executionPayload(job: Job, status: TestExecutionStatus, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: job.runId,
    runName: job.runName ?? job.runId,
    testId: job.testId,
    testName: job.testName,
    specFile: job.specFile,
    jobId: job.jobId,
    attempt: job.attempt,
    workerId,
    status,
    ...extra
  };
}

function shouldFail(testId: string, attempt: number): boolean {
  const seed = [...testId].reduce((sum, char) => sum + char.charCodeAt(0), 0) + attempt * 31;
  const deterministicFail = seed % 100 < config.dummyFailureRate * 100;
  const flakyFail = seed % 1000 < config.dummyFlakyRate * 1000 && attempt === 1;
  return deterministicFail || flakyFail;
}

function getFailureType(testId: string, attempt: number): FailureType {
  const seed = (testId.charCodeAt(0) || 1) + attempt + Math.round(config.dummyFailureRate * 10);
  return buildFailureType(seed);
}

async function createBrowser(browserName: string): Promise<Browser> {
  switch (browserName) {
    case 'firefox':
      return firefox.launch({ headless: true });
    case 'webkit':
      return webkit.launch({ headless: true });
    default:
      return chromium.launch({ headless: true });
  }
}

async function runDummyTest(job: Job, logs: ExecutionLogEvent[]): Promise<{ status: 'PASSED' | 'FAILED'; duration: number; error?: string; failureType?: FailureType; artifactLocation?: string }> {
  const startedAt = Date.now();
  let browser: Browser | undefined;
  const artifactDir = `artifacts/${job.runId}/${job.testId}/attempt_${job.attempt}`;

  await pushExecution('/executions/status', executionPayload(job, 'STARTED'));
  log('TESTCASE_STARTED', {
    runId: job.runId,
    testId: job.testId,
    testName: job.testName,
    attempt: job.attempt,
    browser: job.browser,
    suite: job.suite,
    estimatedDurationMs: job.estimatedDuration
  }, logs);

  try {
    browser = await createBrowser(job.browser);
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page: Page = await context.newPage();
    await mkdir(artifactDir, { recursive: true });

    await pushExecution('/executions/status', executionPayload(job, 'RUNNING'));
    log('TESTCASE_INTERACTION', {
      runId: job.runId,
      testId: job.testId,
      step: 'open_dummy_app',
      url: config.dummyAppUrl
    }, logs);
    await page.goto(config.dummyAppUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    const username = buildUniqueTestData(job.runId, job.testId, job.attempt);
    log('TESTCASE_INTERACTION', {
      runId: job.runId,
      testId: job.testId,
      step: 'fill_username',
      username
    }, logs);
    await page.locator('input[name="username"]').fill(username);

    log('TESTCASE_INTERACTION', {
      runId: job.runId,
      testId: job.testId,
      step: 'click_submit'
    }, logs);
    await page.locator('button[type="submit"]').click();

    await page.waitForTimeout(job.estimatedDuration);
    const shouldTriggerFailure = shouldFail(job.testId, job.attempt);
    if (shouldTriggerFailure) {
      const errorType = getFailureType(job.testId, job.attempt);
      const reason = `${errorType}: simulated failure for ${job.testId} attempt ${job.attempt}`;
      await page.screenshot({ path: `${artifactDir}/screenshot.png`, fullPage: true });
      throw new Error(reason);
    }

    await page.screenshot({ path: `${artifactDir}/screenshot.png`, fullPage: true });
    const duration = Date.now() - startedAt;
    log('TESTCASE_ENDED', {
      runId: job.runId,
      testId: job.testId,
      status: 'PASSED',
      durationMs: duration,
      artifactLocation: `${artifactDir}/screenshot.png`
    }, logs);
    return { status: 'PASSED', duration, artifactLocation: `${artifactDir}/screenshot.png` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    const failureType = getFailureType(job.testId, job.attempt);
    const duration = Date.now() - startedAt;
    log('TESTCASE_ENDED', {
      runId: job.runId,
      testId: job.testId,
      status: 'FAILED',
      failureType,
      error: message,
      durationMs: duration
    }, logs);
    return { status: 'FAILED', duration, error: message, failureType };
  } finally {
    await browser?.close();
  }
}

async function runSpecTest(job: Job, logs: ExecutionLogEvent[]): Promise<{ status: 'PASSED' | 'FAILED'; duration: number; error?: string; failureType?: FailureType; artifactLocation?: string }> {
  const startedAt = Date.now();
  const artifactDir = `artifacts/${job.runId}/${job.testId}/attempt_${job.attempt}`;
  const screenshotPath = path.resolve(artifactDir, 'screenshot.png');
  const playwrightBin = path.join(process.cwd(), 'node_modules', '.bin', 'playwright');

  await mkdir(artifactDir, { recursive: true });
  await pushExecution('/executions/status', executionPayload(job, 'STARTED'));
  log('TESTCASE_STARTED', {
    runId: job.runId,
    testId: job.testId,
    testName: job.testName,
    attempt: job.attempt,
    browser: job.browser,
    suite: job.suite,
    specFile: job.specFile
  }, logs);

  await pushExecution('/executions/status', executionPayload(job, 'RUNNING'));
  log('TESTCASE_INTERACTION', {
    runId: job.runId,
    testId: job.testId,
    step: 'run_playwright_spec',
    specFile: job.specFile
  }, logs);

  const result = await new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn(playwrightBin, [
      'test',
      String(job.specFile),
      '--workers=1',
      '--retries=0',
      '--timeout=90000',
      `--output=${path.join(artifactDir, 'playwright-output')}`,
      '--reporter=line'
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCREENSHOT_PATH: screenshotPath,
        CI: '1'
      }
    });
    let output = '';
    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      for (const line of text.split('\n').map((item) => item.trim()).filter(Boolean)) {
        log('TESTCASE_INTERACTION', {
          runId: job.runId,
          testId: job.testId,
          step: 'playwright_output',
          line
        }, logs);
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (error) => {
      resolve({ code: 1, output: `${output}\n${error.message}` });
    });
    child.on('close', (code) => resolve({ code, output }));
  });

  const duration = Date.now() - startedAt;
  const passed = result.code === 0;
  if (!passed) {
    log('TESTCASE_ENDED', {
      runId: job.runId,
      testId: job.testId,
      status: 'FAILED',
      durationMs: duration,
      error: result.output.slice(-2000)
    }, logs);
    return {
      status: 'FAILED',
      duration,
      error: result.output.slice(-2000) || `Playwright exited ${result.code}`,
      failureType: 'AUTOMATION_FAILURE',
      artifactLocation: screenshotPath
    };
  }

  log('TESTCASE_ENDED', {
    runId: job.runId,
    testId: job.testId,
    status: 'PASSED',
    durationMs: duration,
    artifactLocation: screenshotPath
  }, logs);
  return { status: 'PASSED', duration, artifactLocation: screenshotPath };
}

async function uploadScreenshot(job: Job, localPath?: string): Promise<string | undefined> {
  if (!localPath) return undefined;
  try {
    await access(localPath);
    const objectName = screenshotKey(job.runId, job.testId, job.attempt);
    await putFile(objectName, localPath, 'image/png');
    return objectName;
  } catch (error) {
    console.error(JSON.stringify({
      event: 'MINIO_SCREENSHOT_UPLOAD_FAILED',
      error: error instanceof Error ? error.message : String(error)
    }));
    return undefined;
  }
}
async function processJob(job: Job, message: any): Promise<void> {
  try {
    const logs = liveLogBuffer(job);
    const result = job.specFile ? await runSpecTest(job, logs) : await runDummyTest(job, logs);
    (logs as ExecutionLogEvent[] & { close?: () => void }).close?.();
    const screenshotObject = await uploadScreenshot(job, result.artifactLocation);
    const terminalStatus: TestExecutionStatus = result.status === 'FAILED' ? 'FAILED' : 'COMPLETED';
    await pushExecution('/executions/status', executionPayload(job, terminalStatus, { error: result.error }));
    await pushExecution('/executions/complete', executionPayload(job, terminalStatus, {
      durationMs: result.duration,
      error: result.error,
      failureType: result.failureType,
      logs,
      screenshotObject
    }));
    if (result.status === 'FAILED') {
      if (job.attempt <= job.maxRetries) {
        const retryJob: Job = { ...job, attempt: job.attempt + 1, createdAt: new Date().toISOString() };
        await queue.publishJob(queueNames.retry, retryJob);
        log('TESTCASE_RETRY_QUEUED', { runId: job.runId, testId: job.testId, nextAttempt: retryJob.attempt });
      }
      await queue.publishJob(queueNames.results, job);
    } else {
      await queue.publishJob(queueNames.results, job);
    }
    queue.ack(message);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    log('TESTCASE_WORKER_ERROR', {
      runId: job.runId,
      testId: job.testId,
      error: messageText
    });
    throw error;
  }
}

async function startWorker(): Promise<void> {
  await ensureBucket();
  await queue.connect();
  await queue.assertQueues();
  log('WORKER_STARTED', { workerId, concurrency: config.workerConcurrency, dummyAppUrl: config.dummyAppUrl });

  const handleJob = async (job: Job, message: any) => {
    await processJob(job, message);
  };

  await queue.setPrefetch(config.workerConcurrency);
  await queue.consumeJobs(queueNames.execution, handleJob);
  await queue.consumeJobs(queueNames.retry, handleJob);
}

startWorker().catch((error) => {
  console.error('Worker failed to start', error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  log('WORKER_SHUTDOWN', { signal: 'SIGTERM' });
  await queue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  log('WORKER_SHUTDOWN', { signal: 'SIGINT' });
  await queue.close();
  process.exit(0);
});
