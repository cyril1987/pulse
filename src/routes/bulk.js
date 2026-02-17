const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateMonitorData } = require('../middleware/validate');

router.post('/monitors/bulk', express.json({ limit: '1mb' }), async (req, res) => {
  const { monitors } = req.body;

  if (!Array.isArray(monitors)) {
    return res.status(400).json({ error: 'Request body must contain a "monitors" array' });
  }
  if (monitors.length === 0) {
    return res.status(400).json({ error: 'monitors array must not be empty' });
  }
  if (monitors.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 monitors per bulk import' });
  }

  const results = { created: [], failed: [] };
  const validMonitors = [];

  // Collect existing URLs and names for duplicate checking
  const existingUrls = new Set(
    (await db.prepare('SELECT url FROM monitors').all()).map(r => r.url)
  );
  const existingNames = new Set(
    (await db.prepare('SELECT name FROM monitors').all()).map(r => r.name)
  );
  // Track URLs and names within the current batch too
  const batchUrls = new Set();
  const batchNames = new Set();

  for (let i = 0; i < monitors.length; i++) {
    const errors = validateMonitorData(monitors[i]);
    const d = monitors[i];

    // Duplicate URL check (against DB and current batch)
    if (d.url) {
      if (existingUrls.has(d.url)) {
        errors.push('A monitor with this URL already exists');
      } else if (batchUrls.has(d.url)) {
        errors.push('Duplicate URL within this upload batch');
      }
    }

    // Duplicate name check (against DB and current batch)
    const monitorName = d.name || (d.url ? (() => { try { return new URL(d.url).hostname; } catch { return ''; } })() : '');
    if (monitorName) {
      if (existingNames.has(monitorName)) {
        errors.push('A monitor with this name already exists');
      } else if (batchNames.has(monitorName)) {
        errors.push('Duplicate name within this upload batch');
      }
    }

    if (errors.length > 0) {
      results.failed.push({ rowIndex: i, errors });
    } else {
      batchUrls.add(d.url);
      if (monitorName) batchNames.add(monitorName);
      validMonitors.push({ index: i, data: d });
    }
  }

  if (validMonitors.length > 0) {
    await db.transaction(async (tx) => {
      for (const item of validMonitors) {
        const d = item.data;
        const headersJson = Array.isArray(d.customHeaders) && d.customHeaders.length > 0
          ? JSON.stringify(d.customHeaders)
          : null;
        const groupName = d.group && typeof d.group === 'string' && d.group.trim() ? d.group.trim() : null;
        try {
          const result = await tx.prepare(`
            INSERT INTO monitors (url, name, frequency_seconds, expected_status, timeout_ms, notify_email, custom_headers, group_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            d.url,
            d.name || new URL(d.url).hostname,
            d.frequency || 300,
            d.expectedStatus || 200,
            d.timeoutMs || 10000,
            d.notifyEmail,
            headersJson,
            groupName
          );
          const monitor = await tx.prepare('SELECT * FROM monitors WHERE id = ?').get(result.lastInsertRowid);
          results.created.push({ rowIndex: item.index, monitorId: monitor.id, name: monitor.name });
        } catch (err) {
          results.failed.push({ rowIndex: item.index, errors: [err.message] });
        }
      }
    });
  }

  res.json({
    ...results,
    summary: {
      total: monitors.length,
      created: results.created.length,
      failed: results.failed.length,
    },
  });
});

// ─── iSmart Ticket Bulk Upload ──────────────────────────────────────────────

router.post('/tasks/ismart-upload', express.json({ limit: '5mb' }), async (req, res) => {
  const { tickets } = req.body;

  if (!Array.isArray(tickets)) {
    return res.status(400).json({ error: 'Request body must contain a "tickets" array' });
  }
  if (tickets.length === 0) {
    return res.status(400).json({ error: 'tickets array must not be empty' });
  }
  if (tickets.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 tickets per upload' });
  }

  const results = { created: [], updated: [], failed: [] };

  // Find iSmart Ticket category
  const ismartCategory = await db.prepare("SELECT id FROM task_categories WHERE name = 'iSmart Ticket'").get();
  const categoryId = ismartCategory ? ismartCategory.id : null;

  const mapPriority = (p) => {
    if (!p) return 'medium';
    const pl = p.toLowerCase();
    if (pl.includes('1') || pl.includes('critical')) return 'urgent';
    if (pl.includes('2') || pl.includes('high')) return 'high';
    if (pl.includes('3') || pl.includes('moderate') || pl.includes('medium')) return 'medium';
    return 'low';
  };

  await db.transaction(async (tx) => {
    for (let i = 0; i < tickets.length; i++) {
      const t = tickets[i];

      // Validate: must have reference_id and short_description
      if (!t.referenceId || !t.referenceId.trim()) {
        results.failed.push({ rowIndex: i, referenceId: t.referenceId || '', errors: ['Missing Reference Id'] });
        continue;
      }
      if (!t.shortDescription || !t.shortDescription.trim()) {
        results.failed.push({ rowIndex: i, referenceId: t.referenceId, errors: ['Missing Short Description'] });
        continue;
      }

      const refId = t.referenceId.trim();
      const title = t.shortDescription.trim().substring(0, 255);
      const desc = (t.description || '').trim().substring(0, 5000);
      const priority = mapPriority(t.priority);
      const dueDate = t.dueDate || null;

      try {
        const existing = await tx.prepare('SELECT id, task_id FROM ismart_tickets WHERE reference_id = ?').get(refId);

        // Upsert iSmart ticket
        await tx.prepare(`
          INSERT INTO ismart_tickets (
            reference_id, incident_id, priority, short_description, description,
            state, internal_state, category, subcategory, subcategory2,
            opened_at, updated_at, due_date, opened_by, assigned_to,
            group_name, business_service, impact, urgency, hold_reason,
            has_breached, location, channel, program_name, task_id, imported_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(reference_id) DO UPDATE SET
            incident_id = excluded.incident_id,
            priority = excluded.priority,
            short_description = excluded.short_description,
            description = excluded.description,
            state = excluded.state,
            internal_state = excluded.internal_state,
            category = excluded.category,
            subcategory = excluded.subcategory,
            subcategory2 = excluded.subcategory2,
            opened_at = excluded.opened_at,
            updated_at = excluded.updated_at,
            due_date = excluded.due_date,
            opened_by = excluded.opened_by,
            assigned_to = excluded.assigned_to,
            group_name = excluded.group_name,
            business_service = excluded.business_service,
            impact = excluded.impact,
            urgency = excluded.urgency,
            hold_reason = excluded.hold_reason,
            has_breached = excluded.has_breached,
            location = excluded.location,
            channel = excluded.channel,
            program_name = excluded.program_name,
            imported_by = excluded.imported_by
        `).run(
          refId, t.incidentId || null, t.priority || null, t.shortDescription || null,
          t.description || null, t.state || null, t.internalState || null,
          t.category || null, t.subcategory || null, t.subcategory2 || null,
          t.openedAt || null, t.updatedAt || null, dueDate,
          t.openedBy || null, t.assignedTo || null,
          t.groupName || null, t.businessService || null,
          t.impact || null, t.urgency || null, t.holdReason || null,
          t.hasBreached || null, t.location || null, t.channel || null,
          t.programName || null, existing ? existing.task_id : null, req.user.id
        );

        if (existing && existing.task_id) {
          // Update existing task (title, description, priority, due date)
          await tx.prepare(`
            UPDATE tasks SET title = ?, description = ?, priority = ?, due_date = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(title, desc, priority, dueDate, existing.task_id);
          results.updated.push({ rowIndex: i, referenceId: refId, taskId: existing.task_id, title });
        } else {
          // Create new task (unassigned)
          const taskResult = await tx.prepare(`
            INSERT INTO tasks (title, description, source, source_ref, priority, status, due_date, category_id, created_by)
            VALUES (?, ?, 'ismart', ?, ?, 'todo', ?, ?, ?)
          `).run(title, desc, refId, priority, dueDate, categoryId, req.user.id);
          const taskId = taskResult.lastInsertRowid;

          // Link the iSmart ticket to the new task
          const ticketRow = await tx.prepare('SELECT id FROM ismart_tickets WHERE reference_id = ?').get(refId);
          if (ticketRow) {
            await tx.prepare('UPDATE ismart_tickets SET task_id = ? WHERE id = ?').run(taskId, ticketRow.id);
          }

          results.created.push({ rowIndex: i, referenceId: refId, taskId: Number(taskId), title });
        }
      } catch (err) {
        results.failed.push({ rowIndex: i, referenceId: refId, errors: [err.message] });
      }
    }
  });

  res.json({
    ...results,
    summary: {
      total: tickets.length,
      created: results.created.length,
      updated: results.updated.length,
      failed: results.failed.length,
    },
  });
});

// ─── Get iSmart ticket for a task ──────────────────────────────────────────

router.get('/tasks/:id/ismart', async (req, res) => {
  const ticket = await db.prepare(`
    SELECT * FROM ismart_tickets WHERE task_id = ?
  `).get(req.params.id);

  if (!ticket) {
    return res.status(404).json({ error: 'No iSmart ticket linked to this task' });
  }

  res.json(ticket);
});

// ─── List all iSmart tickets ────────────────────────────────────────────────

router.get('/tasks/ismart-tickets', async (req, res) => {
  const { state, search, limit: lim, offset: off } = req.query;
  const conditions = [];
  const params = [];

  if (state) { conditions.push('it.state = ?'); params.push(state); }
  if (search) {
    conditions.push('(it.reference_id LIKE ? OR it.short_description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(parseInt(lim || '50', 10), 200);
  const offset = parseInt(off || '0', 10);

  const tickets = await db.prepare(`
    SELECT it.*, t.status AS task_status, t.assigned_to AS task_assigned_to,
      u.name AS task_assigned_to_name
    FROM ismart_tickets it
    LEFT JOIN tasks t ON it.task_id = t.id
    LEFT JOIN users u ON t.assigned_to = u.id
    ORDER BY it.opened_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = await db.prepare(`SELECT COUNT(*) AS count FROM ismart_tickets it ${where}`).get(...params);

  res.json({ tickets, total: total.count });
});

module.exports = router;
