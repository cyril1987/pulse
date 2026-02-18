const express = require('express');
const router = express.Router();
const db = require('../db');

// List all generic monitors with latest report info
router.get('/', async (req, res) => {
  const monitors = await db.prepare(`
    SELECT gm.*,
      (SELECT COUNT(*) FROM generic_reports gr WHERE gr.monitor_id = gm.id) AS total_reports,
      (SELECT gr.metrics FROM generic_reports gr
       WHERE gr.monitor_id = gm.id ORDER BY gr.reported_at DESC LIMIT 1) AS latest_metrics,
      (SELECT gr.message FROM generic_reports gr
       WHERE gr.monitor_id = gm.id ORDER BY gr.reported_at DESC LIMIT 1) AS latest_message
    FROM generic_monitors gm
    ORDER BY gm.group_name NULLS LAST, gm.created_at DESC
  `).all();

  res.json(monitors.map(formatGenericMonitor));
});

// List distinct group names
router.get('/groups', async (req, res) => {
  const rows = await db.prepare(
    'SELECT DISTINCT group_name FROM generic_monitors WHERE group_name IS NOT NULL ORDER BY group_name'
  ).all();
  res.json(rows.map(r => r.group_name));
});

// Get single generic monitor
router.get('/:id', async (req, res) => {
  const monitor = await db.prepare(`
    SELECT gm.*,
      (SELECT COUNT(*) FROM generic_reports gr WHERE gr.monitor_id = gm.id) AS total_reports,
      (SELECT gr.metrics FROM generic_reports gr
       WHERE gr.monitor_id = gm.id ORDER BY gr.reported_at DESC LIMIT 1) AS latest_metrics,
      (SELECT gr.message FROM generic_reports gr
       WHERE gr.monitor_id = gm.id ORDER BY gr.reported_at DESC LIMIT 1) AS latest_message
    FROM generic_monitors gm
    WHERE gm.id = ?
  `).get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ error: 'Generic monitor not found' });
  }

  res.json(formatGenericMonitor(monitor));
});

// Get paginated reports for a generic monitor
router.get('/:id/reports', async (req, res) => {
  const monitorExists = await db.prepare('SELECT id FROM generic_monitors WHERE id = ?').get(req.params.id);
  if (!monitorExists) {
    return res.status(404).json({ error: 'Generic monitor not found' });
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);

  const reports = await db.prepare(`
    SELECT * FROM generic_reports
    WHERE monitor_id = ?
    ORDER BY reported_at DESC
    LIMIT ? OFFSET ?
  `).all(req.params.id, limit, offset);

  const total = await db.prepare(
    'SELECT COUNT(*) as count FROM generic_reports WHERE monitor_id = ?'
  ).get(req.params.id);

  res.json({
    reports: reports.map(formatReport),
    total: total.count,
    limit,
    offset,
  });
});

// Get latest N reports (for sparklines / quick view)
router.get('/:id/reports/latest', async (req, res) => {
  const monitorExists = await db.prepare('SELECT id FROM generic_monitors WHERE id = ?').get(req.params.id);
  if (!monitorExists) {
    return res.status(404).json({ error: 'Generic monitor not found' });
  }

  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

  const reports = await db.prepare(`
    SELECT * FROM generic_reports
    WHERE monitor_id = ?
    ORDER BY reported_at DESC
    LIMIT ?
  `).all(req.params.id, limit);

  res.json(reports.reverse().map(formatReport));
});

// Delete a generic monitor
router.delete('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM generic_monitors WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Generic monitor not found' });
  }

  await db.prepare('DELETE FROM generic_monitors WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

function formatGenericMonitor(row) {
  let environment = null;
  if (row.environment_info) {
    try { environment = JSON.parse(row.environment_info); } catch { environment = null; }
  }

  let latestMetrics = null;
  if (row.latest_metrics) {
    try { latestMetrics = JSON.parse(row.latest_metrics); } catch { latestMetrics = null; }
  }

  return {
    id: row.id,
    name: row.name,
    group: row.group_name || null,
    currentStatus: row.current_status,
    environment,
    lastReportedAt: row.last_reported_at,
    notifyEmail: row.notify_email,
    totalReports: row.total_reports || 0,
    latestMetrics,
    latestMessage: row.latest_message || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatReport(row) {
  let metrics = null;
  if (row.metrics) {
    try { metrics = JSON.parse(row.metrics); } catch { metrics = null; }
  }

  return {
    id: row.id,
    monitorId: row.monitor_id,
    status: row.status,
    metrics,
    message: row.message,
    reportedAt: row.reported_at,
  };
}

module.exports = router;
