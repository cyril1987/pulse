require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const config = require('./src/config');
const db = require('./src/db');
const passport = require('./src/auth');
const scheduler = require('./src/services/scheduler');
const authRouter = require('./src/routes/auth');
const healthRouter = require('./src/routes/health');
const requireAuth = require('./src/middleware/requireAuth');
const monitorsRouter = require('./src/routes/monitors');
const checksRouter = require('./src/routes/checks');
const settingsRouter = require('./src/routes/settings');
const bulkRouter = require('./src/routes/bulk');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session management
app.use(session({
  store: new SqliteStore({
    client: db,
    expired: { clear: true, intervalMs: 900000 },
  }),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Auth routes (public — before requireAuth)
app.use(authRouter);

// Public health check (no auth required — for load balancers)
app.use(healthRouter);

// Protect all API routes
app.use('/api', requireAuth);

app.use('/api/monitors', monitorsRouter);
app.use('/api', checksRouter);
app.use('/api', settingsRouter);
app.use('/api', bulkRouter);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`iConcile Pulse running on http://0.0.0.0:${config.port}`);
  scheduler.start();
});

process.on('SIGTERM', () => {
  scheduler.stop();
  server.close();
});

process.on('SIGINT', () => {
  scheduler.stop();
  server.close();
});
