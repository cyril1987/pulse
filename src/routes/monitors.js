const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateMonitor } = require('../middleware/validate');
const { checkMonitor } = require('../services/checker');
const { evaluateAndNotify } = require('../services/notifier');

// List all monitors with 24h stats (shared across all users)
router.get('/', (req, res) => {
  const monitors = db.prepare(`
    SELECT m.*,
      (SELECT ROUND(
        CAST(SUM(CASE WHEN c.is_success = 1 THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(COUNT(*), 0) * 100, 1)
       FROM checks c
       WHERE c.monitor_id = m.id
         AND c.checked_at > datetime('now', '-1 day')
      ) AS uptime_percent_24h,
      (SELECT ROUND(AVG(c.response_time_ms), 0)
       FROM checks c
       WHERE c.monitor_id = m.id
         AND c.is_success = 1
         AND c.checked_at > datetime('now', '-1 day')
      ) AS avg_response_ms_24h
    FROM monitors m
    ORDER BY m.group_name NULLS LAST, m.created_at DESC
  `).all();

  res.json(monitors.map(formatMonitor));
});

// List distinct group names (must come before /:id)
router.get('/groups', (req, res) => {
  const rows = db.prepare(
    'SELECT DISTINCT group_name FROM monitors WHERE group_name IS NOT NULL ORDER BY group_name'
  ).all();
  res.json(rows.map(r => r.group_name));
});

// Get single monitor
router.get('/:id', (req, res) => {
  const monitor = db.prepare(`
    SELECT m.*,
      (SELECT ROUND(
        CAST(SUM(CASE WHEN c.is_success = 1 THEN 1 ELSE 0 END) AS REAL) /
        NULLIF(COUNT(*), 0) * 100, 1)
       FROM checks c
       WHERE c.monitor_id = m.id
         AND c.checked_at > datetime('now', '-1 day')
      ) AS uptime_percent_24h,
      (SELECT ROUND(AVG(c.response_time_ms), 0)
       FROM checks c
       WHERE c.monitor_id = m.id
         AND c.is_success = 1
         AND c.checked_at > datetime('now', '-1 day')
      ) AS avg_response_ms_24h
    FROM monitors m
    WHERE m.id = ?
  `).get(req.params.id);

  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  res.json(formatMonitor(monitor));
});

// Create a new monitor
router.post('/', validateMonitor, (req, res) => {
  const { url, name, frequency, expectedStatus, timeoutMs, notifyEmail, customHeaders, group } = req.body;

  // Duplicate URL check
  const existingUrl = db.prepare('SELECT id FROM monitors WHERE url = ?').get(url);
  if (existingUrl) {
    return res.status(400).json({ errors: ['A monitor with this URL already exists'] });
  }

  // Duplicate name check (only if name is provided)
  const monitorName = name || new URL(url).hostname;
  const existingName = db.prepare('SELECT id FROM monitors WHERE name = ?').get(monitorName);
  if (existingName) {
    return res.status(400).json({ errors: ['A monitor with this name already exists'] });
  }

  const headersJson = Array.isArray(customHeaders) && customHeaders.length > 0
    ? JSON.stringify(customHeaders)
    : null;
  const groupName = group && typeof group === 'string' && group.trim() ? group.trim() : null;

  const result = db.prepare(`
    INSERT INTO monitors (url, name, frequency_seconds, expected_status, timeout_ms, notify_email, custom_headers, group_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    url,
    monitorName,
    frequency || 300,
    expectedStatus || 200,
    timeoutMs || 10000,
    notifyEmail,
    headersJson,
    groupName
  );

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(formatMonitor(monitor));
});

// Update a monitor
router.put('/:id', validateMonitor, (req, res) => {
  const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const { url, name, frequency, expectedStatus, timeoutMs, notifyEmail, customHeaders, group } = req.body;

  // Duplicate URL check (exclude current monitor)
  const existingUrl = db.prepare('SELECT id FROM monitors WHERE url = ? AND id != ?').get(url, req.params.id);
  if (existingUrl) {
    return res.status(400).json({ errors: ['A monitor with this URL already exists'] });
  }

  // Duplicate name check (exclude current monitor)
  const monitorName = name || new URL(url).hostname;
  const existingName = db.prepare('SELECT id FROM monitors WHERE name = ? AND id != ?').get(monitorName, req.params.id);
  if (existingName) {
    return res.status(400).json({ errors: ['A monitor with this name already exists'] });
  }

  const headersJson = Array.isArray(customHeaders) && customHeaders.length > 0
    ? JSON.stringify(customHeaders)
    : null;
  const groupName = group && typeof group === 'string' && group.trim() ? group.trim() : null;

  db.prepare(`
    UPDATE monitors
    SET url = ?, name = ?, frequency_seconds = ?, expected_status = ?,
        timeout_ms = ?, notify_email = ?, custom_headers = ?, group_name = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    url,
    monitorName,
    frequency || 300,
    expectedStatus || 200,
    timeoutMs || 10000,
    notifyEmail,
    headersJson,
    groupName,
    req.params.id
  );

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  res.json(formatMonitor(monitor));
});

// Delete a monitor
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  db.prepare('DELETE FROM monitors WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// Pause a monitor
router.post('/:id/pause', (req, res) => {
  const result = db.prepare(
    "UPDATE monitors SET is_active = 0, paused_until = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  res.json(formatMonitor(monitor));
});

// Resume a monitor
router.post('/:id/resume', (req, res) => {
  const result = db.prepare(
    "UPDATE monitors SET is_active = 1, paused_until = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(req.params.id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  res.json(formatMonitor(monitor));
});

// Register scheduled downtime with duration
router.post('/:id/downtime', (req, res) => {
  const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  const { duration } = req.body;
  const validDurations = [900, 1800, 3600, 7200, 14400, 28800, 86400, 0];

  if (duration === undefined || !validDurations.includes(duration)) {
    return res.status(400).json({
      error: 'Invalid duration. Valid options: 900 (15m), 1800 (30m), 3600 (1h), 7200 (2h), 14400 (4h), 28800 (8h), 86400 (24h), 0 (indefinite)'
    });
  }

  if (duration === 0) {
    db.prepare(
      "UPDATE monitors SET is_active = 0, paused_until = NULL, updated_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);
  } else {
    db.prepare(
      "UPDATE monitors SET is_active = 0, paused_until = datetime('now', '+' || ? || ' seconds'), updated_at = datetime('now') WHERE id = ?"
    ).run(duration, req.params.id);
  }

  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  res.json(formatMonitor(monitor));
});

// Instant check — run a check immediately without waiting for the scheduler
router.post('/:id/check', async (req, res) => {
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
  if (!monitor) {
    return res.status(404).json({ error: 'Monitor not found' });
  }

  try {
    const result = await checkMonitor(monitor);
    await evaluateAndNotify(monitor, result);

    const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id);
    res.json({
      monitor: formatMonitor(updated),
      check: {
        statusCode: result.statusCode,
        responseTimeMs: result.responseTimeMs,
        isSuccess: result.isSuccess,
        errorMessage: result.errorMessage,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Check failed: ' + err.message });
  }
});

function formatMonitor(row) {
  let customHeaders = null;
  if (row.custom_headers) {
    try {
      const parsed = JSON.parse(row.custom_headers);
      customHeaders = parsed.map(h => ({
        key: h.key,
        value: maskValue(h.value),
      }));
    } catch {
      customHeaders = null;
    }
  }

  return {
    id: row.id,
    url: row.url,
    name: row.name,
    frequencySeconds: row.frequency_seconds,
    expectedStatus: row.expected_status,
    timeoutMs: row.timeout_ms,
    notifyEmail: row.notify_email,
    isActive: row.is_active === 1,
    currentStatus: row.current_status,
    lastCheckedAt: row.last_checked_at,
    lastStatusChangeAt: row.last_status_change_at,
    pausedUntil: row.paused_until || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    uptimePercent24h: row.uptime_percent_24h ?? null,
    avgResponseMs24h: row.avg_response_ms_24h ?? null,
    customHeaders,
    group: row.group_name || null,
  };
}

function maskValue(value) {
  if (!value || value.length <= 4) return '****';
  return value.slice(0, 4) + '****';
}

module.exports = router;
