const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');

// Public report ingestion endpoint.
// Clients POST here to auto-register monitors and push status/metrics.
// Protected by optional API key (REPORT_API_KEY env var).
router.post('/', async (req, res) => {
  // API key check (if configured)
  const apiKey = config.reportApiKey;
  if (apiKey) {
    const provided =
      req.headers['x-api-key'] ||
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (provided !== apiKey) {
      return res.status(401).json({ error: 'Invalid or missing API key' });
    }
  }

  const { name, group, status, message, metrics, environment } = req.body;

  // Validate required fields
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required (string)' });
  }

  const monitorName = name.trim();
  if (monitorName.length > 200) {
    return res.status(400).json({ error: 'name must be 200 characters or fewer' });
  }

  const validStatuses = ['up', 'down', 'degraded', 'unknown'];
  const reportStatus = validStatuses.includes(status) ? status : 'unknown';

  const groupName = group && typeof group === 'string' && group.trim() ? group.trim() : null;
  const reportMessage = message && typeof message === 'string' ? message.substring(0, 1000) : null;

  // Serialize metrics/environment as JSON
  let metricsJson = null;
  if (metrics && typeof metrics === 'object') {
    metricsJson = JSON.stringify(metrics);
    if (metricsJson.length > 10000) {
      return res.status(400).json({ error: 'metrics payload too large (max 10KB)' });
    }
  }

  let envJson = null;
  if (environment && typeof environment === 'object') {
    envJson = JSON.stringify(environment);
    if (envJson.length > 10000) {
      return res.status(400).json({ error: 'environment payload too large (max 10KB)' });
    }
  }

  try {
    // Upsert: auto-create the monitor if it doesn't exist
    let monitor = await db.prepare('SELECT * FROM generic_monitors WHERE name = ?').get(monitorName);

    if (!monitor) {
      // Auto-register
      const result = await db.prepare(`
        INSERT INTO generic_monitors (name, group_name, current_status, environment_info, last_reported_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(monitorName, groupName, reportStatus, envJson);
      monitor = await db.prepare('SELECT * FROM generic_monitors WHERE id = ?').get(result.lastInsertRowid);
    } else {
      // Update existing monitor
      const updates = [`current_status = ?`, `last_reported_at = datetime('now')`, `updated_at = datetime('now')`];
      const params = [reportStatus];

      if (groupName !== null) {
        updates.push('group_name = ?');
        params.push(groupName);
      }

      // Update environment info if provided (one-time or overwrite)
      if (envJson) {
        updates.push('environment_info = ?');
        params.push(envJson);
      }

      params.push(monitor.id);
      await db.prepare(`UPDATE generic_monitors SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      monitor = await db.prepare('SELECT * FROM generic_monitors WHERE id = ?').get(monitor.id);
    }

    // Insert the report
    await db.prepare(`
      INSERT INTO generic_reports (monitor_id, status, metrics, message)
      VALUES (?, ?, ?, ?)
    `).run(monitor.id, reportStatus, metricsJson, reportMessage);

    res.status(200).json({
      ok: true,
      monitorId: monitor.id,
      name: monitor.name,
      status: reportStatus,
    });
  } catch (err) {
    console.error('[REPORT] Error processing report:', err);
    res.status(500).json({ error: 'Failed to process report' });
  }
});

module.exports = router;
