const db = require('../db');
const { sendEmail } = require('./emailSender');

let lastNotification = {};

async function tick() {
  try {
    // Get distinct client URLs that have active monitors due for checking
    const dueClients = await db.prepare(`
      SELECT DISTINCT client_url FROM sanity_check_monitors
      WHERE is_active = 1
      AND (
        last_checked_at IS NULL
        OR datetime(last_checked_at, '+' || frequency_seconds || ' seconds') <= datetime('now')
      )
    `).all();

    if (dueClients.length === 0) return;

    console.log(`[SANITY-CHECK] ${dueClients.length} client(s) due for check`);

    const CONCURRENCY = 10;
    for (let i = 0; i < dueClients.length; i += CONCURRENCY) {
      const batch = dueClients.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(client => processClient(client.client_url))
      );

      for (const r of results) {
        if (r.status === 'rejected') {
          console.error('[SANITY-CHECK] Client processing error:', r.reason);
        }
      }
    }
  } catch (err) {
    console.error('[SANITY-CHECK] Tick error:', err);
  }
}

async function processClient(clientUrl) {
  try {
    // Step 1: Trigger execution on the client
    const triggerRes = await fetch(`${clientUrl}/api/execute-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
    });

    if (!triggerRes.ok) {
      console.error(`[SANITY-CHECK] Trigger failed for ${clientUrl}: ${triggerRes.status}`);
      await markClientError(clientUrl, `Trigger failed: HTTP ${triggerRes.status}`);
      return;
    }

    const triggerData = await triggerRes.json();

    // Step 2: Process the batch results
    // The trigger response already contains results (synchronous execution)
    const batchResults = triggerData.results || [];

    console.log(`[SANITY-CHECK] Got ${batchResults.length} results from ${clientUrl}`);

    // Step 3: Process each result
    for (const result of batchResults) {
      await processResult(clientUrl, result);
    }
  } catch (err) {
    console.error(`[SANITY-CHECK] Error processing client ${clientUrl}:`, err.message);
    await markClientError(clientUrl, err.message);
  }
}

async function processResult(clientUrl, result) {
  try {
    // Find matching monitor by (code, client_url)
    const monitor = await db.prepare(`
      SELECT * FROM sanity_check_monitors
      WHERE code = ? AND client_url = ? AND is_active = 1
    `).get(result.code, clientUrl);

    if (!monitor) return; // No monitor configured for this code on this client

    const previousValue = monitor.last_value;
    const newValue = result.success ? result.actualValue : null;
    const valueChanged = (previousValue !== newValue) ? 1 : 0;

    // Evaluate against thresholds
    let status;
    if (!result.success) {
      status = 'error';
    } else {
      status = evaluate(monitor.check_type, newValue, monitor.expected_min, monitor.expected_max);
    }

    // Store result
    await db.prepare(`
      INSERT INTO sanity_check_results (monitor_id, code, status, actual_value, previous_value, value_changed, execution_time_ms, error_message, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      monitor.id,
      result.code,
      status,
      newValue,
      previousValue,
      valueChanged,
      result.executionTimeMs || 0,
      result.errorMessage || null
    );

    // Update monitor
    const previousStatus = monitor.current_status;
    const updateFields = {
      last_value: newValue,
      last_checked_at: new Date().toISOString(),
      current_status: status,
      updated_at: new Date().toISOString(),
    };

    if (status !== previousStatus) {
      updateFields.last_status_change_at = new Date().toISOString();
    }

    await db.prepare(`
      UPDATE sanity_check_monitors
      SET last_value = ?, last_checked_at = datetime('now'), current_status = ?,
          last_status_change_at = CASE WHEN ? != current_status THEN datetime('now') ELSE last_status_change_at END,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newValue, status, status, monitor.id);

    // Alert only if value changed
    if (valueChanged) {
      await evaluateAndNotify(monitor, {
        code: result.code,
        status,
        previousStatus,
        actualValue: newValue,
        previousValue,
        executionTimeMs: result.executionTimeMs,
        errorMessage: result.errorMessage,
      });
    }

    const icon = status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'ERR';
    const changeIndicator = valueChanged ? ' [VALUE CHANGED]' : '';
    console.log(`[SANITY-CHECK] ${icon} ${result.code} @ ${clientUrl}: value=${newValue}${changeIndicator}`);
  } catch (err) {
    console.error(`[SANITY-CHECK] Error processing result for ${result.code}:`, err.message);
  }
}

function evaluate(checkType, actualValue, expectedMin, expectedMax) {
  if (actualValue === null || actualValue === undefined) return 'error';

  switch (checkType) {
    case 'count_zero':
      return actualValue === 0 ? 'pass' : 'fail';
    case 'count_positive':
      return actualValue > 0 ? 'pass' : 'fail';
    case 'count_range': {
      const min = expectedMin !== null && expectedMin !== undefined ? expectedMin : 0;
      const max = expectedMax !== null && expectedMax !== undefined ? expectedMax : Number.MAX_SAFE_INTEGER;
      return (actualValue >= min && actualValue <= max) ? 'pass' : 'fail';
    }
    case 'custom_threshold': {
      const min = expectedMin !== null && expectedMin !== undefined ? expectedMin : -Number.MAX_SAFE_INTEGER;
      const max = expectedMax !== null && expectedMax !== undefined ? expectedMax : Number.MAX_SAFE_INTEGER;
      return (actualValue >= min && actualValue <= max) ? 'pass' : 'fail';
    }
    default:
      return 'error';
  }
}

async function evaluateAndNotify(monitor, result) {
  const { code, status, previousStatus, actualValue, previousValue, executionTimeMs, errorMessage } = result;

  // On transition to fail: create task + send email
  if (status === 'fail' && previousStatus !== 'fail') {
    // Create a task
    try {
      const priority = mapSeverityToPriority(monitor.severity);
      await db.prepare(`
        INSERT INTO tasks (title, description, source, source_ref, priority, status, created_by, created_at, updated_at)
        VALUES (?, ?, 'sanity_check', ?, ?, 'todo', ?, datetime('now'), datetime('now'))
      `).run(
        `[Sanity Check FAIL] ${monitor.name} (${code})`,
        `Sanity check "${monitor.name}" (code: ${code}) failed on ${monitor.client_url}.\n\nCheck Type: ${monitor.check_type}\nActual Value: ${actualValue}\nPrevious Value: ${previousValue}\nExpected: ${formatExpected(monitor)}\nExecution Time: ${executionTimeMs}ms${errorMessage ? '\nError: ' + errorMessage : ''}`,
        code,
        priority,
        monitor.created_by
      );
      console.log(`[SANITY-CHECK] Created task for failed check: ${code}`);
    } catch (err) {
      console.error(`[SANITY-CHECK] Failed to create task for ${code}:`, err.message);
    }

    // Send email notification (rate-limited)
    if (monitor.notify_email) {
      const notifKey = `${monitor.id}_fail`;
      const now = Date.now();
      if (!lastNotification[notifKey] || now - lastNotification[notifKey] > 900000) {
        lastNotification[notifKey] = now;
        try {
          await sendEmail({
            to: monitor.notify_email,
            subject: `[SANITY CHECK FAIL] ${monitor.name} (${code})`,
            html: `
              <h2>Sanity Check Failed</h2>
              <p><strong>Check:</strong> ${monitor.name} (${code})</p>
              <p><strong>Client:</strong> ${monitor.client_url}</p>
              <p><strong>Severity:</strong> ${monitor.severity}</p>
              <p><strong>Actual Value:</strong> ${actualValue}</p>
              <p><strong>Previous Value:</strong> ${previousValue}</p>
              <p><strong>Expected:</strong> ${formatExpected(monitor)}</p>
              <p><strong>Execution Time:</strong> ${executionTimeMs}ms</p>
              ${errorMessage ? `<p><strong>Error:</strong> ${errorMessage}</p>` : ''}
            `,
          });
        } catch (err) {
          console.error(`[SANITY-CHECK] Failed to send email for ${code}:`, err.message);
        }
      }
    }
  }

  // On recovery (fail -> pass): log it
  if (status === 'pass' && previousStatus === 'fail') {
    console.log(`[SANITY-CHECK] RECOVERED: ${code} @ ${monitor.client_url}`);
    if (monitor.notify_email) {
      try {
        await sendEmail({
          to: monitor.notify_email,
          subject: `[SANITY CHECK RECOVERED] ${monitor.name} (${code})`,
          html: `
            <h2>Sanity Check Recovered</h2>
            <p><strong>Check:</strong> ${monitor.name} (${code})</p>
            <p><strong>Client:</strong> ${monitor.client_url}</p>
            <p><strong>Current Value:</strong> ${actualValue}</p>
            <p><strong>Previous Value:</strong> ${previousValue}</p>
          `,
        });
      } catch (err) {
        console.error(`[SANITY-CHECK] Failed to send recovery email for ${code}:`, err.message);
      }
    }
  }
}

function mapSeverityToPriority(severity) {
  switch (severity) {
    case 'critical': return 'urgent';
    case 'high': return 'high';
    case 'medium': return 'medium';
    case 'low': return 'low';
    default: return 'medium';
  }
}

function formatExpected(monitor) {
  switch (monitor.check_type) {
    case 'count_zero': return '0 rows';
    case 'count_positive': return '> 0 rows';
    case 'count_range': return `[${monitor.expected_min}, ${monitor.expected_max}]`;
    case 'custom_threshold': return `[${monitor.expected_min}, ${monitor.expected_max}]`;
    default: return 'unknown';
  }
}

async function markClientError(clientUrl, errorMsg) {
  try {
    const monitors = await db.prepare(`
      SELECT * FROM sanity_check_monitors WHERE client_url = ? AND is_active = 1
    `).all(clientUrl);

    for (const monitor of monitors) {
      await db.prepare(`
        INSERT INTO sanity_check_results (monitor_id, code, status, actual_value, previous_value, value_changed, execution_time_ms, error_message, checked_at)
        VALUES (?, ?, 'error', NULL, ?, 0, 0, ?, datetime('now'))
      `).run(monitor.id, monitor.code, monitor.last_value, errorMsg);

      await db.prepare(`
        UPDATE sanity_check_monitors
        SET current_status = 'error', last_checked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(monitor.id);
    }
  } catch (err) {
    console.error('[SANITY-CHECK] Error marking client errors:', err.message);
  }
}

// Execute a single monitor's check (for manual "Run Now")
async function executeCheckNow(monitorId) {
  const monitor = await db.prepare('SELECT * FROM sanity_check_monitors WHERE id = ?').get(monitorId);
  if (!monitor) throw new Error('Monitor not found');

  try {
    const triggerRes = await fetch(`${monitor.client_url}/api/checks/${monitor.code}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(60000),
    });

    if (!triggerRes.ok) {
      throw new Error(`Client returned HTTP ${triggerRes.status}`);
    }

    const result = await triggerRes.json();
    await processResult(monitor.client_url, result);

    // Return the latest result
    return await db.prepare(`
      SELECT * FROM sanity_check_results
      WHERE monitor_id = ?
      ORDER BY checked_at DESC
      LIMIT 1
    `).get(monitorId);
  } catch (err) {
    // Store error result
    await db.prepare(`
      INSERT INTO sanity_check_results (monitor_id, code, status, actual_value, previous_value, value_changed, execution_time_ms, error_message, checked_at)
      VALUES (?, ?, 'error', NULL, ?, 0, 0, ?, datetime('now'))
    `).run(monitorId, monitor.code, monitor.last_value, err.message);

    await db.prepare(`
      UPDATE sanity_check_monitors
      SET current_status = 'error', last_checked_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(monitorId);

    throw err;
  }
}

module.exports = { tick, executeCheckNow };
