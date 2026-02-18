-- User notification preferences (per-user opt-in/out for each notification type)
CREATE TABLE IF NOT EXISTS user_notification_prefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    monitor_alerts INTEGER NOT NULL DEFAULT 1,
    task_assigned INTEGER NOT NULL DEFAULT 1,
    task_status_change INTEGER NOT NULL DEFAULT 1,
    task_due_soon INTEGER NOT NULL DEFAULT 1,
    task_overdue INTEGER NOT NULL DEFAULT 1,
    daily_digest INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notification_prefs_user_id ON user_notification_prefs(user_id);
