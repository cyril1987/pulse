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

  // Collect existing URLs and names for duplicate checking
  const existingUrls = new Set(
    db.prepare('SELECT url FROM monitors').all().map(r => r.url)
  );
  const existingNames = new Set(
    db.prepare('SELECT name FROM monitors').all().map(r => r.name)
  );
  // Track URLs and names within the current batch too
  const batchUrls = new Set();
  const batchNames = new Set();

  for (let i = 0; i < monitors.length; i++) {
    const errors = validateMonitorData(monitors[i]);
    const d = monitors[i];

    // Duplicate URL check (against DB and current batch)
    if (d.url) {
      if (existingUrls.has(d.url)) {
        errors.push('A monitor with this URL already exists');
      } else if (batchUrls.has(d.url)) {
        errors.push('Duplicate URL within this upload batch');
      }
    }

    // Duplicate name check (against DB and current batch)
    const monitorName = d.name || (d.url ? (() => { try { return new URL(d.url).hostname; } catch { return ''; } })() : '');
    if (monitorName) {
      if (existingNames.has(monitorName)) {
        errors.push('A monitor with this name already exists');
      } else if (batchNames.has(monitorName)) {
        errors.push('Duplicate name within this upload batch');
      }
    }

    if (errors.length > 0) {
      results.failed.push({ rowIndex: i, errors });
    } else {
      batchUrls.add(d.url);
      if (monitorName) batchNames.add(monitorName);
      validMonitors.push({ index: i, data: d });
    }
  }

  if (validMonitors.length > 0) {
    const insertStmt = db.prepare(`
      INSERT INTO monitors (url, name, frequency_seconds, expected_status, timeout_ms, notify_email, custom_headers, group_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((items) => {
      for (const item of items) {
        const d = item.data;
        const headersJson = Array.isArray(d.customHeaders) && d.customHeaders.length > 0
          ? JSON.stringify(d.customHeaders)
          : null;
        const groupName = d.group && typeof d.group === 'string' && d.group.trim() ? d.group.trim() : null;
        try {
          const result = insertStmt.run(
            d.url,
            d.name || new URL(d.url).hostname,
            d.frequency || 300,
            d.expectedStatus || 200,
            d.timeoutMs || 10000,
            d.notifyEmail,
            headersJson,
            groupName
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
