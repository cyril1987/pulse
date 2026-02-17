const express = require('express');
const router = express.Router();
const db = require('../db');

// Get paginated check history for a monitor
router.get('/monitors/:id/checks', async (req, res) => {
  const monitorExists = await db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitorExists) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  const checks = await db.prepare(`
    SELECT * FROM checks
    WHERE monitor_id = ?
    ORDER BY checked_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, limit, offset);

  const total = await db.prepare(
    'SELECT COUNT(*) as count FROM checks WHERE monitor_id = ?'
  ).get(req.params.id);

  res.json({
    checks: checks.map(formatCheck),
    total: total.count,
    limit,
    offset,
  });
});

// Get latest N checks (for sparklines)
router.get('/monitors/:id/checks/latest', async (req, res) => {
  const monitorExists = await db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitorExists) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

  const checks = await db.prepare(`
    SELECT * FROM checks
    WHERE monitor_id = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `).all(req.params.id, limit);

  res.json(checks.reverse().map(formatCheck));
});

// Get aggregated stats for a monitor
router.get('/monitors/:id/stats', async (req, res) => {
  const monitorExists = await db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitorExists) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const windows = [
    { label: '1h', sql: '-1 hour' },
    { label: '24h', sql: '-1 day' },
    { label: '7d', sql: '-7 days' },
    { label: '30d', sql: '-30 days' },
  ];

  const stats = {};
  for (const w of windows) {
    const row = await db.prepare(`
      SELECT
        COUNT(*) as total_checks,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) as successful_checks,
        ROUND(
          CAST(SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS REAL) /
          NULLIF(COUNT(*), 0) * 100, 2
        ) as uptime_percent,
        ROUND(AVG(CASE WHEN is_success = 1 THEN response_time_ms END), 0) as avg_response_ms,
        MIN(CASE WHEN is_success = 1 THEN response_time_ms END) as min_response_ms,
        MAX(CASE WHEN is_success = 1 THEN response_time_ms END) as max_response_ms
      FROM checks
      WHERE monitor_id = ? AND checked_at > datetime('now', ?)
    `).get(req.params.id, w.sql);

    stats[w.label] = {
      totalChecks: row.total_checks,
      successfulChecks: row.successful_checks,
      uptimePercent: row.uptime_percent,
      avgResponseMs: row.avg_response_ms,
      minResponseMs: row.min_response_ms,
      maxResponseMs: row.max_response_ms,
    };
  }

  res.json(stats);
});

function formatCheck(row) {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    statusCode: row.status_code,
    responseTimeMs: row.response_time_ms,
    isSuccess: row.is_success === 1,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
  };
}

module.exports = router;
