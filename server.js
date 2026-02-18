require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const config = require('./src/config');
const db = require('./src/db');
const { dbReady } = require('./src/db');
const passport = require('./src/auth');
const authRouter = require('./src/routes/auth');
const healthRouter = require('./src/routes/health');
const requireAuth = require('./src/middleware/requireAuth');
const monitorsRouter = require('./src/routes/monitors');
const checksRouter = require('./src/routes/checks');
const settingsRouter = require('./src/routes/settings');
const bulkRouter = require('./src/routes/bulk');
const tasksRouter = require('./src/routes/tasks');
const sanityChecksRouter = require('./src/routes/sanityChecks');
const reportRouter = require('./src/routes/report');
const genericMonitorsRouter = require('./src/routes/genericMonitors');

const app = express();

// Trust proxy (Vercel, load balancers) so Express sees correct protocol (https)
app.set('trust proxy', 1);

// On Vercel, ensure DB migrations complete before handling any request
if (process.env.VERCEL) {
  app.use(async (req, res, next) => {
    try {
      await dbReady;
      next();
    } catch (err) {
      console.error('DB init failed:', err);
      res.status(503).json({ error: 'Database not ready' });
    }
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session management — cookie-session (no server-side store needed)
app.use(cookieSession({
  name: 'session',
  secret: config.session.secret,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',
}));

// cookie-session doesn't implement regenerate/save — shim them for Passport 0.6+
app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = (cb) => cb();
  }
  if (req.session && !req.session.save) {
    req.session.save = (cb) => cb();
  }
  next();
});

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Auth routes (public — before requireAuth)
app.use(authRouter);

// Public health check (no auth required — for load balancers)
app.use(healthRouter);

// Public report ingestion — clients push monitoring data here (API key auth, not session)
app.use('/report', reportRouter);

// Protect all API routes
app.use('/api', requireAuth);

app.use('/api/monitors', monitorsRouter);
app.use('/api', checksRouter);
app.use('/api', settingsRouter);
app.use('/api', bulkRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/sanity-checks', sanityChecksRouter);
app.use('/api/generic-monitors', genericMonitorsRouter);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Vercel vs Local ────────────────────────────────────────────────────────

if (process.env.VERCEL) {
  // On Vercel: export the app for the serverless function wrapper.
  // Don't start a server or scheduler — cron handlers take care of scheduling.
  module.exports = app;
} else {
  // Local development: start the server and scheduler
  dbReady.then(() => {
    const scheduler = require('./src/services/scheduler');

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
  });
}
