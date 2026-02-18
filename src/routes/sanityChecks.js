const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateSanityCheck } = require('../middleware/validateSanityCheck');
const { executeCheckNow } = require('../services/sanityCheckScheduler');

/** Validate a client URL to prevent SSRF against private/internal networks */
function validateClientUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return 'Invalid URL format';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'URL must use http or https';
  }
  const host = parsed.hostname.toLowerCase();
  // Block localhost and loopback
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
    return 'URL must not point to localhost';
  }
  // Block private IPv4 ranges
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    return 'URL must not point to a private IP range';
  }
  // Block 169.254.x.x (link-local / cloud metadata)
  if (/^169\.254\./.test(host)) {
    return 'URL must not point to a link-local address';
  }
  // Block 0.0.0.0
  if (host === '0.0.0.0') {
    return 'URL must not point to 0.0.0.0';
  }
  return null; // valid
}

function formatMonitor(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    clientUrl: row.client_url,
    checkType: row.check_type,
    expectedMin: row.expected_min,
    expectedMax: row.expected_max,
    severity: row.severity,
    frequencySeconds: row.frequency_seconds,
    isActive: row.is_active === 1,
    groupName: row.group_name,
    notifyEmail: row.notify_email,
    currentStatus: row.current_status,
    lastValue: row.last_value,
    lastCheckedAt: row.last_checked_at,
    lastStatusChangeAt: row.last_status_change_at,
    query: row.query,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatResult(row) {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    code: row.code,
    status: row.status,
    actualValue: row.actual_value,
    previousValue: row.previous_value,
    valueChanged: row.value_changed === 1,
    executionTimeMs: row.execution_time_ms,
    errorMessage: row.error_message,
    checkedAt: row.checked_at,
  };
}

// GET /api/sanity-checks — List all monitors with 24h stats
router.get('/', async (req, res) => {
  try {
    const monitors = await db.prepare(`
      SELECT scm.*,
        (SELECT COUNT(*) FROM sanity_check_results scr WHERE scr.monitor_id = scm.id AND scr.checked_at >= datetime('now', '-24 hours')) as checks_24h,
        (SELECT COUNT(*) FROM sanity_check_results scr WHERE scr.monitor_id = scm.id AND scr.checked_at >= datetime('now', '-24 hours') AND scr.status = 'pass') as pass_24h,
        (SELECT AVG(scr.execution_time_ms) FROM sanity_check_results scr WHERE scr.monitor_id = scm.id AND scr.checked_at >= datetime('now', '-24 hours')) as avg_exec_24h
      FROM sanity_check_monitors scm
      ORDER BY scm.group_name, scm.name
    `).all();

    res.json(monitors.map(m => ({
      ...formatMonitor(m),
      stats24h: {
        totalChecks: m.checks_24h || 0,
        passCount: m.pass_24h || 0,
        passRate: m.checks_24h > 0 ? ((m.pass_24h || 0) / m.checks_24h * 100).toFixed(1) : null,
        avgExecutionTimeMs: m.avg_exec_24h ? Math.round(m.avg_exec_24h) : null,
      }
    })));
  } catch (err) {
    console.error('Error listing sanity check monitors:', err);
    res.status(500).json({ error: 'Failed to list sanity check monitors' });
  }
});

// GET /api/sanity-checks/groups — Distinct group names
router.get('/groups', async (req, res) => {
  try {
    const groups = await db.prepare(`
      SELECT DISTINCT group_name FROM sanity_check_monitors
      WHERE group_name IS NOT NULL AND group_name != ''
      ORDER BY group_name
    `).all();
    res.json(groups.map(g => g.group_name));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get groups' });
  }
});

// GET /api/sanity-checks/discover — Fetch available checks from a client
router.get('/discover', async (req, res) => {
  try {
    const clientUrl = (req.query.clientUrl || '').replace(/\/+$/, '');
    if (!clientUrl) {
      return res.status(400).json({ error: 'clientUrl query parameter is required' });
    }
    const ssrfError = validateClientUrl(clientUrl);
    if (ssrfError) {
      return res.status(400).json({ error: ssrfError });
    }

    const response = await fetch(`${clientUrl}/api/checks`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Client returned HTTP ${response.status}` });
    }

    const checks = await response.json();
    res.json(checks);
  } catch (err) {
    res.status(502).json({ error: `Failed to reach client: ${err.message}` });
  }
});

// POST /api/sanity-checks/discover-all — Discover and auto-create monitors for all checks from a client
router.post('/discover-all', async (req, res) => {
  try {
    const clientUrl = (req.body.clientUrl || '').replace(/\/+$/, '');
    if (!clientUrl) {
      return res.status(400).json({ error: 'clientUrl is required' });
    }
    const ssrfError = validateClientUrl(clientUrl);
    if (ssrfError) {
      return res.status(400).json({ error: ssrfError });
    }

    // Fetch all checks from the pulse-client
    const response = await fetch(`${clientUrl}/api/checks`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `Client returned HTTP ${response.status}` });
    }

    const checks = await response.json();
    const activeChecks = checks.filter(c => c.isActive !== false);

    let created = 0, skipped = 0;
    const results = [];

    for (const check of activeChecks) {
      // Skip if monitor already exists for this (code, client_url)
      const existing = await db.prepare(
        'SELECT id FROM sanity_check_monitors WHERE code = ? AND client_url = ?'
      ).get(check.code, clientUrl);

      if (existing) {
        // Update the query if it wasn't stored before
        if (check.query) {
          await db.prepare('UPDATE sanity_check_monitors SET query = ? WHERE id = ?').run(check.query, existing.id);
        }
        skipped++;
        results.push({ code: check.code, status: 'skipped', reason: 'already exists' });
        continue;
      }

      await db.prepare(`
        INSERT INTO sanity_check_monitors (code, name, client_url, check_type, expected_min, expected_max, severity, frequency_seconds, group_name, notify_email, query, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        check.code,
        check.name || check.code,
        clientUrl,
        check.checkType || 'custom_threshold',
        null,
        null,
        'medium',
        300,
        check.groupName || '',
        '',
        check.query || null,
        req.user.id
      );

      created++;
      results.push({ code: check.code, status: 'created' });
    }

    res.json({ created, skipped, total: activeChecks.length, results });
  } catch (err) {
    console.error('Error in discover-all:', err);
    res.status(502).json({ error: `Failed to reach client: ${err.message}` });
  }
});

// GET /api/sanity-checks/:id — Single monitor with stats
router.get('/:id', async (req, res) => {
  try {
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    const stats = {};
    for (const [label, interval] of [['1h', '-1 hours'], ['24h', '-24 hours'], ['7d', '-7 days'], ['30d', '-30 days']]) {
      const rows = await db.prepare(`
        SELECT status, COUNT(*) as cnt, AVG(execution_time_ms) as avg_exec
        FROM sanity_check_results
        WHERE monitor_id = ? AND checked_at >= datetime('now', ?)
        GROUP BY status
      `).all(monitor.id, interval);

      let total = 0, passCount = 0, failCount = 0, errorCount = 0, totalExec = 0, execCount = 0;
      for (const r of rows) {
        total += r.cnt;
        if (r.status === 'pass') passCount = r.cnt;
        if (r.status === 'fail') failCount = r.cnt;
        if (r.status === 'error') errorCount = r.cnt;
        if (r.avg_exec) { totalExec += r.avg_exec * r.cnt; execCount += r.cnt; }
      }

      stats[label] = {
        totalChecks: total,
        passCount, failCount, errorCount,
        passRate: total > 0 ? (passCount / total * 100).toFixed(1) : null,
        avgExecutionTimeMs: execCount > 0 ? Math.round(totalExec / execCount) : null,
      };
    }

    // Count value changes
    const valueChanges = await db.prepare(`
      SELECT COUNT(*) as cnt FROM sanity_check_results
      WHERE monitor_id = ? AND value_changed = 1
    `).get(monitor.id);

    res.json({
      ...formatMonitor(monitor),
      stats,
      valueChanges: valueChanges.cnt,
    });
  } catch (err) {
    console.error('Error getting sanity check monitor:', err);
    res.status(500).json({ error: 'Failed to get monitor' });
  }
});

// POST /api/sanity-checks — Create monitor
router.post('/', validateSanityCheck, async (req, res) => {
  try {
    const { code, name, clientUrl, checkType, expectedMin, expectedMax, severity, frequencySeconds, groupName, notifyEmail } = req.body;

    // Check for duplicate (code, client_url)
    const existing = await db.prepare(
      'SELECT id FROM sanity_check_monitors WHERE code = ? AND client_url = ?'
    ).get(code.trim(), clientUrl.trim());
    if (existing) {
      return res.status(409).json({ error: `Monitor for code "${code}" on this client already exists` });
    }

    const result = await db.prepare(`
      INSERT INTO sanity_check_monitors (code, name, client_url, check_type, expected_min, expected_max, severity, frequency_seconds, group_name, notify_email, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code.trim(),
      name.trim(),
      clientUrl.trim(),
      checkType || 'count_zero',
      expectedMin !== undefined ? expectedMin : null,
      expectedMax !== undefined ? expectedMax : null,
      severity || 'medium',
      frequencySeconds || 300,
      groupName || '',
      notifyEmail || '',
      req.user.id
    );

    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(formatMonitor(monitor));
  } catch (err) {
    console.error('Error creating sanity check monitor:', err);
    res.status(500).json({ error: 'Failed to create monitor' });
  }
});

// PUT /api/sanity-checks/:id — Update monitor
router.put('/:id', validateSanityCheck, async (req, res) => {
  try {
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    const { name, clientUrl, checkType, expectedMin, expectedMax, severity, frequencySeconds, groupName, notifyEmail } = req.body;

    // Check for duplicate (code, client_url) when clientUrl changes
    if (clientUrl && clientUrl !== monitor.client_url) {
      const dup = await db.prepare(
        'SELECT id FROM sanity_check_monitors WHERE code = ? AND client_url = ? AND id != ?'
      ).get(monitor.code, clientUrl, req.params.id);
      if (dup) {
        return res.status(409).json({ error: `A monitor with code "${monitor.code}" already exists for that client URL` });
      }
    }

    // Build update dynamically to handle nullable threshold fields correctly
    const sets = [];
    const params = [];

    if (name) { sets.push('name = ?'); params.push(name); }
    if (clientUrl) { sets.push('client_url = ?'); params.push(clientUrl); }
    if (checkType) { sets.push('check_type = ?'); params.push(checkType); }
    if (expectedMin !== undefined) { sets.push('expected_min = ?'); params.push(expectedMin); }
    if (expectedMax !== undefined) { sets.push('expected_max = ?'); params.push(expectedMax); }
    if (severity) { sets.push('severity = ?'); params.push(severity); }
    if (frequencySeconds) { sets.push('frequency_seconds = ?'); params.push(frequencySeconds); }
    if (groupName !== undefined) { sets.push('group_name = ?'); params.push(groupName); }
    if (notifyEmail !== undefined) { sets.push('notify_email = ?'); params.push(notifyEmail); }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      params.push(req.params.id);
      await db.prepare(`UPDATE sanity_check_monitors SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    const updated = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    res.json(formatMonitor(updated));
  } catch (err) {
    console.error('Error updating sanity check monitor:', err);
    res.status(500).json({ error: 'Failed to update monitor' });
  }
});

// DELETE /api/sanity-checks/:id — Delete monitor
router.delete('/:id', async (req, res) => {
  try {
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });

    await db.prepare('DELETE FROM sanity_check_monitors WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete monitor' });
  }
});

// POST /api/sanity-checks/:id/pause
router.post('/:id/pause', async (req, res) => {
  try {
    await db.prepare('UPDATE sanity_check_monitors SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(formatMonitor(monitor));
  } catch (err) {
    res.status(500).json({ error: 'Failed to pause monitor' });
  }
});

// POST /api/sanity-checks/:id/resume
router.post('/:id/resume', async (req, res) => {
  try {
    await db.prepare('UPDATE sanity_check_monitors SET is_active = 1, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    if (!monitor) return res.status(404).json({ error: 'Monitor not found' });
    res.json(formatMonitor(monitor));
  } catch (err) {
    res.status(500).json({ error: 'Failed to resume monitor' });
  }
});

// POST /api/sanity-checks/:id/check — Run immediate check
router.post('/:id/check', async (req, res) => {
  try {
    const result = await executeCheckNow(parseInt(req.params.id, 10));
    const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(req.params.id);
    res.json({ monitor: formatMonitor(monitor), result: formatResult(result) });
  } catch (err) {
    console.error('Error running sanity check:', err);
    res.status(500).json({ error: `Check failed: ${err.message}` });
  }
});

// GET /api/sanity-checks/:id/results — Paginated result history
router.get('/:id/results', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const results = await db.prepare(`
      SELECT * FROM sanity_check_results
      WHERE monitor_id = ?
      ORDER BY checked_at DESC
      LIMIT ? OFFSET ?
    `).all(req.params.id, limit, offset);

    const total = await db.prepare(
      'SELECT COUNT(*) as cnt FROM sanity_check_results WHERE monitor_id = ?'
    ).get(req.params.id);

    res.json({
      results: results.map(formatResult),
      total: total.cnt,
      limit,
      offset,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get results' });
  }
});

// GET /api/sanity-checks/:id/results/latest — Latest N results for sparkline
router.get('/:id/results/latest', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const results = await db.prepare(`
      SELECT * FROM sanity_check_results
      WHERE monitor_id = ?
      ORDER BY checked_at DESC
      LIMIT ?
    `).all(req.params.id, limit);

    res.json(results.map(formatResult));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get latest results' });
  }
});

// GET /api/sanity-checks/:id/stats — Aggregated stats
router.get('/:id/stats', async (req, res) => {
  try {
    const stats = {};
    for (const [label, interval] of [['1h', '-1 hours'], ['24h', '-24 hours'], ['7d', '-7 days'], ['30d', '-30 days']]) {
      const rows = await db.prepare(`
        SELECT status, COUNT(*) as cnt, AVG(execution_time_ms) as avg_exec
        FROM sanity_check_results
        WHERE monitor_id = ? AND checked_at >= datetime('now', ?)
        GROUP BY status
      `).all(req.params.id, interval);

      let total = 0, passCount = 0, failCount = 0, errorCount = 0;
      let totalExec = 0, execCount = 0;
      for (const r of rows) {
        total += r.cnt;
        if (r.status === 'pass') passCount = r.cnt;
        if (r.status === 'fail') failCount = r.cnt;
        if (r.status === 'error') errorCount = r.cnt;
        if (r.avg_exec) { totalExec += r.avg_exec * r.cnt; execCount += r.cnt; }
      }

      stats[label] = {
        totalChecks: total,
        passCount, failCount, errorCount,
        passRate: total > 0 ? (passCount / total * 100).toFixed(1) : null,
        avgExecutionTimeMs: execCount > 0 ? Math.round(totalExec / execCount) : null,
      };
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

module.exports = router;
