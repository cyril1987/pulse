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

// Drop the incorrectly-created sessions table (if it has wrong schema)
// so better-sqlite3-session-store can recreate it with the correct columns
try {
  const cols = db.prepare("PRAGMA table_info(sessions)").all().map(c => c.name);
  if (cols.includes('expired') && !cols.includes('expire')) {
    db.exec('DROP TABLE sessions');
  }
} catch (e) {
  // ignore
}

module.exports = db;
