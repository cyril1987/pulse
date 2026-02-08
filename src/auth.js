const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const db = require('./db');
const config = require('./config');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

// Shared logic: find or create a user by provider ID, then update profile info
function findOrCreateUser(provider, providerId, email, displayName, avatarUrl) {
  const idColumn = provider === 'google' ? 'google_id' : 'microsoft_id';

  // Check allowlist if configured
  if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(email)) {
    return { error: 'Email not authorized' };
  }

  // Try to find by provider ID first
  let user = db.prepare(`SELECT * FROM users WHERE ${idColumn} = ?`).get(providerId);

  if (user) {
    db.prepare(
      `UPDATE users SET last_login_at = datetime('now'), name = ?, avatar_url = ? WHERE id = ?`
    ).run(displayName, avatarUrl, user.id);
  } else {
    // Check if a user with this email already exists (linked via the other provider)
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
      // Link the new provider to the existing account
      db.prepare(
        `UPDATE users SET ${idColumn} = ?, last_login_at = datetime('now'), name = ?, avatar_url = ? WHERE id = ?`
      ).run(providerId, displayName, avatarUrl, user.id);
    } else {
      // Create new user
      const result = db.prepare(
        `INSERT INTO users (${idColumn}, email, name, avatar_url) VALUES (?, ?, ?, ?)`
      ).run(providerId, email, displayName, avatarUrl);
      user = { id: result.lastInsertRowid };

      // Assign any orphaned monitors (user_id IS NULL) to the first user
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
      if (userCount === 1) {
        db.prepare('UPDATE monitors SET user_id = ? WHERE user_id IS NULL').run(user.id);
      }
    }
  }

  return { user };
}

// Google OAuth strategy
if (config.google.clientId && config.google.clientSecret) {
  passport.use(new GoogleStrategy(
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
      scope: ['profile', 'email'],
    },
    (accessToken, refreshToken, profile, done) => {
      const email = profile.emails[0].value.toLowerCase();
      const avatarUrl = profile.photos?.[0]?.value || null;
      const result = findOrCreateUser('google', profile.id, email, profile.displayName, avatarUrl);

      if (result.error) return done(null, false, { message: result.error });
      done(null, result.user);
    }
  ));
} else {
  console.warn('[AUTH] Google OAuth credentials not configured — Google SSO disabled');
}

// Microsoft OAuth strategy
if (config.microsoft.clientId && config.microsoft.clientSecret) {
  passport.use(new MicrosoftStrategy(
    {
      clientID: config.microsoft.clientId,
      clientSecret: config.microsoft.clientSecret,
      callbackURL: config.microsoft.callbackUrl,
      tenant: config.microsoft.tenant,
      scope: ['user.read'],
    },
    (accessToken, refreshToken, profile, done) => {
      const email = (profile.emails?.[0]?.value || profile._json?.mail || profile._json?.userPrincipalName || '').toLowerCase();

      if (!email) {
        return done(null, false, { message: 'No email found in Microsoft profile' });
      }

      const avatarUrl = null; // Microsoft Graph doesn't return photo URL in the basic profile
      const result = findOrCreateUser('microsoft', profile.id, email, profile.displayName, avatarUrl);

      if (result.error) return done(null, false, { message: result.error });
      done(null, result.user);
    }
  ));
} else {
  console.warn('[AUTH] Microsoft OAuth credentials not configured — Microsoft SSO disabled');
}

module.exports = passport;
