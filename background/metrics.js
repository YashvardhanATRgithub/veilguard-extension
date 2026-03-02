const MAX_RECENT_LATENCIES = 200;

function nowIso() {
  return new Date().toISOString();
}

function emptyCounter() {
  return {
    requests: 0,
    changed: 0,
    replacements: 0,
    blocked: 0,
    errors: 0
  };
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeDuration(value) {
  const n = toFiniteNumber(value, 0);
  if (n < 0) return 0;
  if (n > 120000) return 120000;
  return n;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function createEmptyMetrics() {
  return {
    schemaVersion: 1,
    startedAt: nowIso(),
    updatedAt: nowIso(),
    totals: emptyCounter(),
    byAdapter: {},
    latency: {
      count: 0,
      sum: 0,
      min: 0,
      max: 0,
      avg: 0,
      p95: 0,
      recent: []
    }
  };
}

export function normalizeMetrics(input) {
  if (!input || typeof input !== 'object') return createEmptyMetrics();

  const base = createEmptyMetrics();
  const byAdapter = {};
  if (input.byAdapter && typeof input.byAdapter === 'object') {
    for (const [adapterId, value] of Object.entries(input.byAdapter)) {
      const safeKey = String(adapterId || 'unknown').slice(0, 64);
      byAdapter[safeKey] = {
        requests: toFiniteNumber(value?.requests, 0),
        changed: toFiniteNumber(value?.changed, 0),
        replacements: toFiniteNumber(value?.replacements, 0),
        blocked: toFiniteNumber(value?.blocked, 0),
        errors: toFiniteNumber(value?.errors, 0)
      };
    }
  }

  const recent = Array.isArray(input?.latency?.recent)
    ? input.latency.recent.map((value) => sanitizeDuration(value)).slice(-MAX_RECENT_LATENCIES)
    : [];

  const latencyCount = toFiniteNumber(input?.latency?.count, recent.length);
  const latencySum = toFiniteNumber(input?.latency?.sum, recent.reduce((sum, v) => sum + v, 0));
  const latencyMin = toFiniteNumber(input?.latency?.min, recent.length ? Math.min(...recent) : 0);
  const latencyMax = toFiniteNumber(input?.latency?.max, recent.length ? Math.max(...recent) : 0);
  const latencyAvg = latencyCount > 0 ? latencySum / latencyCount : 0;

  return {
    schemaVersion: 1,
    startedAt: typeof input.startedAt === 'string' ? input.startedAt : base.startedAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : base.updatedAt,
    totals: {
      requests: toFiniteNumber(input?.totals?.requests, 0),
      changed: toFiniteNumber(input?.totals?.changed, 0),
      replacements: toFiniteNumber(input?.totals?.replacements, 0),
      blocked: toFiniteNumber(input?.totals?.blocked, 0),
      errors: toFiniteNumber(input?.totals?.errors, 0)
    },
    byAdapter,
    latency: {
      count: latencyCount,
      sum: latencySum,
      min: latencyMin,
      max: latencyMax,
      avg: latencyAvg,
      p95: percentile(recent, 95),
      recent
    }
  };
}

export function recordTransformMetric(current, event = {}) {
  const metrics = normalizeMetrics(current);
  const adapterId = String(event.adapterId || 'unknown').slice(0, 64);
  const replacements = Math.max(0, toFiniteNumber(event.replacements, 0));
  const durationMs = sanitizeDuration(event.durationMs);
  const changed = !!event.changed;
  const blocked = !!event.blocked;
  const errored = !!event.error;

  metrics.updatedAt = nowIso();
  metrics.totals.requests += 1;
  if (changed) metrics.totals.changed += 1;
  metrics.totals.replacements += replacements;
  if (blocked) metrics.totals.blocked += 1;
  if (errored) metrics.totals.errors += 1;

  if (!metrics.byAdapter[adapterId]) {
    metrics.byAdapter[adapterId] = emptyCounter();
  }

  const bucket = metrics.byAdapter[adapterId];
  bucket.requests += 1;
  if (changed) bucket.changed += 1;
  bucket.replacements += replacements;
  if (blocked) bucket.blocked += 1;
  if (errored) bucket.errors += 1;

  const recent = [...metrics.latency.recent, durationMs].slice(-MAX_RECENT_LATENCIES);
  const count = metrics.latency.count + 1;
  const sum = metrics.latency.sum + durationMs;
  const min = metrics.latency.count === 0 ? durationMs : Math.min(metrics.latency.min, durationMs);
  const max = Math.max(metrics.latency.max, durationMs);

  metrics.latency = {
    count,
    sum,
    min,
    max,
    avg: count > 0 ? sum / count : 0,
    p95: percentile(recent, 95),
    recent
  };

  return metrics;
}
