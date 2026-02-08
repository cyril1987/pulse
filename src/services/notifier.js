const nodemailer = require('nodemailer');
const db = require('../db');
const config = require('../config');

let transporter;

function getTransporter() {
  if (!transporter) {
    const opts = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
    };
    if (config.smtp.user) {
      opts.auth = { user: config.smtp.user, pass: config.smtp.pass };
    }
    transporter = nodemailer.createTransport(opts);
  }
  return transporter;
}

const getRecentChecks = db.prepare(`
  SELECT is_success FROM checks
  WHERE monitor_id = ?
  ORDER BY checked_at DESC
  LIMIT ?
`);

const updateStatus = db.prepare(`
  UPDATE monitors
  SET current_status = ?, last_status_change_at = datetime('now'), updated_at = datetime('now')
  WHERE id = ?
`);

const logNotification = db.prepare(`
  INSERT INTO notifications (monitor_id, type, email, details) VALUES (?, ?, ?, ?)
`);

const checkRecentNotification = db.prepare(`
  SELECT COUNT(*) as count FROM notifications
  WHERE monitor_id = ? AND type = ?
  AND sent_at > datetime('now', '-15 minutes')
`);

async function evaluateAndNotify(monitor, checkResult) {
  const previousStatus = monitor.current_status;

  const recentChecks = getRecentChecks.all(monitor.id, config.failuresBeforeAlert);

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
    updateStatus.run(newStatus, monitor.id);

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

async function sendDownAlert(monitor, checkResult) {
  const recent = checkRecentNotification.get(monitor.id, 'down');
  if (recent.count > 0) return;

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
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: monitor.notify_email,
      subject,
      text,
    });
    logNotification.run(
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
  const recent = checkRecentNotification.get(monitor.id, 'recovery');
  if (recent.count > 0) return;

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
    await getTransporter().sendMail({
      from: config.smtp.from,
      to: monitor.notify_email,
      subject,
      text,
    });
    logNotification.run(
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

module.exports = { evaluateAndNotify, sendTestEmail };

async function sendTestEmail(toEmail) {
  const subject = '[TEST] iConcile Pulse - Email Configuration Test';
  const text = [
    'This is a test email from iConcile Pulse.',
    '',
    'If you are reading this, your SMTP configuration is working correctly.',
    '',
    `SMTP Host: ${config.smtp.host}`,
    `SMTP Port: ${config.smtp.port}`,
    `Sent At: ${new Date().toISOString()}`,
    '',
    '-- iConcile Pulse',
  ].join('\n');

  await getTransporter().sendMail({
    from: config.smtp.from,
    to: toEmail,
    subject,
    text,
  });
}
