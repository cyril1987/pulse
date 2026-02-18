const db = require('../db');
const { checkMonitor } = require('./checker');
const { evaluateAndNotify } = require('./notifier');
const taskScheduler = require('./taskScheduler');
const sanityCheckScheduler = require('./sanityCheckScheduler');
const { checkDueSoonTasks, checkOverdueTasks } = require('./taskNotifier');
const config = require('../config');

let running = false;
let intervalHandle = null;
let lastCleanup = 0;
let lastTickAt = null;
let lastTickDurationMs = null;
let lastTickError = null;

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
    const expired = await db.prepare(`
      SELECT * FROM monitors
      WHERE is_active = 0
      AND paused_until IS NOT NULL
      AND paused_until <= datetime('now')
    `).all();

    for (const m of expired) {
      await db.prepare(`
        UPDATE monitors SET is_active = 1, paused_until = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(m.id);
      console.log(`[SCHEDULER] Auto-resumed ${m.name} — scheduled downtime ended`);
    }

    const dueMonitors = await db.prepare(`
      SELECT * FROM monitors
      WHERE is_active = 1
      AND (
        last_checked_at IS NULL
        OR datetime(last_checked_at, '+' || frequency_seconds || ' seconds') <= datetime('now')
      )
    `).all();

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

    await maybeCleanup();

    // Process recurring task instances
    try {
      await taskScheduler.tick();
    } catch (err) {
      console.error('[SCHEDULER] Task scheduler error:', err);
    }

    // Check for task deadline notifications
    try {
      await checkDueSoonTasks();
      await checkOverdueTasks();
    } catch (err) {
      console.error('[SCHEDULER] Task notification error:', err);
    }

    // Run due sanity checks (trigger clients, poll results, evaluate)
    try {
      await sanityCheckScheduler.tick();
    } catch (err) {
      console.error('[SCHEDULER] Sanity check error:', err);
    }

    // Sync Jira statuses (every 5 minutes, not every tick)
    if (!tick._lastJiraSync || Date.now() - tick._lastJiraSync > 300000) {
      try {
        const { syncAllJiraTasks } = require('./jiraService');
        await syncAllJiraTasks();
        tick._lastJiraSync = Date.now();
      } catch (err) {
        console.error('[SCHEDULER] Jira sync error:', err);
      }
    }

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

async function maybeCleanup() {
  if (Date.now() - lastCleanup < 3600000) return;
  lastCleanup = Date.now();
  const result = await db.prepare(
    "DELETE FROM checks WHERE checked_at < datetime('now', '-' || ? || ' days')"
  ).run(config.checkRetentionDays);
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
