const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateTask } = require('../middleware/validateTask');
const jiraService = require('../services/jiraService');
const { notifyAssignment, notifyStatusChange } = require('../services/taskNotifier');

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    source: row.source,
    sourceRef: row.source_ref || null,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date || null,
    assignedTo: row.assigned_to || null,
    assignedToName: row.assigned_to_name || null,
    assignedToAvatar: row.assigned_to_avatar || null,
    createdBy: row.created_by,
    createdByName: row.created_by_name || null,
    categoryId: row.category_id || null,
    categoryName: row.category_name || null,
    categoryColor: row.category_color || null,
    parentTaskId: row.parent_task_id || null,
    parentTaskTitle: row.parent_task_title || null,
    isRecurringTemplate: row.is_recurring_template === 1,
    recurrencePattern: row.recurrence_pattern ? JSON.parse(row.recurrence_pattern) : null,
    recurrenceNextAt: row.recurrence_next_at || null,
    recurrenceEndAt: row.recurrence_end_at || null,
    recurringTemplateId: row.recurring_template_id || null,
    subtaskCount: row.subtask_count || 0,
    jiraKey: row.jira_key || null,
    jiraStatus: row.jira_status || null,
    jiraSummary: row.jira_summary || null,
    jiraAssignee: row.jira_assignee || null,
    jiraDueDate: row.jira_due_date || null,
    jiraUrl: row.jira_url || null,
    jiraSprint: row.jira_sprint ? (() => { try { return JSON.parse(row.jira_sprint); } catch { return null; } })() : null,
    jiraSyncedAt: row.jira_synced_at || null,
    isPrivate: row.is_private === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function formatComment(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    userName: row.user_name || null,
    userAvatar: row.user_avatar || null,
    body: row.body,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
  };
}

async function buildTaskQuery(conditions, params, { limit, offset, sort }) {
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let orderBy;
  switch (sort) {
    case 'due_date':
      orderBy = 't.due_date IS NULL, t.due_date ASC, t.created_at DESC';
      break;
    case 'priority':
      orderBy = "CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, t.created_at DESC";
      break;
    case 'status':
      orderBy = "CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 WHEN 'cancelled' THEN 3 END, t.created_at DESC";
      break;
    default:
      orderBy = 't.created_at DESC';
  }

  const tasksQuery = `
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count,
      pt.title AS parent_task_title
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    LEFT JOIN tasks pt ON t.parent_task_id = pt.id
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;

  const countQuery = `SELECT COUNT(*) AS count FROM tasks t ${where}`;

  const tasks = await db.prepare(tasksQuery).all(...params, limit, offset);
  const total = await db.prepare(countQuery).get(...params);

  return { tasks: tasks.map(formatTask), total: total.count, limit, offset };
}

function applyFilters(req) {
  const { status, priority, category, source, dueBefore, dueAfter, search, parentTaskId, hideCompleted } = req.query;
  const conditions = ['t.is_recurring_template = 0'];
  const params = [];

  if (hideCompleted === '1') {
    conditions.push("t.status NOT IN ('done', 'cancelled')");
  }
  if (status) {
    conditions.push('t.status = ?'); params.push(status);
  }
  if (priority) { conditions.push('t.priority = ?'); params.push(priority); }
  if (category) { conditions.push('t.category_id = ?'); params.push(parseInt(category, 10)); }
  if (source) { conditions.push('t.source = ?'); params.push(source); }
  if (dueBefore) { conditions.push('t.due_date <= ?'); params.push(dueBefore); }
  if (dueAfter) { conditions.push('t.due_date >= ?'); params.push(dueAfter); }
  if (parentTaskId) {
    conditions.push('t.parent_task_id = ?'); params.push(parseInt(parentTaskId, 10));
  } else if (!search) {
    // When not searching and not explicitly requesting subtasks, hide subtasks from main list
    conditions.push('t.parent_task_id IS NULL');
  }
  if (search) {
    conditions.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const offset = parseInt(req.query.offset || '0', 10);
  const sort = req.query.sort || 'created';

  return { conditions, params, limit, offset, sort };
}

async function addSystemComment(taskId, userId, body) {
  await db.prepare(
    'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)'
  ).run(taskId, userId, body);
}

function computeNextOccurrence(pattern, currentDateStr) {
  const d = new Date(currentDateStr);
  const interval = pattern.interval || 1;

  switch (pattern.type) {
    case 'daily':
      d.setDate(d.getDate() + interval);
      break;
    case 'weekly':
      d.setDate(d.getDate() + (7 * interval));
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + interval);
      if (pattern.dayOfMonth) d.setDate(Math.min(pattern.dayOfMonth, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + interval);
      if (pattern.month) d.setMonth(pattern.month - 1);
      if (pattern.dayOfMonth) d.setDate(Math.min(pattern.dayOfMonth, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      break;
  }
  return d.toISOString();
}

// ─── Category Routes ────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  const categories = await db.prepare('SELECT * FROM task_categories ORDER BY name').all();
  res.json(categories.map(c => ({ id: c.id, name: c.name, color: c.color, createdAt: c.created_at })));
});

router.post('/categories', async (req, res) => {
  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ errors: ['Category name is required'] });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ errors: ['Category name must be 100 characters or fewer'] });
  }

  const existing = await db.prepare('SELECT id FROM task_categories WHERE name = ?').get(name.trim());
  if (existing) {
    return res.status(400).json({ errors: ['A category with this name already exists'] });
  }

  const result = await db.prepare(
    'INSERT INTO task_categories (name, color) VALUES (?, ?)'
  ).run(name.trim(), color || '#2a9d8f');

  const category = await db.prepare('SELECT * FROM task_categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ id: category.id, name: category.name, color: category.color, createdAt: category.created_at });
});

router.put('/categories/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM task_categories WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Category not found' });
  }

  const { name, color } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ errors: ['Category name is required'] });
  }

  const duplicate = await db.prepare('SELECT id FROM task_categories WHERE name = ? AND id != ?').get(name.trim(), req.params.id);
  if (duplicate) {
    return res.status(400).json({ errors: ['A category with this name already exists'] });
  }

  await db.prepare('UPDATE task_categories SET name = ?, color = ? WHERE id = ?').run(
    name.trim(), color || existing.color, req.params.id
  );

  const category = await db.prepare('SELECT * FROM task_categories WHERE id = ?').get(req.params.id);
  res.json({ id: category.id, name: category.name, color: category.color, createdAt: category.created_at });
});

router.delete('/categories/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM task_categories WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Category not found' });
  }

  await db.prepare('UPDATE tasks SET category_id = NULL WHERE category_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM task_categories WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ─── Users Route (for assignment dropdowns) ─────────────────────────────────

router.get('/users', async (req, res) => {
  const users = await db.prepare('SELECT id, email, name, avatar_url FROM users ORDER BY name').all();
  res.json(users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatar_url || null,
  })));
});

// ─── Stats ──────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const view = req.query.view;
  let userFilter = '';
  const params = [];

  if (view === 'unassigned') {
    userFilter = 'AND assigned_to IS NULL';
  } else if (view !== 'all') {
    userFilter = 'AND assigned_to = ?';
    params.push(req.user.id);
  }

  const counts = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'todo' THEN 1 ELSE 0 END) AS todo,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
      SUM(CASE WHEN due_date < date('now') AND status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS overdue
    FROM tasks
    WHERE is_recurring_template = 0 AND parent_task_id IS NULL ${userFilter}
  `).get(...params);

  const byPriority = await db.prepare(`
    SELECT priority, COUNT(*) AS count
    FROM tasks
    WHERE is_recurring_template = 0 AND parent_task_id IS NULL AND status NOT IN ('done', 'cancelled') ${userFilter}
    GROUP BY priority
  `).all(...params);

  const upcoming = await db.prepare(`
    SELECT id, title, due_date, priority, status, assigned_to,
      (SELECT name FROM users WHERE id = tasks.assigned_to) AS assigned_to_name
    FROM tasks
    WHERE is_recurring_template = 0
      AND parent_task_id IS NULL
      AND status NOT IN ('done', 'cancelled')
      AND due_date IS NOT NULL
      AND due_date >= date('now')
      AND due_date <= date('now', '+7 days')
      ${userFilter}
    ORDER BY due_date ASC
    LIMIT 10
  `).all(...params);

  res.json({
    total: counts.total || 0,
    todo: counts.todo || 0,
    inProgress: counts.in_progress || 0,
    done: counts.done || 0,
    cancelled: counts.cancelled || 0,
    overdue: counts.overdue || 0,
    byPriority: byPriority.reduce((acc, r) => { acc[r.priority] = r.count; return acc; }, {}),
    upcoming: upcoming.map(t => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      priority: t.priority,
      status: t.status,
      assignedTo: t.assigned_to,
      assignedToName: t.assigned_to_name,
    })),
  });
});

// ─── Recurring Templates ────────────────────────────────────────────────────

router.get('/recurring', async (req, res) => {
  const templates = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.recurring_template_id = t.id) AS instance_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.is_recurring_template = 1
    ORDER BY t.created_at DESC
  `).all();

  res.json(templates.map(row => {
    const t = formatTask(row);
    t.instanceCount = row.instance_count || 0;
    return t;
  }));
});

// ─── My Tasks ───────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { conditions, params, limit, offset, sort } = applyFilters(req);
  conditions.push('t.assigned_to = ?');
  params.push(req.user.id);

  res.json(await buildTaskQuery(conditions, params, { limit, offset, sort }));
});

// ─── Unassigned Tasks ───────────────────────────────────────────────────────

router.get('/unassigned', async (req, res) => {
  const { conditions, params, limit, offset, sort } = applyFilters(req);
  conditions.push('t.assigned_to IS NULL');

  // Private tasks: only visible to the creator
  conditions.push('(t.is_private = 0 OR t.created_by = ?)');
  params.push(req.user.id);

  res.json(await buildTaskQuery(conditions, params, { limit, offset, sort }));
});

// ─── All Tasks ──────────────────────────────────────────────────────────────

router.get('/all', async (req, res) => {
  const { conditions, params, limit, offset, sort } = applyFilters(req);

  // Private tasks: only visible to the owner (assigned_to or created_by)
  conditions.push('(t.is_private = 0 OR t.assigned_to = ? OR t.created_by = ?)');
  params.push(req.user.id, req.user.id);

  if (req.query.assignedTo) {
    conditions.push('t.assigned_to = ?');
    params.push(parseInt(req.query.assignedTo, 10));
  }
  if (req.query.createdBy) {
    conditions.push('t.created_by = ?');
    params.push(parseInt(req.query.createdBy, 10));
  }

  res.json(await buildTaskQuery(conditions, params, { limit, offset, sort }));
});

// ─── Jira Search (must be before /:id to avoid matching "jira" as an ID) ──

router.get('/jira/search', async (req, res) => {
  const { q } = req.query;
  if (!q || typeof q !== 'string' || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query (q) is required' });
  }

  if (!jiraService.isConfigured()) {
    return res.status(400).json({ error: 'Jira integration is not configured' });
  }

  try {
    const issues = await jiraService.searchIssues(q.trim());
    res.json(issues);
  } catch (err) {
    console.error(`[JIRA] Search error: ${err.message}`);
    res.status(502).json({ error: 'Failed to search Jira', details: err.message });
  }
});

// ─── Single Task ────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(formatTask(task));
});

// ─── Create Task ────────────────────────────────────────────────────────────

router.post('/', validateTask, async (req, res) => {
  const {
    title, description, source, sourceRef, priority, status,
    dueDate, assignedTo, categoryId, parentTaskId,
    recurrencePattern, recurrenceEndAt, isPrivate,
  } = req.body;

  const isTemplate = recurrencePattern ? 1 : 0;
  let recurrenceNextAt = null;

  if (recurrencePattern) {
    // Compute the first occurrence: start from dueDate or today
    const startDate = dueDate || new Date().toISOString().split('T')[0];
    recurrenceNextAt = new Date(startDate + 'T00:00:00Z').toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  }

  const taskId = await db.transaction(async (tx) => {
    const result = await tx.prepare(`
      INSERT INTO tasks (
        title, description, source, source_ref, priority, status, due_date,
        assigned_to, created_by, category_id, parent_task_id,
        is_recurring_template, recurrence_pattern, recurrence_next_at, recurrence_end_at,
        is_private
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      title.trim(),
      description || '',
      source || 'manual',
      sourceRef || null,
      priority || 'medium',
      isTemplate ? 'todo' : (status || 'todo'),
      isTemplate ? null : (dueDate || null),
      assignedTo ? parseInt(assignedTo, 10) : null,
      req.user.id,
      categoryId ? parseInt(categoryId, 10) : null,
      parentTaskId ? parseInt(parentTaskId, 10) : null,
      isTemplate,
      recurrencePattern ? JSON.stringify(recurrencePattern) : null,
      recurrenceNextAt,
      recurrenceEndAt || null,
      isPrivate ? 1 : 0
    );

    const taskId = result.lastInsertRowid;
    await tx.prepare(
      'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)'
    ).run(taskId, req.user.id, `${req.user.name} created this task`);

    if (assignedTo && parseInt(assignedTo, 10) !== req.user.id) {
      const assignee = await tx.prepare('SELECT name FROM users WHERE id = ?').get(parseInt(assignedTo, 10));
      if (assignee) {
        await tx.prepare(
          'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)'
        ).run(taskId, req.user.id, `${req.user.name} assigned this task to ${assignee.name}`);
      }
    }

    return taskId;
  });

  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(taskId);

  // Fire-and-forget: notify assignee (don't block response)
  if (assignedTo && parseInt(assignedTo, 10) !== req.user.id) {
    const assignedUser = await db.prepare('SELECT id, email, name FROM users WHERE id = ?')
      .get(parseInt(assignedTo, 10));
    const freshTask = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    notifyAssignment(freshTask, assignedUser, req.user.name).catch(err => {
      console.error('[TASK-NOTIFY] Assignment notification error:', err.message);
    });
  }

  res.status(201).json(formatTask(task));
});

// ─── Update Task ────────────────────────────────────────────────────────────

router.put('/:id', validateTask, async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const {
    title, description, source, sourceRef, priority, status,
    dueDate, assignedTo, categoryId, parentTaskId,
    recurrencePattern, recurrenceEndAt, isPrivate,
  } = req.body;

  const isTemplate = existing.is_recurring_template;
  let recurrenceNextAt = existing.recurrence_next_at;

  if (isTemplate && recurrencePattern) {
    const startDate = dueDate || new Date().toISOString().split('T')[0];
    recurrenceNextAt = new Date(startDate + 'T00:00:00Z').toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  }

  await db.transaction(async (tx) => {
    await tx.prepare(`
      UPDATE tasks SET
        title = ?, description = ?, source = ?, source_ref = ?, priority = ?,
        status = ?, due_date = ?, assigned_to = ?, category_id = ?, parent_task_id = ?,
        recurrence_pattern = ?, recurrence_next_at = ?, recurrence_end_at = ?,
        is_private = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      title.trim(),
      description || '',
      source || existing.source,
      sourceRef || null,
      priority || existing.priority,
      status || existing.status,
      isTemplate ? null : (dueDate || null),
      assignedTo ? parseInt(assignedTo, 10) : null,
      categoryId ? parseInt(categoryId, 10) : null,
      parentTaskId ? parseInt(parentTaskId, 10) : null,
      recurrencePattern ? JSON.stringify(recurrencePattern) : existing.recurrence_pattern,
      recurrenceNextAt,
      recurrenceEndAt || existing.recurrence_end_at,
      isPrivate !== undefined ? (isPrivate ? 1 : 0) : existing.is_private,
      req.params.id
    );

    // Track assignment change
    const newAssignedTo = assignedTo ? parseInt(assignedTo, 10) : null;
    if (newAssignedTo !== existing.assigned_to) {
      const assignee = newAssignedTo ? await tx.prepare('SELECT name FROM users WHERE id = ?').get(newAssignedTo) : null;
      const msg = assignee
        ? `${req.user.name} assigned this task to ${assignee.name}`
        : `${req.user.name} unassigned this task`;
      await tx.prepare(
        'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)'
      ).run(existing.id, req.user.id, msg);
    }
  });

  // Fire-and-forget: notify new assignee on reassignment
  const newAssignedTo = assignedTo ? parseInt(assignedTo, 10) : null;
  if (newAssignedTo && newAssignedTo !== existing.assigned_to && newAssignedTo !== req.user.id) {
    const assignedUser = await db.prepare('SELECT id, email, name FROM users WHERE id = ?')
      .get(newAssignedTo);
    const freshTask = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    notifyAssignment(freshTask, assignedUser, req.user.name).catch(err => {
      console.error('[TASK-NOTIFY] Assignment notification error:', err.message);
    });
  }

  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  res.json(formatTask(task));
});

// ─── Delete Task ────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  await db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ─── Toggle Private ──────────────────────────────────────────────────────────

router.post('/:id/toggle-private', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const newPrivate = existing.is_private === 1 ? 0 : 1;
  await db.prepare('UPDATE tasks SET is_private = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newPrivate, req.params.id);

  await addSystemComment(existing.id, req.user.id,
    newPrivate ? `${req.user.name} marked this task as private` : `${req.user.name} removed private flag from this task`
  );

  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  res.json(formatTask(task));
});

// ─── Transition Status ──────────────────────────────────────────────────────

router.post('/:id/transition', async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['todo', 'in_progress', 'done', 'cancelled'];

  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ errors: [`Status must be one of: ${validStatuses.join(', ')}`] });
  }

  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (existing.status === status) {
    return res.status(400).json({ errors: ['Task is already in this status'] });
  }

  await db.transaction(async (tx) => {
    await tx.prepare(
      "UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(status, req.params.id);

    const oldLabel = existing.status.replace('_', ' ');
    const newLabel = status.replace('_', ' ');
    await tx.prepare(
      'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)'
    ).run(
      existing.id,
      req.user.id,
      `${req.user.name} changed status from ${oldLabel} to ${newLabel}`
    );
  });

  // Fire-and-forget: notify assignee about status change
  notifyStatusChange(existing, existing.status, status, req.user.name).catch(err => {
    console.error('[TASK-NOTIFY] Status change notification error:', err.message);
  });

  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  res.json(formatTask(task));
});

// ─── Jira Link/Unlink/Sync ──────────────────────────────────────────────────

router.post('/:id/link-jira', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { jiraKey } = req.body;
  if (!jiraKey || typeof jiraKey !== 'string') {
    return res.status(400).json({ errors: ['Jira issue key is required'] });
  }

  const key = jiraKey.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) {
    return res.status(400).json({ errors: ['Jira key must be in the format PROJECT-123'] });
  }

  if (!jiraService.isConfigured()) {
    return res.status(400).json({ error: 'Jira integration is not configured' });
  }

  try {
    const issue = await jiraService.fetchIssue(key);

    await db.prepare(`
      UPDATE tasks SET
        jira_key = ?, jira_status = ?, jira_summary = ?, jira_assignee = ?,
        jira_due_date = ?, jira_url = ?, jira_sprint = ?, jira_synced_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      issue.key, issue.status, issue.summary, issue.assignee,
      issue.dueDate, issue.url, issue.sprint, req.params.id
    );

    await addSystemComment(
      existing.id, req.user.id,
      `${req.user.name} linked Jira issue ${issue.key} (status: ${issue.status})`
    );

    const task = await db.prepare(`
      SELECT t.*,
        u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
        u2.name AS created_by_name,
        c.name AS category_name, c.color AS category_color,
        (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
      FROM tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.created_by = u2.id
      LEFT JOIN task_categories c ON t.category_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    res.json(formatTask(task));
  } catch (err) {
    console.error(`[JIRA] Link error for ${key}: ${err.message}`);
    res.status(502).json({ error: 'Failed to fetch Jira issue', details: err.message });
  }
});

router.delete('/:id/link-jira', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (!existing.jira_key) {
    return res.status(400).json({ error: 'Task has no linked Jira issue' });
  }

  const oldKey = existing.jira_key;

  await db.prepare(`
    UPDATE tasks SET
      jira_key = NULL, jira_status = NULL, jira_summary = NULL,
      jira_assignee = NULL, jira_due_date = NULL, jira_url = NULL,
      jira_synced_at = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);

  await addSystemComment(
    existing.id, req.user.id,
    `${req.user.name} unlinked Jira issue ${oldKey}`
  );

  const task = await db.prepare(`
    SELECT t.*,
      u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
      u2.name AS created_by_name,
      c.name AS category_name, c.color AS category_color,
      (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
    FROM tasks t
    LEFT JOIN users u1 ON t.assigned_to = u1.id
    LEFT JOIN users u2 ON t.created_by = u2.id
    LEFT JOIN task_categories c ON t.category_id = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  res.json(formatTask(task));
});

router.post('/:id/sync-jira', async (req, res) => {
  const existing = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (!existing.jira_key) {
    return res.status(400).json({ error: 'Task has no linked Jira issue' });
  }

  if (!jiraService.isConfigured()) {
    return res.status(400).json({ error: 'Jira integration is not configured' });
  }

  try {
    const issue = await jiraService.fetchIssue(existing.jira_key);
    const oldStatus = existing.jira_status;

    await db.prepare(`
      UPDATE tasks SET
        jira_status = ?, jira_summary = ?, jira_assignee = ?,
        jira_due_date = ?, jira_url = ?, jira_sprint = ?, jira_synced_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      issue.status, issue.summary, issue.assignee,
      issue.dueDate, issue.url, issue.sprint, req.params.id
    );

    if (oldStatus && oldStatus !== issue.status) {
      await addSystemComment(
        existing.id, req.user.id,
        `Jira status changed: ${oldStatus} → ${issue.status}`
      );
    }

    const task = await db.prepare(`
      SELECT t.*,
        u1.name AS assigned_to_name, u1.avatar_url AS assigned_to_avatar,
        u2.name AS created_by_name,
        c.name AS category_name, c.color AS category_color,
        (SELECT COUNT(*) FROM tasks st WHERE st.parent_task_id = t.id) AS subtask_count
      FROM tasks t
      LEFT JOIN users u1 ON t.assigned_to = u1.id
      LEFT JOIN users u2 ON t.created_by = u2.id
      LEFT JOIN task_categories c ON t.category_id = c.id
      WHERE t.id = ?
    `).get(req.params.id);

    res.json(formatTask(task));
  } catch (err) {
    console.error(`[JIRA] Sync error for ${existing.jira_key}: ${err.message}`);
    res.status(502).json({ error: 'Failed to sync Jira issue', details: err.message });
  }
});

// ─── Comments ───────────────────────────────────────────────────────────────

router.get('/:id/comments', async (req, res) => {
  const existing = await db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const comments = await db.prepare(`
    SELECT tc.*, u.name AS user_name, u.avatar_url AS user_avatar
    FROM task_comments tc
    LEFT JOIN users u ON tc.user_id = u.id
    WHERE tc.task_id = ?
    ORDER BY tc.created_at ASC
  `).all(req.params.id);

  res.json(comments.map(formatComment));
});

router.post('/:id/comments', async (req, res) => {
  const existing = await db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Task not found' });
  }

  const { body } = req.body;
  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({ errors: ['Comment body is required'] });
  }
  if (body.length > 5000) {
    return res.status(400).json({ errors: ['Comment must be 5000 characters or fewer'] });
  }

  const result = await db.prepare(
    'INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 0)'
  ).run(req.params.id, req.user.id, body.trim());

  const comment = await db.prepare(`
    SELECT tc.*, u.name AS user_name, u.avatar_url AS user_avatar
    FROM task_comments tc
    LEFT JOIN users u ON tc.user_id = u.id
    WHERE tc.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(formatComment(comment));
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  const comment = await db.prepare('SELECT * FROM task_comments WHERE id = ? AND task_id = ?').get(
    req.params.commentId, req.params.id
  );

  if (!comment) {
    return res.status(404).json({ error: 'Comment not found' });
  }

  if (comment.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own comments' });
  }

  await db.prepare('DELETE FROM task_comments WHERE id = ?').run(req.params.commentId);
  res.status(204).end();
});

module.exports = router;
