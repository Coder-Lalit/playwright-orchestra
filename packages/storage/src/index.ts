import { Client } from 'minio';
import { config } from '../../config/src/index.js';
import { TestExecutionRecord } from '../../common/src/index.js';

const bucket = config.minio.bucket;

export const objectStore = new Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  useSSL: config.minio.useSSL,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey
});

export function executionLogKey(runId: string, testId: string, attempt: number): string {
  return `${runId}/${testId}/attempt_${attempt}/execution.json`;
}

export function screenshotKey(runId: string, testId: string, attempt: number): string {
  return `${runId}/${testId}/attempt_${attempt}/screenshot.png`;
}

export async function ensureBucket(): Promise<void> {
  const exists = await objectStore.bucketExists(bucket);
  if (!exists) {
    await objectStore.makeBucket(bucket);
  }
}

export async function putJson(objectName: string, value: unknown): Promise<string> {
  const payload = Buffer.from(JSON.stringify(value, null, 2));
  await objectStore.putObject(bucket, objectName, payload, payload.length, { 'Content-Type': 'application/json' });
  return objectName;
}

export async function putFile(objectName: string, filePath: string, contentType: string): Promise<string> {
  await objectStore.fPutObject(bucket, objectName, filePath, { 'Content-Type': contentType });
  return objectName;
}

export async function getJson<T>(objectName: string): Promise<T | undefined> {
  try {
    const stream = await objectStore.getObject(bucket, objectName);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function getObjectStream(objectName: string) {
  return objectStore.getObject(bucket, objectName);
}

export async function listExecutionRecords(): Promise<TestExecutionRecord[]> {
  const records: TestExecutionRecord[] = [];
  const stream = objectStore.listObjectsV2(bucket, '', true);
  const keys: string[] = [];
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (item) => {
      if (item.name?.endsWith('/execution.json')) {
        keys.push(item.name);
      }
    });
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  for (const key of keys) {
    const record = await getJson<TestExecutionRecord>(key);
    if (record) {
      records.push(record);
    }
  }
  return records;
}
