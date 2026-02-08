# Google SSO Implementation Plan for iConcile Pulse

## Current State

iConcile Pulse is a URL monitoring application with **zero authentication**. All API
endpoints are publicly accessible, there are no user accounts, no sessions, and no
authorization of any kind. The app is built with:

- **Backend:** Express.js (Node.js) with SQLite3 (better-sqlite3)
- **Frontend:** Vanilla JavaScript SPA with hash-based routing
- **No existing auth libraries** in `package.json`

This plan adds Google SSO as the sole authentication mechanism, along with the
session/user infrastructure required to support it.

---

## Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OAuth library | `passport` + `passport-google-oauth20` | De-facto standard for Express, well-maintained, handles the full OAuth2 flow |
| Session management | `express-session` + `better-sqlite3-session-store` | Reuses the existing SQLite database; no need for Redis |
| Token format | Server-side sessions (cookie-based) | Simpler than JWT for a server-rendered SPA; avoids token storage in frontend |
| User-monitor relation | `user_id` foreign key on `monitors` table | Enables multi-tenancy so each user only sees their own monitors |
| Allowed users | Configurable allowlist via env var | Prevents arbitrary Google accounts from accessing the app |

---

## Implementation Steps

### Phase 1: Database Schema Changes

**New migration: `migrations/003-add-users.sql`**

```sql
-- Users table for Google SSO accounts
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Sessions table for express-session (better-sqlite3-session-store)
CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

-- Add user_id to monitors for multi-tenancy
ALTER TABLE monitors ADD COLUMN user_id INTEGER REFERENCES users(id);
```

**Files changed:**
- `migrations/003-add-users.sql` (new)
- `src/db.js` — ensure migration 003 runs on startup

---

### Phase 2: Install Dependencies

```bash
npm install passport passport-google-oauth20 express-session better-sqlite3-session-store
```

**New dependencies:**
| Package | Purpose |
|---------|---------|
| `passport` | Authentication middleware framework |
| `passport-google-oauth20` | Google OAuth 2.0 strategy for Passport |
| `express-session` | Server-side session management |
| `better-sqlite3-session-store` | SQLite-backed session store |

---

### Phase 3: Configuration Updates

**File: `src/config.js`** — add Google OAuth and session config:

```js
google: {
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  callbackUrl: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
},
session: {
  secret: process.env.SESSION_SECRET || 'change-me-in-production',
},
allowedEmails: process.env.ALLOWED_EMAILS
  ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase())
  : [],   // empty = allow all Google accounts
```

**File: `.env.example`** — add new variables:

```env
# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Session
SESSION_SECRET=a-random-secret-string

# Allowed emails (comma-separated, empty = allow all)
ALLOWED_EMAILS=
```

---

### Phase 4: Passport Configuration

**New file: `src/auth.js`**

Responsibilities:
1. Configure `passport-google-oauth20` strategy
2. `serializeUser` — store `user.id` in session
3. `deserializeUser` — load user from SQLite by `id`
4. In the Google strategy verify callback:
   - Check if the email is in the allowlist (if configured)
   - Find or create the user in the `users` table
   - Update `last_login_at` on each login

```js
// Pseudocode outline
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');
const config = require('./config');

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

passport.use(new GoogleStrategy({
    clientID: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackURL: config.google.callbackUrl,
    scope: ['profile', 'email'],
  },
  (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value.toLowerCase();

    // Check allowlist
    if (config.allowedEmails.length > 0 && !config.allowedEmails.includes(email)) {
      return done(null, false, { message: 'Email not authorized' });
    }

    // Upsert user
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
    if (user) {
      db.prepare('UPDATE users SET last_login_at = datetime("now"), name = ?, avatar_url = ? WHERE id = ?')
        .run(profile.displayName, profile.photos?.[0]?.value, user.id);
    } else {
      const result = db.prepare(
        'INSERT INTO users (google_id, email, name, avatar_url) VALUES (?, ?, ?, ?)'
      ).run(profile.id, email, profile.displayName, profile.photos?.[0]?.value);
      user = { id: result.lastInsertRowid };
    }
    done(null, user);
  }
));
```

---

### Phase 5: Auth Routes

**New file: `src/routes/auth.js`**

| Route | Method | Purpose |
|-------|--------|---------|
| `/auth/google` | GET | Initiates Google OAuth flow |
| `/auth/google/callback` | GET | Handles Google's redirect with auth code |
| `/auth/logout` | POST | Destroys session and redirects to login |
| `/auth/me` | GET | Returns current user info (for frontend) |

```js
const router = require('express').Router();
const passport = require('passport');

// Initiate Google login
router.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google callback
router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login.html?error=unauthorized' }),
  (req, res) => res.redirect('/')
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

// Current user info
router.get('/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    avatarUrl: req.user.avatar_url,
  });
});
```

---

### Phase 6: Auth Middleware

**New file: `src/middleware/requireAuth.js`**

```js
module.exports = function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};
```

This middleware will be applied to all `/api/*` routes.

---

### Phase 7: Server Integration

**File: `server.js`** — wire everything together:

```js
// 1. Add session middleware (before routes)
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const passport = require('passport');
require('./src/auth');  // configure passport strategies

app.use(session({
  store: new SqliteStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS in prod
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,  // 7 days
    sameSite: 'lax',
  },
}));

// 2. Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// 3. Mount auth routes (before requireAuth)
app.use(authRouter);

// 4. Protect API routes
const requireAuth = require('./src/middleware/requireAuth');
app.use('/api', requireAuth);

// 5. Serve login page for unauthenticated users
// (static files like login.html remain publicly accessible)
```

Order of middleware in `server.js`:
1. `express.json()`
2. `express.static()` (serves login page, CSS, JS)
3. `express-session`
4. `passport.initialize()` + `passport.session()`
5. Auth routes (`/auth/google`, `/auth/google/callback`, `/auth/logout`, `/auth/me`)
6. `requireAuth` on `/api/*`
7. Existing API routes (`/api/monitors`, etc.)
8. SPA catch-all

---

### Phase 8: Multi-Tenancy (Route Changes)

Update existing route handlers to scope data by `req.user.id`:

**File: `src/routes/monitors.js`**
- `GET /api/monitors` — add `WHERE user_id = ?` with `req.user.id`
- `POST /api/monitors` — set `user_id` from `req.user.id` on insert
- `GET /api/monitors/:id` — add `AND user_id = ?` to prevent cross-user access
- `PUT /api/monitors/:id` — same ownership check
- `DELETE /api/monitors/:id` — same ownership check
- `POST /api/monitors/:id/pause|resume|downtime|check` — same ownership check

**File: `src/routes/checks.js`**
- All check/stats endpoints — join on monitors to verify `user_id` ownership

**File: `src/routes/settings.js`**
- No changes needed (SMTP settings are global/server-level)

---

### Phase 9: Frontend Changes

#### 9a. Login Page

**New file: `public/login.html`** — standalone login page (not part of the SPA):

```html
<!-- Simple centered page with:
     - iConcile Pulse logo
     - "Sign in to continue" heading
     - "Sign in with Google" button linking to /auth/google
     - Error message display for ?error=unauthorized
     - Styled consistently with existing CSS -->
```

#### 9b. API Client Auth Handling

**File: `public/js/api.js`** — handle 401 responses:

```js
// In each method (get, post, put, delete), after checking res.ok:
if (res.status === 401) {
  window.location.href = '/login.html';
  return;
}
```

#### 9c. User Menu in Navbar

**File: `public/index.html`** — add user avatar + logout to nav:

```html
<!-- Add to .nav-links -->
<div class="nav-user" id="nav-user">
  <img class="nav-avatar" id="nav-avatar" src="" alt="">
  <span id="nav-user-name"></span>
  <button id="nav-logout" class="nav-link">Logout</button>
</div>
```

#### 9d. App Initialization

**File: `public/js/app.js`** — fetch current user on load:

```js
// On DOMContentLoaded, call /auth/me
// If 401 → redirect to /login.html
// If OK → populate nav-user with name/avatar, then proceed with routing
```

#### 9e. Styles

**File: `public/css/style.css`** — add styles for:
- Login page layout
- Google sign-in button
- User avatar in navbar
- Logout button

---

### Phase 10: Google Cloud Console Setup (Manual)

These are manual steps the deployer must perform:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth 2.0 Client ID**
5. Set application type to **Web application**
6. Add authorized redirect URI: `https://your-domain.com/auth/google/callback`
   - For local dev: `http://localhost:3000/auth/google/callback`
7. Copy the **Client ID** and **Client Secret** into `.env`
8. Enable the **Google+ API** or **People API** if prompted

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `migrations/003-add-users.sql` | Create | Users table, sessions table, monitors.user_id column |
| `src/auth.js` | Create | Passport Google strategy configuration |
| `src/routes/auth.js` | Create | Auth routes (login, callback, logout, me) |
| `src/middleware/requireAuth.js` | Create | Authentication guard middleware |
| `src/config.js` | Modify | Add Google OAuth + session config |
| `src/db.js` | Modify | Run migration 003 |
| `server.js` | Modify | Add session, passport, auth routes, requireAuth middleware |
| `src/routes/monitors.js` | Modify | Scope all queries by user_id |
| `src/routes/checks.js` | Modify | Scope check queries by user_id (via monitors join) |
| `public/login.html` | Create | Google SSO login page |
| `public/js/api.js` | Modify | Handle 401 redirects |
| `public/js/app.js` | Modify | Fetch user on load, populate nav |
| `public/index.html` | Modify | Add user menu to navbar |
| `public/css/style.css` | Modify | Login page + user menu styles |
| `.env.example` | Modify | Add Google OAuth + session env vars |
| `package.json` | Modify | Add new dependencies |

---

## New Dependencies

```
passport                          ^0.7.0
passport-google-oauth20           ^2.0.0
express-session                   ^1.18.0
better-sqlite3-session-store      ^0.1.0
```

---

## Environment Variables (New)

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_CLIENT_ID` | Yes | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | OAuth 2.0 client secret |
| `GOOGLE_CALLBACK_URL` | No | Callback URL (default: `/auth/google/callback`) |
| `SESSION_SECRET` | Yes | Random string for signing session cookies |
| `ALLOWED_EMAILS` | No | Comma-separated allowlist of Google emails (empty = allow all) |

---

## Security Considerations

1. **Session cookies** use `httpOnly`, `sameSite: lax`, and `secure` (in production) flags
2. **Email allowlist** prevents unauthorized Google accounts from logging in
3. **Multi-tenancy** ensures users can only access their own monitors
4. **No client-side tokens** — sessions are server-side, reducing XSS risk
5. **CSRF** — `sameSite: lax` cookies provide baseline CSRF protection; POST-only logout adds further safety
6. **Session expiry** — 7-day max age with server-side cleanup of expired sessions

---

## Migration Strategy for Existing Data

If there are existing monitors in the database (created before auth was added):

- `user_id` column is added as nullable (`ALTER TABLE` doesn't support `NOT NULL` with no default in SQLite)
- Existing monitors with `user_id = NULL` will be "unowned"
- Options:
  1. Assign them to the first user who logs in (via a one-time migration script)
  2. Leave them inaccessible until manually assigned
  3. Create an admin endpoint to claim orphaned monitors

Recommended: Option 1 — assign orphaned monitors to the first admin user on first login.

---

## Execution Order

1. Phase 2 — Install dependencies
2. Phase 1 — Database migration
3. Phase 3 — Configuration
4. Phase 4 — Passport setup
5. Phase 5 — Auth routes
6. Phase 6 — Auth middleware
7. Phase 7 — Server wiring
8. Phase 8 — Multi-tenancy route updates
9. Phase 9 — Frontend changes
10. Phase 10 — Google Cloud Console setup (manual/documented)
