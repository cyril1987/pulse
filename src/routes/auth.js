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

// Logout
router.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
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
