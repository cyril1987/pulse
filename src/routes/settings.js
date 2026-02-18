const express = require('express');
const router = express.Router();
const config = require('../config');
const db = require('../db');
const { sendTestEmail } = require('../services/notifier');
const { isConfigured, getProviderName } = require('../services/emailSender');
const jiraService = require('../services/jiraService');

// ─── Email Configuration ─────────────────────────────────────────────────────

// Get unified email configuration status (SendGrid or SMTP)
router.get('/settings/email', (req, res) => {
  const provider = getProviderName();
  const response = {
    provider,
    configured: isConfigured(),
    from: config.email.from,
  };

  if (provider === 'SendGrid') {
    response.apiKeySet = !!config.sendgrid.apiKey;
    response.apiKeyPreview = config.sendgrid.apiKey
      ? config.sendgrid.apiKey.slice(0, 7) + '****'
      : '(not set)';
  } else {
    response.host = config.smtp.host;
    response.port = config.smtp.port;
    response.secure = config.smtp.secure;
    response.user = config.smtp.user ? config.smtp.user.slice(0, 4) + '****' : '(not set)';
  }

  res.json(response);
});

// Legacy SMTP endpoint (backward compatibility)
router.get('/settings/smtp', (req, res) => {
  res.json({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user ? config.smtp.user.slice(0, 4) + '****' : '(not set)',
    from: config.smtp.from,
    configured: !!(config.smtp.host && config.smtp.user),
  });
});

// Send a test email
router.post('/settings/test-email', async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    await sendTestEmail(email);
    console.log(`[TEST-EMAIL] Test email sent successfully to ${email}`);
    res.json({ success: true, message: `Test email sent to ${email}` });
  } catch (err) {
    console.error(`[TEST-EMAIL] Failed to send test email to ${email}:`, err.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send test email',
      details: err.message,
    });
  }
});

// ─── Notification Preferences ────────────────────────────────────────────────

// Get current user's notification preferences
router.get('/settings/notification-prefs', async (req, res) => {
  let prefs = await db.prepare(
    'SELECT * FROM user_notification_prefs WHERE user_id = ?'
  ).get(req.user.id);

  if (!prefs) {
    // Return defaults if no row exists yet
    prefs = {
      monitor_alerts: 1,
      task_assigned: 1,
      task_status_change: 1,
      task_due_soon: 1,
      task_overdue: 1,
      daily_digest: 0,
    };
  }

  res.json({
    monitorAlerts: !!prefs.monitor_alerts,
    taskAssigned: !!prefs.task_assigned,
    taskStatusChange: !!prefs.task_status_change,
    taskDueSoon: !!prefs.task_due_soon,
    taskOverdue: !!prefs.task_overdue,
    dailyDigest: !!prefs.daily_digest,
  });
});

// Update current user's notification preferences
router.put('/settings/notification-prefs', async (req, res) => {
  const {
    monitorAlerts, taskAssigned, taskStatusChange,
    taskDueSoon, taskOverdue, dailyDigest,
  } = req.body;

  await db.prepare(`
    INSERT INTO user_notification_prefs
      (user_id, monitor_alerts, task_assigned, task_status_change,
       task_due_soon, task_overdue, daily_digest, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      monitor_alerts = excluded.monitor_alerts,
      task_assigned = excluded.task_assigned,
      task_status_change = excluded.task_status_change,
      task_due_soon = excluded.task_due_soon,
      task_overdue = excluded.task_overdue,
      daily_digest = excluded.daily_digest,
      updated_at = excluded.updated_at
  `).run(
    req.user.id,
    monitorAlerts !== false ? 1 : 0,
    taskAssigned !== false ? 1 : 0,
    taskStatusChange !== false ? 1 : 0,
    taskDueSoon !== false ? 1 : 0,
    taskOverdue !== false ? 1 : 0,
    dailyDigest ? 1 : 0
  );

  res.json({ success: true });
});

// ─── Jira Integration Settings ──────────────────────────────────────────────

// Get Jira configuration status (no secrets exposed)
router.get('/settings/jira', (req, res) => {
  res.json({
    baseUrl: config.jira.baseUrl || '(not set)',
    userEmail: config.jira.userEmail ? config.jira.userEmail.slice(0, 4) + '****' : '(not set)',
    configured: jiraService.isConfigured(),
  });
});

// Test Jira connection
router.post('/settings/test-jira', async (req, res) => {
  if (!jiraService.isConfigured()) {
    return res.status(400).json({
      success: false,
      error: 'Jira integration is not configured. Set JIRA_BASE_URL, JIRA_USER_EMAIL, and JIRA_API_TOKEN in your .env file.',
    });
  }

  try {
    const result = await jiraService.testConnection();
    console.log(`[JIRA] Connection test successful — user: ${result.displayName}`);
    res.json(result);
  } catch (err) {
    console.error(`[JIRA] Connection test failed:`, err.message);
    res.status(502).json({
      success: false,
      error: 'Failed to connect to Jira',
      details: err.message,
    });
  }
});

module.exports = router;
