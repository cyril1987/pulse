-- Data Check Environments: environment-level configuration
CREATE TABLE IF NOT EXISTS data_check_environments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_url TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    primary_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    frequency_seconds INTEGER NOT NULL DEFAULT 300,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed "Data Check" category if it doesn't exist
INSERT OR IGNORE INTO task_categories (name, color) VALUES ('Data Check', '#3b82f6');

-- Backfill: create environments from existing monitors' distinct client_url values
INSERT OR IGNORE INTO data_check_environments (client_url, name, frequency_seconds)
SELECT
    client_url,
    UPPER(SUBSTR(
        REPLACE(REPLACE(client_url, 'https://', ''), 'http://', ''),
        1,
        CASE
            WHEN INSTR(REPLACE(REPLACE(client_url, 'https://', ''), 'http://', ''), '.') > 0
            THEN INSTR(REPLACE(REPLACE(client_url, 'https://', ''), 'http://', ''), '.') - 1
            ELSE LENGTH(REPLACE(REPLACE(client_url, 'https://', ''), 'http://', ''))
        END
    )),
    MIN(frequency_seconds)
FROM sanity_check_monitors
WHERE client_url IS NOT NULL AND client_url != ''
GROUP BY client_url;
