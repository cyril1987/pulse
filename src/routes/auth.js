const express = require('express');
const router = express.Router();
const passport = require('passport');

// Initiate Google OAuth login
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=unauthorized' }),
  (req, res) => {
    res.redirect('/');
  }
);

// Initiate Microsoft OAuth login
router.get('/auth/microsoft',
  passport.authenticate('microsoft', { prompt: 'select_account' })
);

// Microsoft OAuth callback
router.get('/auth/microsoft/callback',
  passport.authenticate('microsoft', { failureRedirect: '/login.html?error=unauthorized' }),
  (req, res) => {
    res.redirect('/');
  }
);

// Dev login — available only when no SSO providers are configured
const config = require('../config');
const db = require('../db');
const hasGoogle = !!(config.google.clientId && config.google.clientSecret);
const hasMicrosoft = !!(config.microsoft.clientId && config.microsoft.clientSecret);

const enableDevLogin = !hasGoogle && !hasMicrosoft || process.env.DEV_LOGIN === 'true';

// Dev login — always register the route; guarded by enableDevLogin flag
router.post('/auth/dev-login', async (req, res) => {
  if (!enableDevLogin) {
    return res.status(403).json({ error: 'Dev login is disabled' });
  }
  // Find or create a local dev user
  let user = await db.prepare("SELECT * FROM users WHERE email = 'dev@localhost'").get();
  if (!user) {
    const result = await db.prepare(
      "INSERT INTO users (email, name) VALUES ('dev@localhost', 'Local Developer')"
    ).run();
    user = { id: result.lastInsertRowid, email: 'dev@localhost', name: 'Local Developer' };
  }
  req.login(user, (err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    res.json({ ok: true });
  });
});

router.get('/auth/providers', (req, res) => {
  res.json({ google: hasGoogle, microsoft: hasMicrosoft, devLogin: enableDevLogin });
});

// Logout
router.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session = null; // cookie-session: clear by setting to null
    res.json({ ok: true });
  });
});

// Get current user info
router.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    avatarUrl: req.user.avatar_url,
  });
});

module.exports = router;
