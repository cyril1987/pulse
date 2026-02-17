const config = require('../config');
const db = require('../db');

// ─── Helpers ────────────────────────────────────────────────────────────────

function isConfigured() {
  return !!(config.jira.baseUrl && config.jira.userEmail && config.jira.apiToken);
}

function authHeaders() {
  const token = Buffer.from(`${config.jira.userEmail}:${config.jira.apiToken}`).toString('base64');
  return {
    'Authorization': `Basic ${token}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

async function jiraFetch(path, options = {}) {
  if (!isConfigured()) {
    throw new Error('Jira integration is not configured');
  }

  const url = `${config.jira.baseUrl}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Jira API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ─── Public Methods ─────────────────────────────────────────────────────────

/**
 * Test the Jira connection by fetching the current user's profile.
 */
async function testConnection() {
  const data = await jiraFetch('/rest/api/3/myself');
  return {
    success: true,
    displayName: data.displayName,
    emailAddress: data.emailAddress,
    accountId: data.accountId,
    serverUrl: config.jira.baseUrl,
  };
}

/**
 * Fetch a single Jira issue by key (e.g. "PROJ-123").
 * Returns normalized data with status, summary, assignee, due date, and URL.
 */
async function fetchIssue(issueKey) {
  const data = await jiraFetch(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=status,summary,issuetype,priority,assignee,duedate`
  );

  const fields = data.fields || {};
  return {
    key: data.key,
    status: fields.status?.name || 'Unknown',
    statusCategory: fields.status?.statusCategory?.key || 'undefined',
    summary: fields.summary || '',
    issueType: fields.issuetype?.name || null,
    priority: fields.priority?.name || null,
    assignee: fields.assignee?.displayName || null,
    assigneeAvatar: fields.assignee?.avatarUrls?.['24x24'] || null,
    dueDate: fields.duedate || null,
    url: `${config.jira.baseUrl}/browse/${data.key}`,
  };
}

/**
 * Search Jira issues by text query or JQL.
 * Used for autocomplete when linking issues.
 */
async function searchIssues(query, maxResults = 10) {
  // If it looks like a Jira key (e.g. PROJ-123), search by key
  const isKey = /^[A-Z][A-Z0-9_]+-\d+$/i.test(query);
  const jql = isKey
    ? `key = "${query.toUpperCase()}"`
    : `summary ~ "${query.replace(/"/g, '\\"')}" OR key = "${query.toUpperCase()}" ORDER BY updated DESC`;

  const data = await jiraFetch(
    `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=status,summary,assignee,duedate`
  );

  return (data.issues || []).map(issue => ({
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || 'Unknown',
    statusCategory: issue.fields?.status?.statusCategory?.key || 'undefined',
    assignee: issue.fields?.assignee?.displayName || null,
    dueDate: issue.fields?.duedate || null,
    url: `${config.jira.baseUrl}/browse/${issue.key}`,
  }));
}

// ─── DB sync ────────────────────────────────────────────────────────────────

/**
 * Sync all Jira-linked tasks with latest data from Jira API.
 * Called periodically by the scheduler (every 5 minutes).
 */
async function syncAllJiraTasks() {
  if (!isConfigured()) return;

  const tasks = await db.prepare(`
    SELECT id, jira_key, jira_status FROM tasks WHERE jira_key IS NOT NULL
  `).all();
  if (tasks.length === 0) return;

  console.log(`[JIRA] Syncing ${tasks.length} linked task(s)`);

  // Process in batches of 10 to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < tasks.length; i += batchSize) {
    const batch = tasks.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (task) => {
        try {
          const issue = await fetchIssue(task.jira_key);
          const oldStatus = task.jira_status;

          await db.prepare(`
            UPDATE tasks
            SET jira_status = ?, jira_summary = ?, jira_assignee = ?, jira_due_date = ?,
                jira_url = ?, jira_synced_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ?
          `).run(
            issue.status,
            issue.summary,
            issue.assignee,
            issue.dueDate,
            issue.url,
            task.id
          );

          if (oldStatus && oldStatus !== issue.status) {
            console.log(`[JIRA] ${task.jira_key}: "${oldStatus}" -> "${issue.status}"`);
          }
        } catch (err) {
          console.error(`[JIRA] Failed to sync ${task.jira_key}: ${err.message}`);
        }
      })
    );

    // Small delay between batches to be kind to Jira API
    if (i + batchSize < tasks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

module.exports = {
  isConfigured,
  testConnection,
  fetchIssue,
  searchIssues,
  syncAllJiraTasks,
};
