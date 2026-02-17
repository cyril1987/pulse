// Vercel Cron Job: Check due monitors (runs every 1 minute)
const { dbReady } = require('../../src/db');
const db = require('../../src/db');
const config = require('../../src/config');

module.exports = async (req, res) => {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (config.cronSecret && authHeader !== `Bearer ${config.cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await dbReady;

    const { checkMonitor } = require('../../src/services/checker');
    const { evaluateAndNotify } = require('../../src/services/notifier');

    // Auto-resume monitors whose scheduled downtime has expired
    const expired = await db.prepare(`
      SELECT * FROM monitors
      WHERE is_active = 0
      AND paused_until IS NOT NULL
      AND paused_until <= datetime('now')
    `).all();

    for (const m of expired) {
      await db.prepare(
        "UPDATE monitors SET is_active = 1, paused_until = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(m.id);
      console.log(`[CRON] Auto-resumed ${m.name} — scheduled downtime ended`);
    }

    // Get monitors due for checking
    const dueMonitors = await db.prepare(`
      SELECT * FROM monitors
      WHERE is_active = 1
      AND (
        last_checked_at IS NULL
        OR datetime(last_checked_at, '+' || frequency_seconds || ' seconds') <= datetime('now')
      )
    `).all();

    if (dueMonitors.length === 0) {
      return res.json({ ok: true, checked: 0, resumed: expired.length });
    }

    console.log(`[CRON] Checking ${dueMonitors.length} monitor(s)`);

    let checkedCount = 0;
    const CONCURRENCY = 10;
    for (let i = 0; i < dueMonitors.length; i += CONCURRENCY) {
      const batch = dueMonitors.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (monitor) => {
          const result = await checkMonitor(monitor);
          await evaluateAndNotify(monitor, result);
          checkedCount++;
          const icon = result.isSuccess ? 'OK' : 'FAIL';
          console.log(`[CHECK] ${icon} ${monitor.name} (${monitor.url}) - ${result.responseTimeMs}ms`);
        })
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[CRON] Unexpected check error:', r.reason);
        }
      }
    }

    res.json({ ok: true, checked: checkedCount, resumed: expired.length });
  } catch (err) {
    console.error('[CRON] Monitor check error:', err);
    res.status(500).json({ error: err.message });
  }
};
