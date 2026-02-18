CREATE TABLE IF NOT EXISTS generic_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    group_name TEXT,
    current_status TEXT NOT NULL DEFAULT 'unknown',
    environment_info TEXT,
    last_reported_at TEXT,
    notify_email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generic_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES generic_monitors(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unknown',
    metrics TEXT,
    message TEXT,
    reported_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generic_reports_monitor_id ON generic_reports(monitor_id);
CREATE INDEX IF NOT EXISTS idx_generic_reports_reported_at ON generic_reports(monitor_id, reported_at);
