CREATE TABLE IF NOT EXISTS monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    frequency_seconds INTEGER NOT NULL DEFAULT 300,
    expected_status INTEGER NOT NULL DEFAULT 200,
    timeout_ms INTEGER NOT NULL DEFAULT 10000,
    notify_email TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    current_status TEXT NOT NULL DEFAULT 'unknown',
    last_checked_at TEXT,
    last_status_change_at TEXT,
    paused_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    status_code INTEGER,
    response_time_ms INTEGER,
    is_success INTEGER NOT NULL,
    error_message TEXT,
    checked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_checks_monitor_id ON checks(monitor_id);
CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(monitor_id, checked_at);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    email TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_monitor_id ON notifications(monitor_id);
