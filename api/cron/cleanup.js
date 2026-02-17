// Vercel Cron Job: Clean up old check records (runs every hour)
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

    const result = await db.prepare(
      "DELETE FROM checks WHERE checked_at < datetime('now', '-' || ? || ' days')"
    ).run(config.checkRetentionDays);

    const { checkDueSoonTasks, checkOverdueTasks } = require('../../src/services/taskNotifier');
    await checkDueSoonTasks();
    await checkOverdueTasks();

    console.log(`[CRON] Cleanup: removed ${result.changes} old check records`);
    res.json({ ok: true, deletedChecks: result.changes });
  } catch (err) {
    console.error('[CRON] Cleanup error:', err);
    res.status(500).json({ error: err.message });
  }
};
