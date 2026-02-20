const { sendEmail } = require('./emailSender');
const { taskAssigned, taskStatusChanged, tasksDueSoon, tasksOverdue } = require('./emailTemplates');
const db = require('../db');

// ─── Preference Check ────────────────────────────────────────────────────────

async function shouldNotify(userId, notificationType) {
  if (!userId) return true; // No user context — send anyway

  const prefs = await db.prepare(
    'SELECT * FROM user_notification_prefs WHERE user_id = ?'
  ).get(userId);

  if (!prefs) return true; // No prefs row = use defaults (all enabled)

  switch (notificationType) {
    case 'assigned': return !!prefs.task_assigned;
    case 'status_change': return !!prefs.task_status_change;
    case 'due_soon': return !!prefs.task_due_soon;
    case 'overdue': return !!prefs.task_overdue;
    default: return true;
  }
}

// ─── Notify on task assignment ──────────────────────────────────────────────

async function notifyAssignment(task, assignedUser, assignedByName) {
  if (!assignedUser || !assignedUser.email) return;

  if (!(await shouldNotify(assignedUser.id, 'assigned'))) return;

  const recent = await db.prepare(`
    SELECT COUNT(*) AS count FROM task_notifications
    WHERE task_id = ? AND type = ?
    AND sent_at > datetime('now', '-1 hour')
  `).get(task.id, 'assigned');
  if (recent.count > 0) return;

  const subject = `[TASK] Assigned to you: ${task.title}`;
  const html = taskAssigned({
    recipientName: assignedUser.name,
    taskTitle: task.title,
    priority: task.priority,
    dueDate: task.due_date || null,
    assignedBy: assignedByName,
    source: task.source,
    description: task.description || null,
  });
  const text = [
    `Task: ${task.title}`,
    `Priority: ${task.priority}`,
    `Due Date: ${task.due_date || 'No due date'}`,
    `Assigned By: ${assignedByName}`,
    `Source: ${task.source}`,
    '',
    task.description ? `Description: ${task.description}` : '',
    '',
    '-- iConcile Pulse Tasks',
  ].filter(Boolean).join('\n');

  try {
    await sendEmail({ to: assignedUser.email, subject, text, html });
    await db.prepare(
      'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
    ).run(task.id, 'assigned', assignedUser.email, JSON.stringify({ assignedBy: assignedByName }));
    console.log(`[TASK-NOTIFY] Assignment notification sent for "${task.title}" to ${assignedUser.email}`);
  } catch (err) {
    console.error(`[TASK-NOTIFY] Failed to send assignment notification:`, err.message);
  }
}

// ─── Notify on status change ────────────────────────────────────────────────

async function notifyStatusChange(task, oldStatus, newStatus, changedByName) {
  if (!task.assigned_to) return;

  const assignee = await db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(task.assigned_to);
  if (!assignee) return;

  if (!(await shouldNotify(assignee.id, 'status_change'))) return;

  const recent = await db.prepare(`
    SELECT COUNT(*) AS count FROM task_notifications
    WHERE task_id = ? AND type = ?
    AND sent_at > datetime('now', '-1 hour')
  `).get(task.id, 'status_change');
  if (recent.count > 0) return;

  const subject = `[TASK] Status changed: ${task.title} — ${oldStatus} → ${newStatus}`;
  const html = taskStatusChanged({
    recipientName: assignee.name,
    taskTitle: task.title,
    oldStatus,
    newStatus,
    changedBy: changedByName,
    priority: task.priority,
    dueDate: task.due_date || null,
  });
  const text = [
    `Task: ${task.title}`,
    `Status: ${oldStatus} → ${newStatus}`,
    `Changed By: ${changedByName}`,
    `Priority: ${task.priority}`,
    `Due Date: ${task.due_date || 'No due date'}`,
    '',
    '-- iConcile Pulse Tasks',
  ].join('\n');

  try {
    await sendEmail({ to: assignee.email, subject, text, html });
    await db.prepare(
      'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
    ).run(task.id, 'status_change', assignee.email, JSON.stringify({ oldStatus, newStatus, changedBy: changedByName }));
    console.log(`[TASK-NOTIFY] Status change notification sent for "${task.title}" to ${assignee.email}`);
  } catch (err) {
    console.error(`[TASK-NOTIFY] Failed to send status change notification:`, err.message);
  }
}

// ─── Check for tasks due soon (within 24 hours, grouped per user) ───────────

let lastDueSoonCheck = 0;

async function checkDueSoonTasks() {
  // Throttle to once per hour
  if (Date.now() - lastDueSoonCheck < 3600000) return;
  lastDueSoonCheck = Date.now();

  const tasks = await db.prepare(`
    SELECT t.*, u.email AS user_email, u.name AS user_name
    FROM tasks t
    JOIN users u ON t.assigned_to = u.id
    WHERE t.status IN ('todo', 'in_progress')
    AND t.due_date IS NOT NULL
    AND t.due_date <= date('now', '+1 day')
    AND t.due_date >= date('now')
    AND t.is_recurring_template = 0
  `).all();

  // Group by user
  const byUser = {};
  for (const task of tasks) {
    if (!(await shouldNotify(task.assigned_to, 'due_soon'))) continue;

    const recent = await db.prepare(`
      SELECT COUNT(*) AS count FROM task_notifications
      WHERE task_id = ? AND type = ?
      AND sent_at > datetime('now', '-1 hour')
    `).get(task.id, 'due_soon');
    if (recent.count > 0) continue;

    if (!byUser[task.assigned_to]) {
      byUser[task.assigned_to] = { email: task.user_email, name: task.user_name, tasks: [] };
    }
    byUser[task.assigned_to].tasks.push(task);
  }

  // Send one grouped email per user
  for (const userId of Object.keys(byUser)) {
    const { email, name, tasks: dueSoonTasks } = byUser[userId];
    if (dueSoonTasks.length === 0) continue;

    const subject = dueSoonTasks.length === 1
      ? `[TASK] Due soon: ${dueSoonTasks[0].title} — due ${dueSoonTasks[0].due_date}`
      : `[TASK] ${dueSoonTasks.length} tasks due within 24 hours`;

    const html = tasksDueSoon({ recipientName: name, tasks: dueSoonTasks });

    // Plain-text fallback
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    dueSoonTasks.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));
    const lines = [
      `Hi ${name || 'there'},`,
      '',
      `You have ${dueSoonTasks.length} task${dueSoonTasks.length !== 1 ? 's' : ''} due within the next 24 hours:`,
      '',
      ...dueSoonTasks.map(t => `  • [${(t.priority || 'medium').toUpperCase()}] ${t.title}\n    Due: ${t.due_date} · Status: ${t.status.replace('_', ' ')}`),
      '',
      'Please plan to complete these tasks soon.',
      '',
      '-- iConcile Pulse Tasks',
    ];

    try {
      await sendEmail({ to: email, subject, text: lines.join('\n'), html });

      for (const t of dueSoonTasks) {
        await db.prepare(
          'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
        ).run(t.id, 'due_soon', email, JSON.stringify({ dueDate: t.due_date, grouped: true, groupSize: dueSoonTasks.length }));
      }

      console.log(`[TASK-NOTIFY] Grouped due-soon notification (${dueSoonTasks.length} tasks) sent to ${email}`);
    } catch (err) {
      console.error(`[TASK-NOTIFY] Failed to send grouped due-soon notification to ${email}:`, err.message);
    }
  }
}

// ─── Check for overdue tasks (grouped per user) ─────────────────────────────

let lastOverdueCheck = 0;

async function checkOverdueTasks() {
  // Throttle to once per hour
  if (Date.now() - lastOverdueCheck < 3600000) return;
  lastOverdueCheck = Date.now();

  const tasks = await db.prepare(`
    SELECT t.*, u.email AS user_email, u.name AS user_name
    FROM tasks t
    JOIN users u ON t.assigned_to = u.id
    WHERE t.status IN ('todo', 'in_progress')
    AND t.due_date IS NOT NULL
    AND t.due_date < date('now')
    AND t.is_recurring_template = 0
  `).all();

  // Group by user
  const byUser = {};
  for (const task of tasks) {
    if (!(await shouldNotify(task.assigned_to, 'overdue'))) continue;

    // Check if already notified for this task recently
    const recent = await db.prepare(`
      SELECT COUNT(*) AS count FROM task_notifications
      WHERE task_id = ? AND type = ?
      AND sent_at > datetime('now', '-1 hour')
    `).get(task.id, 'overdue');
    if (recent.count > 0) continue;

    if (!byUser[task.assigned_to]) {
      byUser[task.assigned_to] = { email: task.user_email, name: task.user_name, tasks: [] };
    }
    byUser[task.assigned_to].tasks.push(task);
  }

  // Send one grouped email per user
  for (const userId of Object.keys(byUser)) {
    const { email, name, tasks: overdueTasks } = byUser[userId];
    if (overdueTasks.length === 0) continue;

    const subject = overdueTasks.length === 1
      ? `[TASK] Overdue: ${overdueTasks[0].title} — was due ${overdueTasks[0].due_date}`
      : `[TASK] ${overdueTasks.length} overdue tasks need your attention`;

    const html = tasksOverdue({ recipientName: name, tasks: overdueTasks });

    // Plain-text fallback
    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    overdueTasks.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3) || (a.due_date || '').localeCompare(b.due_date || ''));
    const lines = [
      `Hi ${name || 'there'},`,
      '',
      `You have ${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}:`,
      '',
      ...overdueTasks.map(t => `  • [${(t.priority || 'medium').toUpperCase()}] ${t.title}\n    Due: ${t.due_date} · Status: ${t.status.replace('_', ' ')}`),
      '',
      'Please complete these tasks as soon as possible.',
      '',
      '-- iConcile Pulse Tasks',
    ];

    try {
      await sendEmail({ to: email, subject, text: lines.join('\n'), html });

      // Log notifications for each task
      for (const t of overdueTasks) {
        await db.prepare(
          'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
        ).run(t.id, 'overdue', email, JSON.stringify({ dueDate: t.due_date, grouped: true, groupSize: overdueTasks.length }));
      }

      console.log(`[TASK-NOTIFY] Grouped overdue notification (${overdueTasks.length} tasks) sent to ${email}`);
    } catch (err) {
      console.error(`[TASK-NOTIFY] Failed to send grouped overdue notification to ${email}:`, err.message);
    }
  }
}

module.exports = { notifyAssignment, notifyStatusChange, checkDueSoonTasks, checkOverdueTasks };
