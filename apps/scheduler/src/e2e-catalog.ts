import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface E2eCatalogEntry {
  testId: string;
  term: string;
  specFile: string;
}

export const DEFAULT_E2E_DIR = 'tests/e2e';

function listSpecFiles(dir: string, root: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSpecFiles(fullPath, root));
      continue;
    }
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.spec.js')) {
      files.push(path.relative(root, fullPath).split(path.sep).join('/'));
    }
  }
  return files.sort();
}

function termFromSpec(specFile: string): string {
  const base = path.basename(specFile).replace(/\.spec\.[tj]s$/i, '');
  const slug = base.replace(/^wikipedia-/i, '');
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || base;
}

function testIdFromSpec(specFile: string): string {
  const relative = specFile.replace(/^tests\/e2e\/?/i, '').replace(/\.spec\.[tj]s$/i, '');
  return `TC-${relative.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()}`;
}

export function resolveE2eDir(testDir: string = DEFAULT_E2E_DIR, cwd: string = process.cwd()): string {
  const requested = testDir.trim() || DEFAULT_E2E_DIR;
  const root = path.resolve(cwd);
  const resolved = path.resolve(cwd, requested);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`testDir must stay inside the project: ${requested}`);
  }
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`testDir not found: ${requested}`);
  }
  return resolved;
}

export function loadE2eCatalog(testDir: string = DEFAULT_E2E_DIR, cwd: string = process.cwd()): E2eCatalogEntry[] {
  const folder = resolveE2eDir(testDir, cwd);
  return listSpecFiles(folder, cwd).map((specFile) => ({
    testId: testIdFromSpec(specFile),
    term: termFromSpec(specFile),
    specFile
  }));
}
