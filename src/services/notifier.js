const { sendEmail } = require('./emailSender');
const db = require('../db');
const config = require('../config');

async function evaluateAndNotify(monitor, checkResult) {
  const previousStatus = monitor.current_status;

  const recentChecks = await db.prepare(`
    SELECT is_success FROM checks
    WHERE monitor_id = ?
    ORDER BY checked_at DESC
    LIMIT ?
  `).all(monitor.id, config.failuresBeforeAlert);

  const allRecentFailed =
    recentChecks.length >= config.failuresBeforeAlert &&
    recentChecks.every((c) => c.is_success === 0);

  let newStatus;
  if (checkResult.isSuccess) {
    newStatus = 'up';
  } else if (allRecentFailed) {
    newStatus = 'down';
  } else {
    newStatus = previousStatus === 'unknown' ? 'unknown' : previousStatus;
  }

  if (newStatus !== previousStatus) {
    await db.prepare(`
      UPDATE monitors
      SET current_status = ?, last_status_change_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, monitor.id);

    if (
      (previousStatus === 'up' || previousStatus === 'unknown') &&
      newStatus === 'down'
    ) {
      await sendDownAlert(monitor, checkResult);
    } else if (previousStatus === 'down' && newStatus === 'up') {
      await sendRecoveryAlert(monitor);
    }
  }
}

async function shouldNotifyMonitor(monitorEmail) {
  // Monitor alerts go to the notify_email on the monitor, not necessarily a user.
  // Look up user by email to check their preferences.
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(monitorEmail);
  if (!user) return true; // External email — no prefs to check

  const prefs = await db.prepare(
    'SELECT monitor_alerts FROM user_notification_prefs WHERE user_id = ?'
  ).get(user.id);

  if (!prefs) return true; // No prefs row = defaults (enabled)
  return !!prefs.monitor_alerts;
}

async function sendDownAlert(monitor, checkResult) {
  const recent = await db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE monitor_id = ? AND type = ?
    AND sent_at > datetime('now', '-15 minutes')
  `).get(monitor.id, 'down');
  if (recent.count > 0) return;

  if (!(await shouldNotifyMonitor(monitor.notify_email))) return;

  const subject = `[DOWN] Monitor Alert: ${monitor.name} (${monitor.url})`;
  const text = [
    `Monitor: ${monitor.name}`,
    `URL: ${monitor.url}`,
    `Status: DOWN`,
    `Error: ${checkResult.errorMessage || 'Non-success status code'}`,
    `Status Code: ${checkResult.statusCode || 'N/A'}`,
    `Checked At: ${new Date().toISOString()}`,
    '',
    '-- iConcile Pulse',
  ].join('\n');

  try {
    await sendEmail({ to: monitor.notify_email, subject, text });
    await db.prepare(`
      INSERT INTO notifications (monitor_id, type, email, details) VALUES (?, ?, ?, ?)
    `).run(
      monitor.id,
      'down',
      monitor.notify_email,
      JSON.stringify({ error: checkResult.errorMessage, statusCode: checkResult.statusCode })
    );
    console.log(`[NOTIFY] Down alert sent for ${monitor.name} to ${monitor.notify_email}`);
  } catch (err) {
    console.error(`[NOTIFY] Failed to send down alert for ${monitor.name}:`, err.message);
  }
}

async function sendRecoveryAlert(monitor) {
  const recent = await db.prepare(`
    SELECT COUNT(*) as count FROM notifications
    WHERE monitor_id = ? AND type = ?
    AND sent_at > datetime('now', '-15 minutes')
  `).get(monitor.id, 'recovery');
  if (recent.count > 0) return;

  if (!(await shouldNotifyMonitor(monitor.notify_email))) return;

  let downtimeDuration = 'unknown';
  if (monitor.last_status_change_at) {
    const downSince = new Date(monitor.last_status_change_at + 'Z').getTime();
    const now = Date.now();
    const diffMs = now - downSince;
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    downtimeDuration = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  const subject = `[RECOVERED] Monitor Alert: ${monitor.name} (${monitor.url})`;
  const text = [
    `Monitor: ${monitor.name}`,
    `URL: ${monitor.url}`,
    `Status: UP (Recovered)`,
    `Downtime Duration: ${downtimeDuration}`,
    `Recovered At: ${new Date().toISOString()}`,
    '',
    '-- iConcile Pulse',
  ].join('\n');

  try {
    await sendEmail({ to: monitor.notify_email, subject, text });
    await db.prepare(`
      INSERT INTO notifications (monitor_id, type, email, details) VALUES (?, ?, ?, ?)
    `).run(
      monitor.id,
      'recovery',
      monitor.notify_email,
      JSON.stringify({ downtimeDuration })
    );
    console.log(`[NOTIFY] Recovery alert sent for ${monitor.name} to ${monitor.notify_email}`);
  } catch (err) {
    console.error(`[NOTIFY] Failed to send recovery alert for ${monitor.name}:`, err.message);
  }
}

async function sendTestEmail(toEmail) {
  const { getProviderName } = require('./emailSender');
  const provider = getProviderName();

  const subject = '[TEST] iConcile Pulse - Email Configuration Test';
  const text = [
    'This is a test email from iConcile Pulse.',
    '',
    'If you are reading this, your email configuration is working correctly.',
    '',
    `Provider: ${provider}`,
    `Sent At: ${new Date().toISOString()}`,
    '',
    '-- iConcile Pulse',
  ].join('\n');

  await sendEmail({ to: toEmail, subject, text });
}

module.exports = { evaluateAndNotify, sendTestEmail };
