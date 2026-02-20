'use strict';

/** HTML-escape a value for safe interpolation */
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  bg:          '#0f0f1a',
  card:        '#16213e',
  cardBorder:  '#1e2d4d',
  primary:     '#2a9d8f',
  danger:      '#ef4444',
  warning:     '#f59e0b',
  success:     '#22c55e',
  info:        '#818cf8',
  textPrimary: '#e2e8f0',
  textMuted:   '#94a3b8',
  textFaint:   '#4b5563',
  urgent:      '#ef4444',
  high:        '#f59e0b',
  medium:      '#818cf8',
  low:         '#6b7280',
};

const PRIORITY_COLOR = {
  urgent: C.urgent,
  high:   C.high,
  medium: C.medium,
  low:    C.low,
};

const STATUS_COLOR = {
  todo:        C.textMuted,
  in_progress: C.primary,
  done:        C.success,
  cancelled:   C.danger,
};

// ─── Shared wrapper ───────────────────────────────────────────────────────────

/**
 * Wrap content in the full iConcile Pulse branded email shell.
 * @param {object} opts
 * @param {string} opts.accentColor  - hex colour for the top accent bar
 * @param {string} opts.badge        - short badge label shown in the header chip (e.g. "DOWN")
 * @param {string} opts.badgeColor   - background colour for the badge
 * @param {string} opts.title        - large heading
 * @param {string} opts.subtitle     - smaller sub-heading (optional)
 * @param {string} opts.body         - inner HTML content (tables, paragraphs, etc.)
 * @param {string} opts.footerNote   - optional extra footer line
 */
function layout({ accentColor, badge, badgeColor, title, subtitle = '', body, footerNote = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};min-height:100vh;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- Card -->
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:${C.card};border-radius:12px;border:1px solid ${C.cardBorder};overflow:hidden;">

          <!-- Accent bar -->
          <tr>
            <td style="height:4px;background-color:${esc(accentColor)};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <!-- Logo + wordmark -->
                    <table cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color:${C.primary};border-radius:8px;width:32px;height:32px;text-align:center;vertical-align:middle;">
                          <span style="color:#ffffff;font-size:16px;font-weight:700;line-height:32px;">P</span>
                        </td>
                        <td style="padding-left:10px;vertical-align:middle;">
                          <span style="color:${C.textPrimary};font-size:15px;font-weight:700;letter-spacing:-0.3px;">iConcile Pulse</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;background-color:${esc(badgeColor)};color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;padding:4px 10px;border-radius:20px;">${esc(badge)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;"><div style="height:1px;background-color:${C.cardBorder};"></div></td>
          </tr>

          <!-- Title block -->
          <tr>
            <td style="padding:24px 32px 4px 32px;">
              <h1 style="margin:0;color:${C.textPrimary};font-size:20px;font-weight:700;line-height:1.3;">${esc(title)}</h1>
              ${subtitle ? `<p style="margin:6px 0 0 0;color:${C.textMuted};font-size:13px;">${esc(subtitle)}</p>` : ''}
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:20px 32px 28px 32px;">
              ${body}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;"><div style="height:1px;background-color:${C.cardBorder};"></div></td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <span style="color:${C.textFaint};font-size:11px;">This is an automated alert from <strong style="color:${C.textMuted};">iConcile Pulse</strong>. Do not reply to this email.</span>
                    ${footerNote ? `<br><span style="color:${C.textFaint};font-size:11px;">${footerNote}</span>` : ''}
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="color:${C.textFaint};font-size:11px;">${new Date().toUTCString()}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Reusable inner components ────────────────────────────────────────────────

/** A two-column detail table row */
function detailRow(label, value, valueColor) {
  return `
  <tr>
    <td style="padding:8px 12px 8px 0;color:${C.textMuted};font-size:13px;font-weight:600;white-space:nowrap;vertical-align:top;width:38%;">${esc(label)}</td>
    <td style="padding:8px 0;color:${valueColor || C.textPrimary};font-size:13px;vertical-align:top;">${value}</td>
  </tr>`;
}

/** Wrap rows in the detail table shell */
function detailTable(rows) {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:rgba(255,255,255,0.03);border-radius:8px;border:1px solid ${C.cardBorder};margin-top:16px;">
    <tbody>${rows}</tbody>
  </table>`;
}

/** A coloured chip/pill (inline block) — returns HTML string */
function chip(text, bg, fg) {
  return `<span style="display:inline-block;background-color:${bg};color:${fg || '#fff'};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;padding:3px 10px;border-radius:20px;">${esc(text)}</span>`;
}

/** Priority chip */
function priorityChip(priority) {
  const color = PRIORITY_COLOR[priority] || C.medium;
  const bg = color + '22'; // low-opacity background
  return chip(priority || 'medium', bg, color);
}

/** Status chip */
function statusChip(status) {
  const color = STATUS_COLOR[status] || C.textMuted;
  const bg = color + '22';
  return chip((status || 'todo').replace('_', ' '), bg, color);
}

/** A callout box (alert/info banner) */
function callout(text, color) {
  return `<div style="background-color:${color}18;border-left:3px solid ${color};border-radius:0 6px 6px 0;padding:12px 16px;margin-top:16px;">
    <span style="color:${C.textPrimary};font-size:13px;line-height:1.5;">${text}</span>
  </div>`;
}

// ─── Template functions ───────────────────────────────────────────────────────

/**
 * URL Monitor DOWN alert
 */
function monitorDown({ monitorName, url, errorMessage, statusCode }) {
  const body = `
    ${callout(`<strong>Monitor is currently <span style="color:${C.danger}">DOWN</span>.</strong> We'll notify you when it recovers.`, C.danger)}
    ${detailTable([
      detailRow('Monitor', `<strong style="color:${C.textPrimary}">${esc(monitorName)}</strong>`),
      detailRow('URL', `<a href="${esc(url)}" style="color:${C.primary};text-decoration:none;">${esc(url)}</a>`),
      detailRow('Status', chip('DOWN', C.danger + '22', C.danger)),
      detailRow('HTTP Code', statusCode ? `<code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:4px;color:${C.textPrimary};font-size:12px;">${esc(String(statusCode))}</code>` : '—'),
      detailRow('Error', errorMessage ? `<span style="color:${C.danger}">${esc(errorMessage)}</span>` : 'Non-success status code'),
      detailRow('Detected At', `<span style="color:${C.textMuted}">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>`),
    ])}`;

  return layout({
    accentColor: C.danger,
    badge: 'DOWN',
    badgeColor: C.danger,
    title: `${monitorName} is down`,
    subtitle: url,
    body,
  });
}

/**
 * URL Monitor RECOVERY alert
 */
function monitorRecovered({ monitorName, url, downtimeDuration }) {
  const body = `
    ${callout(`<strong>Monitor has <span style="color:${C.success}">recovered</span>.</strong> The endpoint is responding normally again.`, C.success)}
    ${detailTable([
      detailRow('Monitor', `<strong style="color:${C.textPrimary}">${esc(monitorName)}</strong>`),
      detailRow('URL', `<a href="${esc(url)}" style="color:${C.primary};text-decoration:none;">${esc(url)}</a>`),
      detailRow('Status', chip('UP', C.success + '22', C.success)),
      detailRow('Downtime', `<span style="color:${C.warning}">${esc(downtimeDuration)}</span>`),
      detailRow('Recovered At', `<span style="color:${C.textMuted}">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>`),
    ])}`;

  return layout({
    accentColor: C.success,
    badge: 'RECOVERED',
    badgeColor: C.success,
    title: `${monitorName} has recovered`,
    subtitle: url,
    body,
  });
}

/**
 * Test email
 */
function testEmail({ provider }) {
  const body = `
    ${callout('Your email configuration is working correctly.', C.primary)}
    ${detailTable([
      detailRow('Provider', `<span style="color:${C.textPrimary}">${esc(provider)}</span>`),
      detailRow('Sent At', `<span style="color:${C.textMuted}">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>`),
    ])}
    <p style="margin:20px 0 0 0;color:${C.textMuted};font-size:13px;">
      This test was triggered from the <strong style="color:${C.textPrimary}">Settings</strong> page. You're all set!
    </p>`;

  return layout({
    accentColor: C.primary,
    badge: 'TEST',
    badgeColor: C.primary,
    title: 'Email Configuration Test',
    subtitle: 'iConcile Pulse',
    body,
  });
}

/**
 * Task assigned notification
 */
function taskAssigned({ recipientName, taskTitle, priority, dueDate, assignedBy, source, description }) {
  const body = `
    <p style="margin:0 0 4px 0;color:${C.textMuted};font-size:13px;">Hi <strong style="color:${C.textPrimary}">${esc(recipientName || 'there')}</strong>,</p>
    <p style="margin:0 0 0 0;color:${C.textMuted};font-size:13px;">A task has been assigned to you.</p>
    ${detailTable([
      detailRow('Task', `<strong style="color:${C.textPrimary}">${esc(taskTitle)}</strong>`),
      detailRow('Priority', priorityChip(priority)),
      detailRow('Due Date', dueDate ? `<span style="color:${C.warning}">${esc(dueDate)}</span>` : '<span style="color:'+C.textFaint+'">No due date</span>'),
      detailRow('Assigned By', `<span style="color:${C.textPrimary}">${esc(assignedBy)}</span>`),
      detailRow('Source', `<span style="color:${C.textMuted}">${esc(source || 'Manual')}</span>`),
    ])}
    ${description ? `<div style="margin-top:16px;background:rgba(255,255,255,0.03);border:1px solid ${C.cardBorder};border-radius:8px;padding:12px 16px;">
      <p style="margin:0 0 6px 0;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Description</p>
      <p style="margin:0;color:${C.textMuted};font-size:13px;line-height:1.6;">${esc(description)}</p>
    </div>` : ''}`;

  return layout({
    accentColor: C.primary,
    badge: 'ASSIGNED',
    badgeColor: C.primary,
    title: 'Task assigned to you',
    subtitle: taskTitle,
    body,
  });
}

/**
 * Task status change notification
 */
function taskStatusChanged({ recipientName, taskTitle, oldStatus, newStatus, changedBy, priority, dueDate }) {
  const body = `
    <p style="margin:0 0 4px 0;color:${C.textMuted};font-size:13px;">Hi <strong style="color:${C.textPrimary}">${esc(recipientName || 'there')}</strong>,</p>
    <p style="margin:0;color:${C.textMuted};font-size:13px;">The status of a task assigned to you has changed.</p>
    ${detailTable([
      detailRow('Task', `<strong style="color:${C.textPrimary}">${esc(taskTitle)}</strong>`),
      detailRow('Status Change', `${statusChip(oldStatus)} <span style="color:${C.textFaint};font-size:14px;margin:0 6px;">→</span> ${statusChip(newStatus)}`),
      detailRow('Changed By', `<span style="color:${C.textPrimary}">${esc(changedBy)}</span>`),
      detailRow('Priority', priorityChip(priority)),
      detailRow('Due Date', dueDate ? `<span style="color:${C.warning}">${esc(dueDate)}</span>` : '<span style="color:'+C.textFaint+'">No due date</span>'),
    ])}`;

  return layout({
    accentColor: C.info,
    badge: 'STATUS CHANGE',
    badgeColor: C.info,
    title: 'Task status updated',
    subtitle: taskTitle,
    body,
  });
}

/**
 * Tasks due soon (grouped)
 */
function tasksDueSoon({ recipientName, tasks }) {
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...tasks].sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));

  const taskRows = sorted.map(t => `
    <tr style="border-bottom:1px solid ${C.cardBorder};">
      <td style="padding:10px 12px 10px 0;vertical-align:top;width:50%;">
        <span style="color:${C.textPrimary};font-size:13px;font-weight:600;">${esc(t.title)}</span>
      </td>
      <td style="padding:10px 8px;vertical-align:top;text-align:center;">${priorityChip(t.priority)}</td>
      <td style="padding:10px 0 10px 8px;vertical-align:top;text-align:right;">
        <span style="color:${C.warning};font-size:12px;font-weight:600;">${esc(t.due_date)}</span><br>
        <span style="color:${C.textFaint};font-size:11px;">${esc((t.status || '').replace('_', ' '))}</span>
      </td>
    </tr>`).join('');

  const body = `
    <p style="margin:0 0 4px 0;color:${C.textMuted};font-size:13px;">Hi <strong style="color:${C.textPrimary}">${esc(recipientName || 'there')}</strong>,</p>
    <p style="margin:0;color:${C.textMuted};font-size:13px;">
      You have <strong style="color:${C.textPrimary}">${tasks.length} task${tasks.length !== 1 ? 's' : ''}</strong> due within the next 24 hours.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin-top:16px;background-color:rgba(255,255,255,0.03);border-radius:8px;border:1px solid ${C.cardBorder};">
      <thead>
        <tr style="border-bottom:1px solid ${C.cardBorder};">
          <th style="padding:10px 12px 10px 16px;text-align:left;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Task</th>
          <th style="padding:10px 8px;text-align:center;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Priority</th>
          <th style="padding:10px 16px 10px 8px;text-align:right;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Due</th>
        </tr>
      </thead>
      <tbody style="padding:0 16px;">
        ${sorted.map(t => `
        <tr style="border-bottom:1px solid ${C.cardBorder};">
          <td style="padding:10px 8px 10px 16px;vertical-align:top;">
            <span style="color:${C.textPrimary};font-size:13px;font-weight:600;">${esc(t.title)}</span>
          </td>
          <td style="padding:10px 8px;text-align:center;vertical-align:middle;">${priorityChip(t.priority)}</td>
          <td style="padding:10px 16px 10px 8px;text-align:right;vertical-align:top;">
            <span style="color:${C.warning};font-size:12px;font-weight:600;">${esc(t.due_date)}</span><br>
            <span style="color:${C.textFaint};font-size:11px;">${esc((t.status || '').replace('_', ' '))}</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${callout('Please plan to complete these tasks soon.', C.warning)}`;

  return layout({
    accentColor: C.warning,
    badge: 'DUE SOON',
    badgeColor: C.warning,
    title: `${tasks.length} task${tasks.length !== 1 ? 's' : ''} due soon`,
    subtitle: 'Action required within 24 hours',
    body,
  });
}

/**
 * Overdue tasks (grouped)
 */
function tasksOverdue({ recipientName, tasks }) {
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...tasks].sort(
    (a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3) ||
              (a.due_date || '').localeCompare(b.due_date || '')
  );

  function daysOverdue(dueDate) {
    const diff = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
    return diff <= 0 ? 'Today' : diff === 1 ? '1 day overdue' : `${diff} days overdue`;
  }

  const body = `
    <p style="margin:0 0 4px 0;color:${C.textMuted};font-size:13px;">Hi <strong style="color:${C.textPrimary}">${esc(recipientName || 'there')}</strong>,</p>
    <p style="margin:0;color:${C.textMuted};font-size:13px;">
      You have <strong style="color:${C.danger}">${tasks.length} overdue task${tasks.length !== 1 ? 's' : ''}</strong> that need your immediate attention.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin-top:16px;background-color:rgba(239,68,68,0.04);border-radius:8px;border:1px solid rgba(239,68,68,0.2);">
      <thead>
        <tr style="border-bottom:1px solid rgba(239,68,68,0.15);">
          <th style="padding:10px 8px 10px 16px;text-align:left;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Task</th>
          <th style="padding:10px 8px;text-align:center;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Priority</th>
          <th style="padding:10px 16px 10px 8px;text-align:right;color:${C.textFaint};font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Overdue By</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(t => `
        <tr style="border-bottom:1px solid rgba(239,68,68,0.1);">
          <td style="padding:10px 8px 10px 16px;vertical-align:top;">
            <span style="color:${C.textPrimary};font-size:13px;font-weight:600;">${esc(t.title)}</span><br>
            <span style="color:${C.textFaint};font-size:11px;">Due: ${esc(t.due_date)}</span>
          </td>
          <td style="padding:10px 8px;text-align:center;vertical-align:middle;">${priorityChip(t.priority)}</td>
          <td style="padding:10px 16px 10px 8px;text-align:right;vertical-align:middle;">
            <span style="color:${C.danger};font-size:12px;font-weight:700;">${esc(daysOverdue(t.due_date))}</span>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${callout('<strong>Please complete these tasks as soon as possible.</strong> Overdue tasks impact your team\'s delivery timelines.', C.danger)}`;

  return layout({
    accentColor: C.danger,
    badge: 'OVERDUE',
    badgeColor: C.danger,
    title: `${tasks.length} overdue task${tasks.length !== 1 ? 's' : ''}`,
    subtitle: 'Immediate attention required',
    body,
  });
}

/**
 * Data Check FAIL alert
 */
function dataCheckFail({ monitorName, code, clientUrl, severity, actualValue, previousValue, expectedRange, executionTimeMs, errorMessage }) {
  const sevColor = { critical: C.danger, high: C.warning, medium: C.info, low: C.textMuted }[severity] || C.info;

  const body = `
    ${callout(`<strong>A data check has <span style="color:${C.danger}">failed</span>.</strong> An urgent task has been created automatically.`, C.danger)}
    ${detailTable([
      detailRow('Check Name', `<strong style="color:${C.textPrimary}">${esc(monitorName)}</strong>`),
      detailRow('Code', `<code style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;color:${C.info};font-size:12px;">${esc(code)}</code>`),
      detailRow('Client', `<a href="${esc(clientUrl)}" style="color:${C.primary};text-decoration:none;font-size:12px;">${esc(clientUrl)}</a>`),
      detailRow('Severity', `<span style="color:${sevColor};font-weight:700;text-transform:uppercase;font-size:12px;">${esc(severity)}</span>`),
      detailRow('Actual Value', `<span style="color:${C.danger};font-weight:700;font-size:14px;">${esc(String(actualValue))}</span>`),
      detailRow('Previous Value', `<span style="color:${C.textMuted}">${previousValue != null ? esc(String(previousValue)) : '—'}</span>`),
      detailRow('Expected', `<span style="color:${C.textMuted}">${esc(expectedRange)}</span>`),
      detailRow('Execution Time', `<span style="color:${C.textMuted}">${esc(String(executionTimeMs))} ms</span>`),
      ...(errorMessage ? [detailRow('Error', `<span style="color:${C.danger}">${esc(errorMessage)}</span>`)] : []),
      detailRow('Failed At', `<span style="color:${C.textMuted}">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>`),
    ])}`;

  return layout({
    accentColor: C.danger,
    badge: 'CHECK FAIL',
    badgeColor: C.danger,
    title: `Data check failed: ${monitorName}`,
    subtitle: `${code} · ${clientUrl}`,
    body,
  });
}

/**
 * Data Check RECOVERY alert
 */
function dataCheckRecovered({ monitorName, code, clientUrl, actualValue, previousValue }) {
  const body = `
    ${callout(`<strong>Data check has <span style="color:${C.success}">recovered</span>.</strong> The check is now passing.`, C.success)}
    ${detailTable([
      detailRow('Check Name', `<strong style="color:${C.textPrimary}">${esc(monitorName)}</strong>`),
      detailRow('Code', `<code style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;color:${C.info};font-size:12px;">${esc(code)}</code>`),
      detailRow('Client', `<a href="${esc(clientUrl)}" style="color:${C.primary};text-decoration:none;font-size:12px;">${esc(clientUrl)}</a>`),
      detailRow('Current Value', `<span style="color:${C.success};font-weight:700;font-size:14px;">${esc(String(actualValue))}</span>`),
      detailRow('Previous Value', `<span style="color:${C.textMuted}">${previousValue != null ? esc(String(previousValue)) : '—'}</span>`),
      detailRow('Recovered At', `<span style="color:${C.textMuted}">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>`),
    ])}`;

  return layout({
    accentColor: C.success,
    badge: 'RECOVERED',
    badgeColor: C.success,
    title: `Data check recovered: ${monitorName}`,
    subtitle: `${code} · ${clientUrl}`,
    body,
  });
}

module.exports = {
  monitorDown,
  monitorRecovered,
  testEmail,
  taskAssigned,
  taskStatusChanged,
  tasksDueSoon,
  tasksOverdue,
  dataCheckFail,
  dataCheckRecovered,
};
