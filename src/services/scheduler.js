const db = require('../db');
const { checkMonitor } = require('./checker');
const { evaluateAndNotify } = require('./notifier');
const config = require('../config');

let running = false;
let intervalHandle = null;
let lastCleanup = 0;
let lastTickAt = null;
let lastTickDurationMs = null;
let lastTickError = null;

const getDueMonitors = db.prepare(`
  SELECT * FROM monitors
  WHERE is_active = 1
  AND (
    last_checked_at IS NULL
    OR datetime(last_checked_at, '+' || frequency_seconds || ' seconds') <= datetime('now')
  )
`);

const getExpiredDowntime = db.prepare(`
  SELECT * FROM monitors
  WHERE is_active = 0
  AND paused_until IS NOT NULL
  AND paused_until <= datetime('now')
`);

const resumeMonitor = db.prepare(`
  UPDATE monitors SET is_active = 1, paused_until = NULL, updated_at = datetime('now') WHERE id = ?
`);

const deleteOldChecks = db.prepare(
  "DELETE FROM checks WHERE checked_at < datetime('now', '-' || ? || ' days')"
);

function start() {
  if (running) return;
  running = true;
  console.log(`[SCHEDULER] Started (tick every ${config.schedulerIntervalMs}ms)`);
  tick();
  intervalHandle = setInterval(tick, config.schedulerIntervalMs);
}

async function tick() {
  if (!running) return;
  const tickStart = Date.now();

  try {
    // Auto-resume monitors whose scheduled downtime has expired
    const expired = getExpiredDowntime.all();
    for (const m of expired) {
      resumeMonitor.run(m.id);
      console.log(`[SCHEDULER] Auto-resumed ${m.name} — scheduled downtime ended`);
    }

    const dueMonitors = getDueMonitors.all();

    if (dueMonitors.length > 0) {
      console.log(`[SCHEDULER] Checking ${dueMonitors.length} monitor(s)`);
    }

    const CONCURRENCY = 10;
    for (let i = 0; i < dueMonitors.length; i += CONCURRENCY) {
      const batch = dueMonitors.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (monitor) => {
          const result = await checkMonitor(monitor);
          await evaluateAndNotify(monitor, result);
          const icon = result.isSuccess ? 'OK' : 'FAIL';
          console.log(
            `[CHECK] ${icon} ${monitor.name} (${monitor.url}) - ${result.responseTimeMs}ms`
          );
        })
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[SCHEDULER] Unexpected check error:', r.reason);
        }
      }
    }

    maybeCleanup();
    lastTickAt = new Date().toISOString();
    lastTickDurationMs = Date.now() - tickStart;
    lastTickError = null;
  } catch (err) {
    lastTickAt = new Date().toISOString();
    lastTickDurationMs = Date.now() - tickStart;
    lastTickError = err.message;
    console.error('[SCHEDULER] Tick error:', err);
  }
}

function maybeCleanup() {
  if (Date.now() - lastCleanup < 3600000) return;
  lastCleanup = Date.now();
  const result = deleteOldChecks.run(config.checkRetentionDays);
  if (result.changes > 0) {
    console.log(`[SCHEDULER] Cleaned up ${result.changes} old check records`);
  }
}

function stop() {
  running = false;
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  console.log('[SCHEDULER] Stopped');
}

function getStatus() {
  return {
    running,
    intervalMs: config.schedulerIntervalMs,
    lastTickAt,
    lastTickDurationMs,
    lastTickError,
  };
}

module.exports = { start, stop, getStatus };
