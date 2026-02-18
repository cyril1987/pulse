-- Add Jira sprint column to tasks
ALTER TABLE tasks ADD COLUMN jira_sprint TEXT DEFAULT NULL;
