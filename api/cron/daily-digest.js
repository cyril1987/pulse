// Vercel Cron Job: Daily digest email (runs once per day at 8:00 AM IST / 2:30 UTC)
const { dbReady } = require('../../src/db');
const db = require('../../src/db');
const config = require('../../src/config');
const { sendEmail } = require('../../src/services/emailSender');

module.exports = async (req, res) => {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (config.cronSecret && authHeader !== `Bearer ${config.cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await dbReady;

    // Get all users who have daily_digest enabled
    const users = await db.prepare(`
      SELECT u.id, u.email, u.name
      FROM users u
      INNER JOIN user_notification_prefs p ON u.id = p.user_id
      WHERE p.daily_digest = 1
    `).all();

    if (users.length === 0) {
      return res.json({ ok: true, digestsSent: 0, message: 'No users with daily digest enabled' });
    }

    let sentCount = 0;

    for (const user of users) {
      try {
        // Get user's open tasks
        const openTasks = await db.prepare(`
          SELECT title, priority, status, due_date
          FROM tasks
          WHERE assigned_to = ? AND status IN ('todo', 'in_progress')
          AND is_recurring_template = 0
          ORDER BY
            CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN 0
                 WHEN due_date IS NOT NULL AND due_date <= date('now', '+1 day') THEN 1
                 ELSE 2 END,
            due_date ASC
          LIMIT 25
        `).all(user.id);

        if (openTasks.length === 0) continue;

        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const overdue = openTasks.filter(t => t.due_date && t.due_date < today);
        const dueSoon = openTasks.filter(t => t.due_date && t.due_date >= today && t.due_date <= tomorrow);
        const upcoming = openTasks.filter(t => !overdue.includes(t) && !dueSoon.includes(t));

        const subject = `[DAILY DIGEST] You have ${openTasks.length} open task${openTasks.length !== 1 ? 's' : ''}`;
        const lines = [
          `Hi ${user.name || 'there'},`,
          '',
          `Here's your daily task summary:`,
          '',
        ];

        if (overdue.length > 0) {
          lines.push(`OVERDUE (${overdue.length}):`);
          overdue.forEach(t => lines.push(`  - [${(t.priority || 'medium').toUpperCase()}] ${t.title} (due ${t.due_date})`));
          lines.push('');
        }

        if (dueSoon.length > 0) {
          lines.push(`DUE TODAY/TOMORROW (${dueSoon.length}):`);
          dueSoon.forEach(t => lines.push(`  - [${(t.priority || 'medium').toUpperCase()}] ${t.title} (due ${t.due_date})`));
          lines.push('');
        }

        if (upcoming.length > 0) {
          lines.push(`OTHER OPEN (${upcoming.length}):`);
          upcoming.forEach(t => {
            const due = t.due_date ? ` (due ${t.due_date})` : '';
            lines.push(`  - [${(t.priority || 'medium').toUpperCase()}] ${t.title}${due}`);
          });
          lines.push('');
        }

        lines.push(`TOTAL OPEN: ${openTasks.length}`);
        lines.push('');
        lines.push('-- iConcile Pulse');

        await sendEmail({ to: user.email, subject, text: lines.join('\n') });
        sentCount++;
        console.log(`[CRON] Daily digest sent to ${user.email}`);
      } catch (userErr) {
        console.error(`[CRON] Failed to send digest to ${user.email}:`, userErr.message);
      }
    }

    console.log(`[CRON] Daily digest: sent ${sentCount} of ${users.length} digests`);
    res.json({ ok: true, digestsSent: sentCount });
  } catch (err) {
    console.error('[CRON] Daily digest error:', err);
    res.status(500).json({ error: err.message });
  }
};
