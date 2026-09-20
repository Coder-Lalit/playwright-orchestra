const els = {
  subtitle: document.getElementById('subtitle'),
  liveDot: document.getElementById('liveDot'),
  pauseBtn: document.getElementById('pauseBtn'),
  crumb: document.getElementById('crumb'),
  view: document.getElementById('view')
};

let paused = false;
let records = [];
let selectedRunId = null;
let selectedId = null;
let statusFilter = '';
let testView = 'list';
let lastDetailKey = '';
let lastTestsKey = '';

const labels = {
  STARTED: 'Started',
  RUNNING: 'In Progress',
  COMPLETED: 'Completed',
  FAILED: 'Failed'
};

function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDuration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return '—';
  const value = Number(ms);
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatLogLine(entry) {
  const time = (entry.ts || '').replace('T', ' ').replace('Z', '');
  if (entry.line) {
    return `[${time}] ${String(entry.line).replace(/\u001b\[[0-9;]*m/g, '')}`;
  }
  const parts = [entry.event];
  if (entry.step) parts.push(entry.step);
  if (entry.specFile) parts.push(entry.specFile);
  if (entry.testName) parts.push(entry.testName);
  if (entry.url) parts.push(entry.url);
  if (entry.username) parts.push(`user=${entry.username}`);
  if (entry.status) parts.push(entry.status);
  if (entry.durationMs != null) parts.push(formatDuration(entry.durationMs));
  if (entry.suite) parts.push(entry.suite);
  if (entry.browser) parts.push(entry.browser);
  const extra = entry.error ? `\n  ${entry.error}` : '';
  return `[${time}] ${parts.filter(Boolean).join('  ·  ')}${extra}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runDisplayName(items) {
  const named = items.find((item) => item.runName);
  return named?.runName || items[0]?.runId || '';
}

function badge(status) {
  return `<span class="badge ${status}">${labels[status] || status}</span>`;
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'runs' && parts[1]) {
    selectedRunId = decodeURIComponent(parts[1]);
    selectedId = parts[2] ? decodeURIComponent(parts.slice(2).join('/')) : null;
    return;
  }
  selectedRunId = null;
  selectedId = null;
}

function setHash() {
  if (!selectedRunId) {
    history.replaceState(null, '', '#/runs');
    return;
  }
  const path = selectedId
    ? `#/runs/${encodeURIComponent(selectedRunId)}/${encodeURIComponent(selectedId)}`
    : `#/runs/${encodeURIComponent(selectedRunId)}`;
  history.replaceState(null, '', path);
}

function runStatus(items) {
  const inFlight = items.filter((item) => item.status === 'STARTED' || item.status === 'RUNNING');
  if (inFlight.length > 0) {
    const allStarted = items.every((item) => item.status === 'STARTED');
    return allStarted ? 'STARTED' : 'RUNNING';
  }
  if (items.some((item) => item.status === 'FAILED')) return 'FAILED';
  return 'COMPLETED';
}

function groupedRuns() {
  const byRun = new Map();
  for (const item of records) {
    const current = byRun.get(item.runId) || [];
    current.push(item);
    byRun.set(item.runId, current);
  }
  return [...byRun.entries()]
    .map(([runId, items]) => {
      const startedAt = items
        .map((item) => item.startedAt || item.updatedAt)
        .sort()[0];
      return {
        runId,
        runName: runDisplayName(items),
        startedAt,
        count: items.length,
        status: runStatus(items)
      };
    })
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

function testsForRun() {
  return records
    .filter((item) => item.runId === selectedRunId)
    .filter((item) => !statusFilter || item.status === statusFilter)
    .sort((a, b) => a.testId.localeCompare(b.testId) || a.attempt - b.attempt);
}

function renderCrumb() {
  const parts = ['<button type="button" class="link" data-nav="runs">Runs</button>'];
  if (selectedRunId) {
    const runItems = records.filter((item) => item.runId === selectedRunId);
    const name = escapeHtml(runDisplayName(runItems) || selectedRunId);
    parts.push('<span>/</span>');
    parts.push(`<button type="button" class="link" data-nav="run">${name}</button>`);
  }
  if (selectedId) {
    const item = records.find((row) => row.id === selectedId);
    parts.push('<span>/</span>');
    parts.push(`<span>${item ? item.testId : 'Execution'}</span>`);
  }
  els.crumb.innerHTML = parts.join('');
}

function renderRuns() {
  els.subtitle.textContent = 'Runs';
  const runs = groupedRuns();
  if (runs.length === 0) {
    els.view.innerHTML = '<div class="empty">No runs yet. Start a load with npm run run:load.</div>';
    return;
  }
  els.view.innerHTML = `<table class="table">
    <thead>
      <tr>
        <th>Run name</th>
        <th>Run ID</th>
        <th>Date and time</th>
        <th>Tests</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${runs.map((run) => `<tr data-run="${run.runId}">
        <td>${escapeHtml(run.runName)}</td>
        <td class="mono muted">${run.runId}</td>
        <td>${formatDateTime(run.startedAt)}</td>
        <td class="muted">${run.count}</td>
        <td>${badge(run.status)}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function specPath(item) {
  if (item.specFile) return item.specFile;
  const hit = (item.logs || []).find((entry) => entry.specFile);
  return hit?.specFile || '';
}

function folderPath(item) {
  const file = specPath(item).replace(/\\/g, '/');
  const parts = file.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : 'Root';
}

function folderLabel(folder) {
  if (folder === 'Root') return folder;
  const displayPath = folder.replace(/^tests\//i, '');
  return displayPath
    .split('/')
    .map((part, index) => index === 0 ? part.toUpperCase() : part)
    .join(' / ');
}

function testRows(rows) {
  if (testView !== 'folder') {
    return `<table class="table">
    <thead>
      <tr>
        <th>Test</th>
        <th>File</th>
        <th>Worker</th>
        <th>Attempt</th>
        <th>Duration</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map((item) => testRow(item)).join('')}
    </tbody>
  </table>`;
  }

  const groups = new Map();
  for (const item of rows) {
    const folder = folderPath(item);
    const group = groups.get(folder) || [];
    group.push(item);
    groups.set(folder, group);
  }
  return [...groups.entries()].map(([folder, items]) => `<section class="folder-group">
    <div class="folder-heading">
      <span class="folder-name">${escapeHtml(folderLabel(folder))}</span>
      <span class="folder-path mono">${escapeHtml(folder)}</span>
      <span class="folder-count">${items.length} test${items.length === 1 ? '' : 's'}</span>
    </div>
    <table class="table">
      <thead>
        <tr>
          <th>Test</th>
          <th>File</th>
          <th>Worker</th>
          <th>Attempt</th>
          <th>Duration</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${items.map((item) => testRow(item)).join('')}</tbody>
    </table>
  </section>`).join('');
}

function testRow(item) {
  return `<tr data-id="${item.id}">
    <td>
      <div class="mono">${escapeHtml(item.testId)}</div>
      <div class="muted">${escapeHtml(item.testName || '')}</div>
    </td>
    <td class="mono path">${escapeHtml(specPath(item) || '—')}</td>
    <td class="mono">${escapeHtml(item.workerId || '—')}</td>
    <td>${item.attempt}</td>
    <td>${formatDuration(item.durationMs)}</td>
    <td>${badge(item.status)}</td>
  </tr>`;
}

function renderTests() {
  const runItems = records.filter((item) => item.runId === selectedRunId);
  els.subtitle.textContent = runDisplayName(runItems) || selectedRunId;
  const rows = testsForRun();
  const key = `${selectedRunId}:${statusFilter}:${testView}:` + rows.map((item) => `${item.id}:${item.status}:${item.workerId}:${item.durationMs}`).join('|');
  if (key === lastTestsKey && document.getElementById('statusFilter')) return;
  lastTestsKey = key;
  const table = rows.length === 0
    ? '<div class="empty">No tests match this filter.</div>'
    : testRows(rows);
  els.view.innerHTML = `<section class="toolbar">
    <label>
      Status
      <select id="statusFilter">
        <option value="">All</option>
        <option value="STARTED">Started</option>
        <option value="RUNNING">In Progress</option>
        <option value="COMPLETED">Completed</option>
        <option value="FAILED">Failed</option>
      </select>
    </label>
    <label>
      View
      <select id="testView">
        <option value="list">All tests</option>
        <option value="folder">Group by folder</option>
      </select>
    </label>
  </section>${table}`;
  const select = document.getElementById('statusFilter');
  if (select) select.value = statusFilter;
  const viewSelect = document.getElementById('testView');
  if (viewSelect) viewSelect.value = testView;
}

async function renderDetail() {
  const item = records.find((row) => row.id === selectedId);
  if (!item) {
    els.subtitle.textContent = 'Execution';
    els.view.innerHTML = '<div class="empty">Execution not found.</div>';
    return;
  }
  els.subtitle.textContent = `${item.testId} · ${labels[item.status] || item.status}`;
  let logs = Array.isArray(item.logs) ? item.logs : [];
  if ((item.status === 'COMPLETED' || item.status === 'FAILED') && logs.length === 0) {
    try {
      const minio = await fetch(`/executions/${encodeURIComponent(item.runId)}/${encodeURIComponent(item.testId)}/${item.attempt}/minio`);
      if (minio.ok) {
        const payload = await minio.json();
        const minioLogs = payload.execution?.logs;
        if (Array.isArray(minioLogs) && minioLogs.length > 0) logs = minioLogs;
      }
    } catch {
      /* keep postgres logs */
    }
  }
  const key = `${item.id}:${item.status}:${item.updatedAt}:${logs.length}`;
  if (key === lastDetailKey && els.view.querySelector('.detail')) return;
  lastDetailKey = key;
  const jsonHref = `/artifacts/${encodeURIComponent(item.runId)}/${encodeURIComponent(item.testId)}/${item.attempt}/execution.json`;
  const shotHref = `/artifacts/${encodeURIComponent(item.runId)}/${encodeURIComponent(item.testId)}/${item.attempt}/screenshot.png`;
  const shot = item.screenshotObject
    ? `<div class="shot-frame"><img class="shot" alt="execution screenshot" src="${shotHref}?t=${encodeURIComponent(item.updatedAt)}" /></div>`
    : '<div class="shot-empty">No screenshot yet</div>';
  const links = (item.status === 'COMPLETED' || item.status === 'FAILED')
    ? `<div class="links"><a href="${jsonHref}" target="_blank" rel="noreferrer">execution.json</a>${item.screenshotObject ? `<a href="${shotHref}" target="_blank" rel="noreferrer">screenshot.png</a>` : ''}</div>`
    : '';
  els.view.innerHTML = `<div class="detail">
    <section class="card card-log">
      <h2>Execution log</h2>
      <div class="meta-grid">
        <div>Run<strong>${escapeHtml(item.runName || item.runId)}</strong></div>
        <div>File<strong class="mono path">${escapeHtml(specPath(item) || '—')}</strong></div>
        <div>Status<strong>${badge(item.status)}</strong></div>
        <div>Attempt<strong>${item.attempt}</strong></div>
        <div>Duration<strong>${formatDuration(item.durationMs)}</strong></div>
        <div>Worker<strong class="mono">${escapeHtml(item.workerId || '—')}</strong></div>
      </div>
      ${links}
      <pre class="logs">${escapeHtml(logs.map(formatLogLine).join('\n') || (item.error ? String(item.error) : 'Waiting for log events…'))}</pre>
    </section>
    <section class="card card-shot">
      <h2>Screenshot</h2>
      ${shot}
    </section>
  </div>`;
}

async function render() {
  parseHash();
  renderCrumb();
  if (!selectedRunId) {
    lastDetailKey = '';
    renderRuns();
    return;
  }
  if (!selectedId) {
    lastDetailKey = '';
    renderTests();
    return;
  }
  lastTestsKey = '';
  await renderDetail();
}

async function refresh() {
  if (paused) return;
  const response = await fetch('/executions');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  records = data.executions || [];
  await render();
  els.liveDot.className = 'dot on';
}

els.view.addEventListener('click', (event) => {
  const runRow = event.target.closest('[data-run]');
  if (runRow) {
    selectedRunId = runRow.getAttribute('data-run');
    selectedId = null;
    setHash();
    render();
    return;
  }
  const testRow = event.target.closest('[data-id]');
  if (testRow) {
    selectedId = testRow.getAttribute('data-id');
    setHash();
    render();
  }
});

els.view.addEventListener('change', (event) => {
  if (event.target.id === 'statusFilter') statusFilter = event.target.value;
  if (event.target.id === 'testView') testView = event.target.value;
  if (!['statusFilter', 'testView'].includes(event.target.id)) return;
  renderTests();
});

els.crumb.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-nav]');
  if (!nav) return;
  if (nav.getAttribute('data-nav') === 'runs') {
    selectedRunId = null;
    selectedId = null;
  } else {
    selectedId = null;
  }
  setHash();
  render();
});

els.pauseBtn.addEventListener('click', () => {
  paused = !paused;
  els.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  els.liveDot.className = paused ? 'dot off' : 'dot on';
});

window.addEventListener('hashchange', () => {
  render();
});

if (!location.hash) location.hash = '#/runs';

setInterval(() => {
  refresh().catch(() => {
    els.liveDot.className = 'dot off';
  });
}, 1000);
refresh().catch(() => {
  els.liveDot.className = 'dot off';
});
