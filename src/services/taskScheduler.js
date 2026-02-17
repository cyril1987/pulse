const db = require('../db');

/**
 * Get the Nth weekday of a month.
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {number} dayOfWeek - 0=Sun, 6=Sat
 * @param {number} n - 1-5 for 1st-5th, -1 for last
 * @returns {Date|null}
 */
function getNthWeekdayOfMonth(year, month, dayOfWeek, n) {
  if (n === -1) {
    // Last occurrence: start from last day and work backwards
    const lastDay = new Date(year, month + 1, 0);
    for (let d = lastDay.getDate(); d >= 1; d--) {
      const dt = new Date(year, month, d);
      if (dt.getDay() === dayOfWeek) return dt;
    }
    return null;
  }

  // Nth occurrence: find first occurrence, then add (n-1) weeks
  const first = new Date(year, month, 1);
  let firstOccurrence = 1 + ((dayOfWeek - first.getDay() + 7) % 7);
  const targetDay = firstOccurrence + (n - 1) * 7;
  const maxDay = new Date(year, month + 1, 0).getDate();
  if (targetDay > maxDay) return null; // e.g., 5th Tuesday doesn't exist
  return new Date(year, month, targetDay);
}

function computeNextOccurrence(pattern, currentDateStr) {
  const d = new Date(currentDateStr);
  const interval = pattern.interval || 1;

  switch (pattern.type) {
    case 'daily': {
      // If specific days of week are selected
      if (pattern.daysOfWeek && Array.isArray(pattern.daysOfWeek) && pattern.daysOfWeek.length > 0) {
        const days = pattern.daysOfWeek.map(Number).sort((a, b) => a - b);
        // Find next matching day
        let next = new Date(d);
        next.setDate(next.getDate() + 1); // always advance at least 1 day
        for (let i = 0; i < 8; i++) { // check up to 8 days ahead
          if (days.includes(next.getDay())) break;
          next.setDate(next.getDate() + 1);
        }
        return next.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
      }
      // Standard: every N days
      d.setDate(d.getDate() + interval);
      break;
    }
    case 'weekly': {
      // If specific day of week for weekly (single day)
      if (pattern.dayOfWeek !== undefined && pattern.dayOfWeek !== null) {
        const targetDay = Array.isArray(pattern.dayOfWeek) ? pattern.dayOfWeek[0] : parseInt(pattern.dayOfWeek, 10);
        // Advance by interval weeks, then land on the target day
        d.setDate(d.getDate() + (7 * interval));
        // Adjust to the target day of week
        const diff = (targetDay - d.getDay() + 7) % 7;
        if (diff > 0) d.setDate(d.getDate() + diff);
      } else {
        d.setDate(d.getDate() + (7 * interval));
      }
      break;
    }
    case 'monthly': {
      d.setMonth(d.getMonth() + interval);

      if (pattern.monthOption === 'lastDay') {
        // Last day of month
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(lastDay);
      } else if (pattern.monthOption === 'nthWeekday' && pattern.nthWeekday) {
        const nth = getNthWeekdayOfMonth(
          d.getFullYear(), d.getMonth(),
          parseInt(pattern.nthWeekday.day, 10),
          parseInt(pattern.nthWeekday.n, 10)
        );
        if (nth) {
          d.setDate(nth.getDate());
        } else {
          // Fallback: if Nth weekday doesn't exist (e.g., 5th Monday), use last occurrence
          const fallback = getNthWeekdayOfMonth(
            d.getFullYear(), d.getMonth(),
            parseInt(pattern.nthWeekday.day, 10), -1
          );
          if (fallback) d.setDate(fallback.getDate());
        }
      } else if (pattern.dayOfMonth) {
        const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(pattern.dayOfMonth, maxDay));
      }
      break;
    }
    case 'yearly': {
      d.setFullYear(d.getFullYear() + interval);
      if (pattern.month) d.setMonth(pattern.month - 1);
      if (pattern.dayOfMonth) {
        const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(pattern.dayOfMonth, maxDay));
      }
      break;
    }
  }
  // Format as SQLite-compatible datetime (YYYY-MM-DD HH:MM:SS)
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

async function tick() {
  const templates = await db.prepare(`
    SELECT t.*, u.email AS assigned_to_email, u.name AS assigned_to_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    WHERE t.is_recurring_template = 1
    AND t.recurrence_next_at IS NOT NULL
    AND t.recurrence_next_at <= datetime('now')
  `).all();

  if (templates.length === 0) return;

  console.log(`[TASKS] Processing ${templates.length} recurring template(s)`);

  await db.transaction(async (tx) => {
    for (const tmpl of templates) {
      const pattern = JSON.parse(tmpl.recurrence_pattern);
      const dueDate = tmpl.recurrence_next_at.split(' ')[0]; // YYYY-MM-DD

      // Duplicate check
      const existing = await tx.prepare(`
        SELECT id FROM tasks
        WHERE recurring_template_id = ?
        AND due_date = ?
        AND is_recurring_template = 0
      `).get(tmpl.id, dueDate);

      if (!existing) {
        const result = await tx.prepare(`
          INSERT INTO tasks (title, description, source, priority, status, due_date,
            assigned_to, created_by, category_id, recurring_template_id, is_recurring_template)
          VALUES (?, ?, 'recurring', ?, 'todo', ?, ?, ?, ?, ?, 0)
        `).run(
          tmpl.title,
          tmpl.description || '',
          tmpl.priority,
          dueDate,
          tmpl.assigned_to,
          tmpl.created_by,
          tmpl.category_id,
          tmpl.id
        );
        console.log(`[TASKS] Created recurring instance: "${tmpl.title}" due ${dueDate}`);

        // Add system comment to the new instance
        await tx.prepare(`
          INSERT INTO task_comments (task_id, user_id, body, is_system) VALUES (?, ?, ?, 1)
        `).run(
          result.lastInsertRowid,
          tmpl.created_by,
          `Auto-created from recurring template`
        );
      }

      // Compute next occurrence
      const nextAt = computeNextOccurrence(pattern, tmpl.recurrence_next_at);

      // Check if past end date
      if (tmpl.recurrence_end_at && nextAt > tmpl.recurrence_end_at) {
        await tx.prepare(`
          UPDATE tasks SET recurrence_next_at = ?, updated_at = datetime('now') WHERE id = ?
        `).run(null, tmpl.id); // stop recurrence
        console.log(`[TASKS] Recurring template "${tmpl.title}" reached end date — stopped`);
      } else {
        await tx.prepare(`
          UPDATE tasks SET recurrence_next_at = ?, updated_at = datetime('now') WHERE id = ?
        `).run(nextAt, tmpl.id);
      }
    }
  });
}

module.exports = { tick };
