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

-- Sessions table is created automatically by better-sqlite3-session-store

-- Add user_id to monitors for multi-tenancy
-- (nullable so existing monitors are preserved as unowned)
ALTER TABLE monitors ADD COLUMN user_id INTEGER REFERENCES users(id);
