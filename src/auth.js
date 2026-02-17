const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const MicrosoftStrategy = require('passport-microsoft').Strategy;
const db = require('./db');
const config = require('./config');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// Fetch Microsoft user photo via Graph API and return as base64 data URI
async function fetchMicrosoftPhoto(accessToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

// Shared logic: find or create a user by provider ID, then update profile info
async function findOrCreateUser(provider, providerId, email, displayName, avatarUrl) {
  const idColumn = provider === 'google' ? 'google_id' : 'microsoft_id';

  // Check allowlist if configured
  if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(email)) {
    return { error: 'Email not authorized' };
  }

  // Try to find by provider ID first
  let user = await db.prepare(`SELECT * FROM users WHERE ${idColumn} = ?`).get(providerId);

  if (user) {
    await db.prepare(
      `UPDATE users SET last_login_at = datetime('now'), name = ?, avatar_url = ? WHERE id = ?`
    ).run(displayName, avatarUrl, user.id);
  } else {
    // Check if a user with this email already exists (linked via the other provider)
    user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
      // Link the new provider to the existing account
      await db.prepare(
        `UPDATE users SET ${idColumn} = ?, last_login_at = datetime('now'), name = ?, avatar_url = ? WHERE id = ?`
      ).run(providerId, displayName, avatarUrl, user.id);
    } else {
      // Create new user
      const result = await db.prepare(
        `INSERT INTO users (${idColumn}, email, name, avatar_url) VALUES (?, ?, ?, ?)`
      ).run(providerId, email, displayName, avatarUrl);
      user = { id: result.lastInsertRowid };
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
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value.toLowerCase();
        const avatarUrl = profile.photos?.[0]?.value || null;
        const result = await findOrCreateUser('google', profile.id, email, profile.displayName, avatarUrl);

        if (result.error) return done(null, false, { message: result.error });
        done(null, result.user);
      } catch (err) {
        done(err);
      }
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
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails?.[0]?.value || profile._json?.mail || profile._json?.userPrincipalName || '').toLowerCase();

        if (!email) {
          return done(null, false, { message: 'No email found in Microsoft profile' });
        }

        const avatarUrl = await fetchMicrosoftPhoto(accessToken);
        const result = await findOrCreateUser('microsoft', profile.id, email, profile.displayName, avatarUrl);

        if (result.error) return done(null, false, { message: result.error });
        done(null, result.user);
      } catch (err) {
        done(err);
      }
    }
  ));
} else {
  console.warn('[AUTH] Microsoft OAuth credentials not configured — Microsoft SSO disabled');
}

module.exports = passport;
