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

module.exports = db;
