const { sendEmail } = require('./emailSender');
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
    await sendEmail({ to: assignedUser.email, subject, text });
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
    await sendEmail({ to: assignee.email, subject, text });
    await db.prepare(
      'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
    ).run(task.id, 'status_change', assignee.email, JSON.stringify({ oldStatus, newStatus, changedBy: changedByName }));
    console.log(`[TASK-NOTIFY] Status change notification sent for "${task.title}" to ${assignee.email}`);
  } catch (err) {
    console.error(`[TASK-NOTIFY] Failed to send status change notification:`, err.message);
  }
}

// ─── Check for tasks due soon (within 24 hours) ────────────────────────────

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

  for (const task of tasks) {
    if (!(await shouldNotify(task.assigned_to, 'due_soon'))) continue;

    const recent = await db.prepare(`
      SELECT COUNT(*) AS count FROM task_notifications
      WHERE task_id = ? AND type = ?
      AND sent_at > datetime('now', '-1 hour')
    `).get(task.id, 'due_soon');
    if (recent.count > 0) continue;

    const subject = `[TASK] Due soon: ${task.title} — due ${task.due_date}`;
    const text = [
      `Task: ${task.title}`,
      `Due Date: ${task.due_date}`,
      `Priority: ${task.priority}`,
      `Status: ${task.status.replace('_', ' ')}`,
      '',
      'This task is due within the next 24 hours.',
      '',
      '-- iConcile Pulse Tasks',
    ].join('\n');

    try {
      await sendEmail({ to: task.user_email, subject, text });
      await db.prepare(
        'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
      ).run(task.id, 'due_soon', task.user_email, JSON.stringify({ dueDate: task.due_date }));
      console.log(`[TASK-NOTIFY] Due-soon notification sent for "${task.title}" to ${task.user_email}`);
    } catch (err) {
      console.error(`[TASK-NOTIFY] Failed to send due-soon notification:`, err.message);
    }
  }
}

// ─── Check for overdue tasks ────────────────────────────────────────────────

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

  for (const task of tasks) {
    if (!(await shouldNotify(task.assigned_to, 'overdue'))) continue;

    const recent = await db.prepare(`
      SELECT COUNT(*) AS count FROM task_notifications
      WHERE task_id = ? AND type = ?
      AND sent_at > datetime('now', '-1 hour')
    `).get(task.id, 'overdue');
    if (recent.count > 0) continue;

    const subject = `[TASK] Overdue: ${task.title} — was due ${task.due_date}`;
    const text = [
      `Task: ${task.title}`,
      `Due Date: ${task.due_date} (OVERDUE)`,
      `Priority: ${task.priority}`,
      `Status: ${task.status.replace('_', ' ')}`,
      '',
      'This task is past its due date. Please complete it as soon as possible.',
      '',
      '-- iConcile Pulse Tasks',
    ].join('\n');

    try {
      await sendEmail({ to: task.user_email, subject, text });
      await db.prepare(
        'INSERT INTO task_notifications (task_id, type, email, details) VALUES (?, ?, ?, ?)'
      ).run(task.id, 'overdue', task.user_email, JSON.stringify({ dueDate: task.due_date }));
      console.log(`[TASK-NOTIFY] Overdue notification sent for "${task.title}" to ${task.user_email}`);
    } catch (err) {
      console.error(`[TASK-NOTIFY] Failed to send overdue notification:`, err.message);
    }
  }
}

module.exports = { notifyAssignment, notifyStatusChange, checkDueSoonTasks, checkOverdueTasks };
