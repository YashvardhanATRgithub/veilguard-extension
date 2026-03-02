import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyMetrics, normalizeMetrics, recordTransformMetric } from '../background/metrics.js';

test('createEmptyMetrics initializes zeroed telemetry state', () => {
  const metrics = createEmptyMetrics();
  assert.equal(metrics.schemaVersion, 1);
  assert.equal(metrics.totals.requests, 0);
  assert.equal(metrics.totals.changed, 0);
  assert.equal(metrics.totals.replacements, 0);
  assert.equal(metrics.latency.count, 0);
});

test('recordTransformMetric aggregates totals and adapter buckets', () => {
  let metrics = createEmptyMetrics();
  metrics = recordTransformMetric(metrics, {
    adapterId: 'chatgpt',
    replacements: 3,
    changed: true,
    blocked: false,
    error: null,
    durationMs: 12
  });

  metrics = recordTransformMetric(metrics, {
    adapterId: 'chatgpt',
    replacements: 0,
    changed: false,
    blocked: true,
    error: 'transform_error',
    durationMs: 20
  });

  assert.equal(metrics.totals.requests, 2);
  assert.equal(metrics.totals.changed, 1);
  assert.equal(metrics.totals.replacements, 3);
  assert.equal(metrics.totals.blocked, 1);
  assert.equal(metrics.totals.errors, 1);

  assert.equal(metrics.byAdapter.chatgpt.requests, 2);
  assert.equal(metrics.byAdapter.chatgpt.changed, 1);
  assert.equal(metrics.byAdapter.chatgpt.replacements, 3);
  assert.equal(metrics.byAdapter.chatgpt.blocked, 1);
  assert.equal(metrics.byAdapter.chatgpt.errors, 1);

  assert.equal(metrics.latency.count, 2);
  assert.equal(metrics.latency.avg, 16);
  assert.equal(metrics.latency.p95, 20);
});

test('normalizeMetrics sanitizes malformed inputs', () => {
  const metrics = normalizeMetrics({
    byAdapter: {
      chatgpt: {
        requests: '10',
        changed: '3',
        replacements: '20',
        blocked: '1',
        errors: '0'
      }
    },
    latency: {
      count: '2',
      sum: '30',
      min: '-1',
      max: '50',
      recent: ['10', '20', 'bad']
    }
  });

  assert.equal(metrics.byAdapter.chatgpt.requests, 10);
  assert.equal(metrics.byAdapter.chatgpt.changed, 3);
  assert.equal(metrics.latency.count, 2);
  assert.equal(metrics.latency.sum, 30);
  assert.equal(metrics.latency.p95 >= 0, true);
});
