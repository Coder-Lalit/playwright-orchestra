export type BrowserType = 'chromium' | 'firefox' | 'webkit';
export type TestPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type ExecutionStatus = 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'RETRYING' | 'SKIPPED' | 'CANCELLED';
export type FailureType = 'ASSERTION_FAILURE' | 'TIMEOUT' | 'AUTOMATION_FAILURE' | 'BROWSER_FAILURE' | 'ENVIRONMENT_FAILURE' | 'UNKNOWN';

export interface TestCase {
  testId: string;
  testName: string;
  suite: string;
  estimatedDuration: number;
  browser: BrowserType;
  priority: TestPriority;
  tags: string[];
  enabled: boolean;
  specFile?: string;
}

export interface Job {
  jobId: string;
  runId: string;
  testId: string;
  testName: string;
  browser: BrowserType;
  attempt: number;
  maxRetries: number;
  priority: TestPriority;
  createdAt: string;
  suite: string;
  estimatedDuration: number;
  specFile?: string;
  runName?: string;
}

export interface ExecutionAttempt {
  id: string;
  executionId: string;
  attempt: number;
  status: ExecutionStatus;
  failureType?: FailureType;
  errorMessage?: string;
  duration: number;
  artifactLocation?: string;
  createdAt: string;
}

export interface TestExecution {
  id: string;
  runId: string;
  testId: string;
  status: ExecutionStatus;
  duration: number;
  workerId?: string;
  browser: BrowserType;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  attempts: ExecutionAttempt[];
}

export interface TestRun {
  id: string;
  name: string;
  status: RunStatus;
  totalTests: number;
  queued: number;
  running: number;
  passed: number;
  failed: number;
  skipped: number;
  startedAt?: string;
  completedAt?: string;
  targetDurationMinutes: number;
  browser: BrowserType;
}

export interface QueueMessage<T = unknown> {
  exchange?: string;
  routingKey?: string;
  payload: T;
}

export interface ExecutionLogEvent {
  ts: string;
  workerId: string;
  event: string;
  runId?: string;
  testId?: string;
  testName?: string;
  attempt?: number;
  status?: string;
  step?: string;
  error?: string;
  [key: string]: unknown;
}

export type TestExecutionStatus = 'STARTED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface TestExecutionRecord {
  id: string;
  runId: string;
  runName?: string;
  testId: string;
  testName?: string;
  specFile?: string;
  jobId: string;
  attempt: number;
  workerId: string;
  status: TestExecutionStatus;
  startedAt?: string;
  runningAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  failureType?: string;
  logs: ExecutionLogEvent[];
  logObject?: string;
  screenshotObject?: string;
  updatedAt: string;
}

export interface MetricsSnapshot {
  total: number;
  passed: number;
  failed: number;
  running: number;
  queued: number;
  retries: number;
  throughputPerMinute: number;
  etaMinutes: number;
}

export function generateRunId(): string {
  return `RUN-${Date.now().toString(36).toUpperCase()}`;
}

export function generateJobId(runId: string, testId: string, attempt: number): string {
  return `${runId}-${testId}-A${attempt}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseDurationMs(value: string | number | undefined, fallback: number): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

export function buildFailureType(seed: number): FailureType {
  const choices: FailureType[] = [
    'ASSERTION_FAILURE',
    'TIMEOUT',
    'AUTOMATION_FAILURE',
    'BROWSER_FAILURE',
    'ENVIRONMENT_FAILURE',
    'UNKNOWN'
  ];
  return choices[seed % choices.length] ?? 'UNKNOWN';
}

export function buildUniqueTestData(runId: string, testId: string, attempt: number): string {
  return `user-${runId}-${testId}-${attempt}`;
}
