import { Pool, PoolConfig, QueryResultRow } from 'pg';
import { TestExecutionRecord } from '../../common/src/index.js';
import { config } from '../../config/src/index.js';

export interface DatabaseClient {
  connect(): Promise<void>;
  query<T extends QueryResultRow = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}

export class PostgresClient implements DatabaseClient {
  private readonly pool: Pool;

  constructor(private readonly connectionConfig: PoolConfig = config.postgres) {
    this.pool = new Pool(connectionConfig);
  }

  async connect(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async query<T extends QueryResultRow = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    return this.pool.query<T>(text, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export async function initializeDatabase(client: DatabaseClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS test_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      total_tests INTEGER NOT NULL DEFAULT 0,
      queued INTEGER NOT NULL DEFAULT 0,
      running INTEGER NOT NULL DEFAULT 0,
      passed INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      target_duration INTEGER NOT NULL DEFAULT 120,
      browser TEXT NOT NULL DEFAULT 'chromium'
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS test_executions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      status TEXT NOT NULL,
      duration INTEGER DEFAULT 0,
      worker_id TEXT,
      browser TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS test_attempts (
      id TEXT PRIMARY KEY,
      execution_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      failure_type TEXT,
      error_message TEXT,
      duration INTEGER DEFAULT 0,
      artifact_location TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS workers (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      active_jobs INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_test_executions_run_id ON test_executions(run_id);
    CREATE INDEX IF NOT EXISTS idx_test_executions_test_id ON test_executions(test_id);
    CREATE INDEX IF NOT EXISTS idx_test_executions_status ON test_executions(status);
    CREATE INDEX IF NOT EXISTS idx_test_attempts_execution_id ON test_attempts(execution_id);
    CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS execution_store_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      test_name TEXT,
      job_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      worker_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ,
      running_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      duration_ms INTEGER,
      error TEXT,
      failure_type TEXT,
      logs JSONB NOT NULL DEFAULT '[]'::jsonb,
      log_object TEXT,
      screenshot_object TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_execution_store_run_id ON execution_store_records(run_id);
    CREATE INDEX IF NOT EXISTS idx_execution_store_status ON execution_store_records(status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_store_attempt ON execution_store_records(run_id, test_id, attempt);
  `);

  await client.query(`
    ALTER TABLE execution_store_records
      ADD COLUMN IF NOT EXISTS run_name TEXT;
  `);
  await client.query(`
    UPDATE execution_store_records
    SET run_name = run_id
    WHERE run_name IS NULL OR run_name = '';
  `);
  await client.query(`
    ALTER TABLE execution_store_records
      ADD COLUMN IF NOT EXISTS spec_file TEXT;
  `);
}

function parseLogs(value: unknown): TestExecutionRecord['logs'] {
  if (Array.isArray(value)) return value as TestExecutionRecord['logs'];
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as TestExecutionRecord['logs'] : [];
    } catch {
      return [];
    }
  }
  return [];
}

function specFileFromLogs(logs: unknown): string | undefined {
  if (!Array.isArray(logs)) return undefined;
  const hit = logs.find((entry) => entry && typeof entry === 'object' && 'specFile' in entry && (entry as { specFile?: unknown }).specFile);
  return hit ? String((hit as { specFile: unknown }).specFile) : undefined;
}

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapExecutionRow(row: Record<string, unknown>): TestExecutionRecord {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    runName: row.run_name ? String(row.run_name) : String(row.run_id),
    testId: String(row.test_id),
    testName: row.test_name ? String(row.test_name) : undefined,
    specFile: row.spec_file ? String(row.spec_file) : specFileFromLogs(row.logs),
    jobId: String(row.job_id),
    attempt: Number(row.attempt),
    workerId: String(row.worker_id),
    status: row.status as TestExecutionRecord['status'],
    startedAt: toIso(row.started_at),
    runningAt: toIso(row.running_at),
    completedAt: toIso(row.completed_at),
    durationMs: row.duration_ms == null ? undefined : Number(row.duration_ms),
    error: row.error ? String(row.error) : undefined,
    failureType: row.failure_type ? String(row.failure_type) : undefined,
    logs: parseLogs(row.logs),
    logObject: row.log_object ? String(row.log_object) : undefined,
    screenshotObject: row.screenshot_object ? String(row.screenshot_object) : undefined,
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString()
  };
}

export async function getExecutionRecord(client: DatabaseClient, id: string): Promise<TestExecutionRecord | undefined> {
  const result = await client.query('SELECT * FROM execution_store_records WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapExecutionRow(row) : undefined;
}

export async function listStoredExecutions(client: DatabaseClient, runId?: string): Promise<TestExecutionRecord[]> {
  const result = runId
    ? await client.query('SELECT * FROM execution_store_records WHERE run_id = $1 ORDER BY updated_at ASC', [runId])
    : await client.query('SELECT * FROM execution_store_records ORDER BY updated_at ASC');
  return result.rows.map(mapExecutionRow);
}

export async function countStoredExecutions(client: DatabaseClient): Promise<number> {
  const result = await client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM execution_store_records');
  return Number(result.rows[0]?.count ?? 0);
}

export async function saveExecutionRecord(client: DatabaseClient, record: TestExecutionRecord): Promise<TestExecutionRecord> {
  const result = await client.query(
    `INSERT INTO execution_store_records (
      id, run_id, run_name, test_id, test_name, spec_file, job_id, attempt, worker_id, status,
      started_at, running_at, completed_at, duration_ms, error, failure_type,
      logs, log_object, screenshot_object, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      $17::jsonb, $18, $19, $20
    )
    ON CONFLICT (id) DO UPDATE SET
      run_name = EXCLUDED.run_name,
      test_name = EXCLUDED.test_name,
      spec_file = COALESCE(EXCLUDED.spec_file, execution_store_records.spec_file),
      job_id = EXCLUDED.job_id,
      worker_id = EXCLUDED.worker_id,
      status = EXCLUDED.status,
      started_at = EXCLUDED.started_at,
      running_at = EXCLUDED.running_at,
      completed_at = EXCLUDED.completed_at,
      duration_ms = EXCLUDED.duration_ms,
      error = EXCLUDED.error,
      failure_type = EXCLUDED.failure_type,
      logs = EXCLUDED.logs,
      log_object = EXCLUDED.log_object,
      screenshot_object = EXCLUDED.screenshot_object,
      updated_at = EXCLUDED.updated_at
    RETURNING *`,
    [
      record.id,
      record.runId,
      record.runName ?? record.runId,
      record.testId,
      record.testName ?? null,
      record.specFile ?? specFileFromLogs(record.logs) ?? null,
      record.jobId ?? '',
      record.attempt,
      record.workerId,
      record.status,
      record.startedAt ?? null,
      record.runningAt ?? null,
      record.completedAt ?? null,
      record.durationMs ?? null,
      record.error ?? null,
      record.failureType ?? null,
      JSON.stringify(record.logs ?? []),
      record.logObject ?? null,
      record.screenshotObject ?? null,
      record.updatedAt
    ]
  );
  return mapExecutionRow(result.rows[0]);
}
