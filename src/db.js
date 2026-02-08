const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '001-initial-schema.sql'),
  'utf8'
);
db.exec(schema);

// Run incremental migrations (safe to re-run)
try {
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '002-add-paused-until.sql'), 'utf8'));
} catch (e) {
  // Column already exists — ignore
}

try {
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '003-add-users.sql'), 'utf8'));
} catch (e) {
  // Tables/columns already exist — ignore
}

// Migration 004 drops and recreates the users table, which requires
// temporarily disabling foreign keys (monitors.user_id references users.id)
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!cols.includes('microsoft_id')) {
    db.pragma('foreign_keys = OFF');
    db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '004-add-microsoft-sso.sql'), 'utf8'));
    db.pragma('foreign_keys = ON');
  }
} catch (e) {
  db.pragma('foreign_keys = ON');
  // Migration already applied — ignore
}

// Ensure sessions table has the correct schema expected by better-sqlite3-session-store.
// The library expects columns: (sid, sess, expire). If the table exists with a different
// schema (e.g. 'expired' instead of 'expire'), drop it so the library can recreate it.
try {
  const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
  if (cols.length > 0 && !cols.includes('expire')) {
    db.exec('DROP TABLE sessions');
  }
} catch (e) {
  // Table doesn't exist yet — that's fine, the session store will create it
}

module.exports = db;
