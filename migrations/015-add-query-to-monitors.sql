-- Store the SQL query from the pulse-client so it's visible in the dashboard
ALTER TABLE sanity_check_monitors ADD COLUMN query TEXT DEFAULT NULL;
