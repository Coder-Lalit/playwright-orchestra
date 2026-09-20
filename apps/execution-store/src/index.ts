import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { TestExecutionRecord, TestExecutionStatus } from '../../../packages/common/src/index.js';
import { config } from '../../../packages/config/src/index.js';
import {
  PostgresClient,
  countStoredExecutions,
  getExecutionRecord,
  initializeDatabase,
  listStoredExecutions,
  saveExecutionRecord
} from '../../../packages/database/src/index.js';
import { ensureBucket, executionLogKey, getJson, getObjectStream, listExecutionRecords, putJson, screenshotKey } from '../../../packages/storage/src/index.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const db = new PostgresClient();
const app = express();
app.use(express.json({ limit: '2mb' }));

function executionKey(runId: string, testId: string, attempt: number): string {
  return `${runId}:${testId}:${attempt}`;
}

async function upsert(partial: Partial<TestExecutionRecord> & { runId: string; testId: string; attempt: number; jobId: string; workerId: string; status: TestExecutionStatus }): Promise<TestExecutionRecord> {
  const id = executionKey(partial.runId, partial.testId, partial.attempt);
  const existing = await getExecutionRecord(db, id);
  const now = new Date().toISOString();
  const record: TestExecutionRecord = {
    id,
    runId: partial.runId,
    runName: partial.runName ?? existing?.runName ?? partial.runId,
    testId: partial.testId,
    testName: partial.testName ?? existing?.testName,
    specFile: partial.specFile ?? existing?.specFile,
    jobId: partial.jobId,
    attempt: partial.attempt,
    workerId: partial.workerId,
    status: existing && ['COMPLETED', 'FAILED'].includes(existing.status) && ['STARTED', 'RUNNING'].includes(partial.status)
      ? existing.status
      : partial.status,
    startedAt: partial.startedAt ?? existing?.startedAt,
    runningAt: partial.runningAt ?? existing?.runningAt,
    completedAt: partial.completedAt ?? existing?.completedAt,
    durationMs: partial.durationMs ?? existing?.durationMs,
    error: partial.error ?? existing?.error,
    failureType: partial.failureType ?? existing?.failureType,
    logs: Array.isArray(partial.logs) && partial.logs.length > 0
      ? partial.logs
      : (existing?.logs?.length ? existing.logs : (partial.logs ?? [])),
    logObject: partial.logObject ?? existing?.logObject,
    screenshotObject: partial.screenshotObject ?? existing?.screenshotObject,
    updatedAt: now
  };
  return saveExecutionRecord(db, record);
}

async function persistArtifacts(record: TestExecutionRecord): Promise<TestExecutionRecord> {
  const logObject = executionLogKey(record.runId, record.testId, record.attempt);
  record.logObject = logObject;
  await putJson(logObject, record);
  return saveExecutionRecord(db, record);
}

app.get('/health', async (_req, res) => {
  return res.json({
    status: 'ok',
    executions: await countStoredExecutions(db),
    source: 'postgres',
    bucket: config.minio.bucket
  });
});

app.post('/executions/status', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const status = body.status as TestExecutionStatus;
  if (!body.runId || !body.testId || !body.jobId || !status) {
    return res.status(400).json({ error: 'runId, testId, jobId, and status are required' });
  }
  if (!['STARTED', 'RUNNING', 'COMPLETED', 'FAILED'].includes(status)) {
    return res.status(400).json({ error: 'status must be STARTED, RUNNING, COMPLETED, or FAILED' });
  }

  const now = new Date().toISOString();
  const record = await upsert({
    runId: String(body.runId),
    runName: typeof body.runName === 'string' && body.runName.trim() ? body.runName.trim() : undefined,
    testId: String(body.testId),
    testName: body.testName,
    specFile: typeof body.specFile === 'string' && body.specFile.trim() ? body.specFile.trim() : undefined,
    jobId: String(body.jobId),
    attempt: Number(body.attempt ?? 1),
    workerId: String(body.workerId ?? 'unknown'),
    status,
    startedAt: status === 'STARTED' ? now : undefined,
    runningAt: status === 'RUNNING' ? now : undefined,
    completedAt: status === 'COMPLETED' || status === 'FAILED' ? now : undefined,
    error: body.error,
    logs: Array.isArray(body.logs) ? body.logs : undefined
  });
  return res.status(202).json(record);
});

app.post('/executions/complete', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const status = body.status as TestExecutionStatus;
  if (!body.runId || !body.testId || !body.jobId || !status) {
    return res.status(400).json({ error: 'runId, testId, jobId, and status are required' });
  }
  if (status !== 'COMPLETED' && status !== 'FAILED') {
    return res.status(400).json({ error: 'complete status must be COMPLETED or FAILED' });
  }

  const now = new Date().toISOString();
  let record = await upsert({
    runId: String(body.runId),
    runName: typeof body.runName === 'string' && body.runName.trim() ? body.runName.trim() : undefined,
    testId: String(body.testId),
    testName: body.testName,
    specFile: typeof body.specFile === 'string' && body.specFile.trim() ? body.specFile.trim() : undefined,
    jobId: String(body.jobId),
    attempt: Number(body.attempt ?? 1),
    workerId: String(body.workerId ?? 'unknown'),
    status,
    completedAt: now,
    durationMs: Number(body.durationMs ?? 0),
    error: body.error,
    failureType: body.failureType,
    logs: Array.isArray(body.logs) ? body.logs : undefined,
    screenshotObject: typeof body.screenshotObject === 'string' ? body.screenshotObject : undefined
  });
  try {
    record = await persistArtifacts(record);
  } catch (error) {
    console.error('Failed to persist execution artifacts to MinIO', error);
  }
  return res.status(202).json(record);
});

app.get('/executions', async (req: Request, res: Response) => {
  const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
  const records = await listStoredExecutions(db, runId);
  return res.json({ count: records.length, source: 'postgres', executions: records });
});

app.get('/executions/:runId/:testId/:attempt/minio', async (req: Request, res: Response) => {
  const runId = String(req.params.runId);
  const testId = String(req.params.testId);
  const attempt = Number(req.params.attempt);
  const objectName = executionLogKey(runId, testId, attempt);
  const fromMinio = await getJson<TestExecutionRecord>(objectName);
  if (!fromMinio) {
    return res.status(404).json({ message: 'not found in MinIO', objectName });
  }
  return res.json({ source: 'minio', objectName, execution: fromMinio });
});

app.get('/artifacts/:runId/:testId/:attempt/execution.json', async (req: Request, res: Response) => {
  const objectName = executionLogKey(String(req.params.runId), String(req.params.testId), Number(req.params.attempt));
  try {
    const stream = await getObjectStream(objectName);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `inline; filename="${String(req.params.testId)}-attempt-${req.params.attempt}-execution.json"`);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch {
    return res.status(404).json({ message: 'execution.json not found in MinIO', objectName });
  }
});

app.get('/artifacts/:runId/:testId/:attempt/screenshot.png', async (req: Request, res: Response) => {
  const objectName = screenshotKey(String(req.params.runId), String(req.params.testId), Number(req.params.attempt));
  try {
    const stream = await getObjectStream(objectName);
    res.setHeader('Content-Type', 'image/png');
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch {
    return res.status(404).end();
  }
});

app.get('/executions/:runId', async (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const records = await listStoredExecutions(db, runId);
  if (records.length === 0) {
    return res.status(404).json({ message: 'no executions for run' });
  }
  return res.json({ runId, count: records.length, source: 'postgres', executions: records });
});

app.get('/executions/:runId/:testId', async (req: Request, res: Response) => {
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const testId = Array.isArray(req.params.testId) ? req.params.testId[0] : req.params.testId;
  const records = (await listStoredExecutions(db, runId)).filter((item) => item.testId === testId);
  if (records.length === 0) {
    return res.status(404).json({ message: 'execution not found' });
  }
  return res.json(records);
});

app.use(express.static(publicDir));

const port = Number(process.env.EXECUTION_STORE_PORT ?? config.executionStorePort);

async function start(): Promise<void> {
  await db.connect();
  await initializeDatabase(db);
  await ensureBucket();
  let stored = await countStoredExecutions(db);
  if (stored === 0) {
    const fromMinio = await listExecutionRecords();
    for (const record of fromMinio) {
      await saveExecutionRecord(db, {
        ...record,
        logs: record.logs ?? [],
        updatedAt: record.updatedAt ?? new Date().toISOString()
      });
    }
    stored = fromMinio.length;
    console.log(`Imported ${fromMinio.length} executions from MinIO into Postgres`);
  }
  app.listen(port, () => {
    console.log(`Execution store listening on http://0.0.0.0:${port}`);
    console.log(`Postgres holds ${stored} executions; MinIO bucket ${config.minio.bucket}`);
  });
}

start().catch((error) => {
  console.error('Execution store failed to start', error);
  process.exit(1);
});
