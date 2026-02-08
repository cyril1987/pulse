const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const scheduler = require('../services/scheduler');
const requireAuth = require('../middleware/requireAuth');

const startedAt = new Date().toISOString();

// Public lightweight health check (for load balancers / uptime monitors)
// Returns 200 if the server and database are reachable
router.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: 'Database unreachable' });
  }
});

// Authenticated detailed health check (full system status)
router.get('/health/details', requireAuth, (req, res) => {
  const checks = {};
  let overall = 'healthy';

  // Database check
  try {
    const dbStart = Date.now();
    db.prepare('SELECT 1').get();
    const dbLatencyMs = Date.now() - dbStart;
    checks.database = { status: 'ok', latencyMs: dbLatencyMs };
  } catch (err) {
    checks.database = { status: 'error', error: err.message };
    overall = 'unhealthy';
  }

  // Monitor stats
  try {
    const totalMonitors = db.prepare('SELECT COUNT(*) as count FROM monitors').get().count;
    const activeMonitors = db.prepare('SELECT COUNT(*) as count FROM monitors WHERE is_active = 1').get().count;
    const pausedMonitors = totalMonitors - activeMonitors;

    const statusCounts = db.prepare(`
      SELECT current_status, COUNT(*) as count FROM monitors GROUP BY current_status
    `).all();

    const byStatus = {};
    for (const row of statusCounts) {
      byStatus[row.current_status] = row.count;
    }

    checks.monitors = {
      status: 'ok',
      total: totalMonitors,
      active: activeMonitors,
      paused: pausedMonitors,
      byStatus,
    };
  } catch (err) {
    checks.monitors = { status: 'error', error: err.message };
    overall = 'degraded';
  }

  // Recent check activity
  try {
    const last5Min = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) as successful,
        ROUND(AVG(response_time_ms), 0) as avgResponseMs
      FROM checks WHERE checked_at > datetime('now', '-5 minutes')
    `).get();

    const last1Hour = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) as successful
      FROM checks WHERE checked_at > datetime('now', '-1 hour')
    `).get();

    const successRate5m = last5Min.total > 0
      ? Math.round((last5Min.successful / last5Min.total) * 10000) / 100
      : null;

    const successRate1h = last1Hour.total > 0
      ? Math.round((last1Hour.successful / last1Hour.total) * 10000) / 100
      : null;

    checks.checks = {
      status: 'ok',
      last5Min: {
        total: last5Min.total,
        successful: last5Min.successful,
        successRate: successRate5m,
        avgResponseMs: last5Min.avgResponseMs,
      },
      last1Hour: {
        total: last1Hour.total,
        successful: last1Hour.successful,
        successRate: successRate1h,
      },
    };
  } catch (err) {
    checks.checks = { status: 'error', error: err.message };
    overall = 'degraded';
  }

  // Scheduler status
  const schedulerStatus = scheduler.getStatus();
  checks.scheduler = {
    status: schedulerStatus.running ? 'ok' : 'error',
    running: schedulerStatus.running,
    intervalMs: schedulerStatus.intervalMs,
    lastTickAt: schedulerStatus.lastTickAt,
    lastTickDurationMs: schedulerStatus.lastTickDurationMs,
    lastTickError: schedulerStatus.lastTickError,
  };
  if (!schedulerStatus.running) overall = 'unhealthy';
  if (schedulerStatus.lastTickError) overall = 'degraded';

  // SMTP configuration
  const smtpConfigured = !!(config.smtp.host && config.smtp.user);
  checks.smtp = {
    status: smtpConfigured ? 'ok' : 'warning',
    configured: smtpConfigured,
    host: config.smtp.host || '(not set)',
  };
  if (!smtpConfigured && overall === 'healthy') overall = 'degraded';

  // Auth providers
  checks.auth = {
    google: { configured: !!(config.google.clientId && config.google.clientSecret) },
    microsoft: { configured: !!(config.microsoft.clientId && config.microsoft.clientSecret) },
  };

  const httpCode = overall === 'unhealthy' ? 503 : 200;
  res.status(httpCode).json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    startedAt,
    version: require('../../package.json').version,
    nodeVersion: process.version,
    memoryUsage: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    checks,
  });
});

module.exports = router;
