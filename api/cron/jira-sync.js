// Vercel Cron Job: Sync Jira-linked tasks (runs every 5 minutes)
const { dbReady } = require('../../src/db');
const config = require('../../src/config');

module.exports = async (req, res) => {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (config.cronSecret && authHeader !== `Bearer ${config.cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await dbReady;

    const { syncAllJiraTasks } = require('../../src/services/jiraService');
    await syncAllJiraTasks();

    res.json({ ok: true });
  } catch (err) {
    console.error('[CRON] Jira sync error:', err);
    res.status(500).json({ error: err.message });
  }
};
