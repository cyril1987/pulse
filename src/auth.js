const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');
const config = require('./config');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

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

      // Check allowlist if configured
      if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(email)) {
        return done(null, false, { message: 'Email not authorized' });
      }

      // Find or create user
      let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);

      if (user) {
        db.prepare(
          "UPDATE users SET last_login_at = datetime('now'), name = ?, avatar_url = ? WHERE id = ?"
        ).run(profile.displayName, profile.photos?.[0]?.value || null, user.id);
      } else {
        const result = db.prepare(
          'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)'
        ).run(profile.id, email, profile.displayName, profile.photos?.[0]?.value || null);
        user = { id: result.lastInsertRowid };

        // Assign any orphaned monitors (user_id IS NULL) to the first user
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        if (userCount === 1) {
          db.prepare('UPDATE monitors SET user_id = ? WHERE user_id IS NULL').run(user.id);
        }
      }

      done(null, user);
    }
  ));
} else {
  console.warn('[AUTH] Google OAuth credentials not configured — SSO login disabled');
}

module.exports = passport;
