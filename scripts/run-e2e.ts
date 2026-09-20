import { spawn } from 'node:child_process';
import path from 'node:path';

const orchestratorUrl = process.env.ORCHESTRATOR_URL ?? 'http://localhost:3000';
const e2eDir = (process.env.E2E_DIR ?? 'tests/e2e').trim() || 'tests/e2e';

type E2eTarget = 'local' | 'queue';

function resolveTarget(): E2eTarget {
  const raw = (process.env.E2E_TARGET ?? process.env.E2E_ENV ?? 'queue').trim().toLowerCase();
  if (['local', 'loc', 'localhost', 'host'].includes(raw)) return 'local';
  if (['queue', 'q', 'framework', 'distributed'].includes(raw)) return 'queue';
  throw new Error(`Unknown E2E_TARGET="${raw}". Use local or queue.`);
}

function runLocal(): Promise<void> {
  const playwrightBin = path.join(process.cwd(), 'node_modules', '.bin', 'playwright');
  console.log(`Starting e2e run locally from ${e2eDir} (Playwright, no queue)`);
  return new Promise((resolve, reject) => {
    const child = spawn(playwrightBin, ['test', e2eDir, '--reporter=list'], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Playwright exited with code ${code}`));
    });
  });
}

async function runQueue(): Promise<void> {
  console.log(`Starting e2e run through the queue from folder ${e2eDir}`);
  const response = await fetch(`${orchestratorUrl}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'e2e',
      testDir: e2eDir,
      browser: process.env.DEFAULT_BROWSER ?? 'chromium',
      runName: process.env.RUN_NAME
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to start run: ${response.status} ${JSON.stringify(body)}`);
  }
  console.log(JSON.stringify(body, null, 2));
  console.log(`Status: ${orchestratorUrl}/runs/${body.runId}/status`);
  console.log(`Execution store: http://localhost:3100/  (run ${body.runName ?? body.runId})`);
}

async function startE2eRun(): Promise<void> {
  const target = resolveTarget();
  console.log(`E2E_TARGET=${target}`);
  if (target === 'local') {
    await runLocal();
    return;
  }
  await runQueue();
}

startE2eRun().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
