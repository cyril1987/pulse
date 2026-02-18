-- Sanity check monitoring configurations (server-side orchestration)
-- Each row maps a check code on a specific client to thresholds and alerting config
CREATE TABLE IF NOT EXISTS sanity_check_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    client_url TEXT NOT NULL,
    check_type TEXT NOT NULL DEFAULT 'count_zero',
    expected_min INTEGER,
    expected_max INTEGER,
    severity TEXT NOT NULL DEFAULT 'medium',
    frequency_seconds INTEGER NOT NULL DEFAULT 300,
    is_active INTEGER NOT NULL DEFAULT 1,
    group_name TEXT DEFAULT '',
    notify_email TEXT DEFAULT '',
    current_status TEXT NOT NULL DEFAULT 'unknown',
    last_value INTEGER,
    last_checked_at TEXT,
    last_status_change_at TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(code, client_url)
);

-- Results fetched from clients and stored on server for history and alerting
CREATE TABLE IF NOT EXISTS sanity_check_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id INTEGER NOT NULL REFERENCES sanity_check_monitors(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    status TEXT NOT NULL,
    actual_value INTEGER,
    previous_value INTEGER,
    value_changed INTEGER NOT NULL DEFAULT 0,
    execution_time_ms INTEGER,
    error_message TEXT,
    checked_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_scm_code ON sanity_check_monitors(code);
CREATE INDEX IF NOT EXISTS idx_scm_client_url ON sanity_check_monitors(client_url);
CREATE INDEX IF NOT EXISTS idx_scm_is_active ON sanity_check_monitors(is_active);
CREATE INDEX IF NOT EXISTS idx_scm_group_name ON sanity_check_monitors(group_name);
CREATE INDEX IF NOT EXISTS idx_scr_monitor_id ON sanity_check_results(monitor_id);
CREATE INDEX IF NOT EXISTS idx_scr_sc_code ON sanity_check_results(code);
CREATE INDEX IF NOT EXISTS idx_scr_sc_checked_at ON sanity_check_results(checked_at);
CREATE INDEX IF NOT EXISTS idx_scr_monitor_checked ON sanity_check_results(monitor_id, checked_at);
