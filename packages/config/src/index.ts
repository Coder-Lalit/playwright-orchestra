import { config as loadDotenv } from 'dotenv';
import { parseDurationMs } from '../../common/src/index.js';

loadDotenv();

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseDurationMs(process.env.PORT, 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  postgres: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseDurationMs(process.env.POSTGRES_PORT, 5432),
    database: process.env.POSTGRES_DB ?? 'automation',
    user: process.env.POSTGRES_USER ?? 'automation',
    password: process.env.POSTGRES_PASSWORD ?? 'automation'
  },
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  minio: {
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseDurationMs(process.env.MINIO_PORT, 9000),
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    bucket: process.env.MINIO_BUCKET ?? 'artifacts',
    useSSL: (process.env.MINIO_USE_SSL ?? 'false') === 'true'
  },
  dummyAppUrl: process.env.DUMMY_APP_URL ?? 'http://localhost:4173',
  dummyFailureRate: Number(process.env.DUMMY_FAILURE_RATE ?? 0.02),
  dummyFlakyRate: Number(process.env.DUMMY_FLAKY_RATE ?? 0.01),
  maxRetries: Number(process.env.MAX_RETRIES ?? 2),
  workerReplicas: Number(process.env.WORKER_REPLICAS ?? 5),
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
  maxConcurrentTests: Number(process.env.MAX_CONCURRENT_TESTS ?? 10),
  defaultBrowser: (process.env.DEFAULT_BROWSER ?? 'chromium') as 'chromium' | 'firefox' | 'webkit',
  targetDurationMinutes: Number(process.env.TARGET_DURATION_MINUTES ?? 120),
  simulateWorkerFailure: (process.env.SIMULATE_WORKER_FAILURE ?? 'false') === 'true',
  playwright: {
    timeout: Number(process.env.PLAYWRIGHT_TIMEOUT ?? 30000),
    expectTimeout: Number(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? 10000),
    trace: (process.env.PLAYWRIGHT_TRACE ?? 'true') === 'true',
    screenshot: (process.env.PLAYWRIGHT_SCREENSHOT ?? 'true') === 'true',
    video: (process.env.PLAYWRIGHT_VIDEO ?? 'true') === 'true',
    workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 1)
  },
  testCount: Number(process.env.TEST_COUNT ?? 10000),
  buildMode: process.env.BUILD_MODE ?? 'local',
  executionStoreUrl: process.env.EXECUTION_STORE_URL ?? 'http://localhost:3100',
  executionStorePort: Number(process.env.EXECUTION_STORE_PORT ?? 3100)
};

export const queueNames = {
  execution: 'test.execution',
  retry: 'test.retry',
  results: 'test.results',
  deadLetter: 'test.deadletter'
};

export function getQueueConfig() {
  return {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queueNames.deadLetter }
  };
}
