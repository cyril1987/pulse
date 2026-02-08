const express = require('express');
const router = express.Router();
const config = require('../config');
const { sendTestEmail } = require('../services/notifier');

// Get SMTP configuration status (no secrets exposed)
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

module.exports = router;
