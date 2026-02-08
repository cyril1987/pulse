module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  dbPath: process.env.DB_PATH || './data/urlmonitor.db',
  smtp: {
    host: process.env.SMTP_HOST || 'localhost',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'iConcile Pulse <pulse@iconcile.com>',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    callbackUrl: process.env.MICROSOFT_CALLBACK_URL || '/auth/microsoft/callback',
    tenant: process.env.MICROSOFT_TENANT || 'common',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
  },
  allowedEmails: process.env.ALLOWED_EMAILS
    ? process.env.ALLOWED_EMAILS.split(',').map(e => e.trim().toLowerCase())
    : [],
  checkRetentionDays: parseInt(process.env.CHECK_RETENTION_DAYS || '30', 10),
  schedulerIntervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || '15000', 10),
  failuresBeforeAlert: parseInt(process.env.FAILURES_BEFORE_ALERT || '2', 10),
};
