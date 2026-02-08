const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateMonitorData } = require('../middleware/validate');

router.post('/monitors/bulk', express.json({ limit: '1mb' }), (req, res) => {
  const { monitors } = req.body;

  if (!Array.isArray(monitors)) {
    return res.status(400).json({ error: 'Request body must contain a "monitors" array' });
  }
  if (monitors.length === 0) {
    return res.status(400).json({ error: 'monitors array must not be empty' });
  }
  if (monitors.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 monitors per bulk import' });
  }

  const results = { created: [], failed: [] };
  const validMonitors = [];

  for (let i = 0; i < monitors.length; i++) {
    const errors = validateMonitorData(monitors[i]);
    if (errors.length > 0) {
      results.failed.push({ rowIndex: i, errors });
    } else {
      validMonitors.push({ index: i, data: monitors[i] });
    }
  }

  if (validMonitors.length > 0) {
    const insertStmt = db.prepare(`
      INSERT INTO monitors (url, name, frequency_seconds, expected_status, timeout_ms, notify_email, custom_headers)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((items) => {
      for (const item of items) {
        const d = item.data;
        const headersJson = Array.isArray(d.customHeaders) && d.customHeaders.length > 0
          ? JSON.stringify(d.customHeaders)
          : null;
        try {
          const result = insertStmt.run(
            d.url,
            d.name || new URL(d.url).hostname,
            d.frequency || 300,
            d.expectedStatus || 200,
            d.timeoutMs || 10000,
            d.notifyEmail,
            headersJson
          );
          const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
          results.created.push({ rowIndex: item.index, monitorId: monitor.id, name: monitor.name });
        } catch (err) {
          results.failed.push({ rowIndex: item.index, errors: [err.message] });
        }
      }
    });

    insertAll(validMonitors);
  }

  res.json({
    ...results,
    summary: {
      total: monitors.length,
      created: results.created.length,
      failed: results.failed.length,
    },
  });
});

module.exports = router;
