/* global API, escapeHtml, currentUser, Modal */

const TaskDetail = {
  async render(container, id) {
    container.innerHTML = '<div class="loading" style="text-align:center;padding:3rem;color:var(--color-text-secondary)">Loading task...</div>';

    try {
      const [task, comments] = await Promise.all([
        API.get(`/tasks/${id}`),
        API.get(`/tasks/${id}/comments`),
      ]);

      let subtasks = [];
      if (task.subtaskCount > 0) {
        const result = await API.get(`/tasks/all?parentTaskId=${id}`);
        subtasks = result.tasks || [];
      }

      let ismartTicket = null;
      if (task.source === 'ismart' && task.sourceRef) {
        try { ismartTicket = await API.get(`/tasks/${id}/ismart`); } catch { /* no ticket linked */ }
      }

      TaskDetail.renderContent(container, task, comments, subtasks, ismartTicket);
    } catch (err) {
      container.innerHTML = `<div class="empty-state" style="text-align:center;padding:3rem"><h2>Error</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
  },

  renderContent(container, task, comments, subtasks, ismartTicket) {
    const priorityColors = { urgent: 'var(--color-down)', high: '#f59e0b', medium: 'var(--color-primary)', low: 'var(--color-unknown)' };
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = task.dueDate && task.status !== 'done' && task.status !== 'cancelled' && task.dueDate < today;
    const statusLabel = task.status.replace(/_/g, ' ');

    container.innerHTML = `
      <!-- Header -->
      <div class="detail-header">
        <div class="detail-info">
          <div style="display:flex;align-items:center;gap:0.6rem">
            <button class="btn-back" id="back-btn" title="Go back">&larr;</button>
            <h2>
              <span class="status-dot ${task.status === 'done' ? 'up' : task.status === 'cancelled' ? 'down' : task.status === 'in_progress' ? 'up' : ''}"></span>
              ${escapeHtml(task.title)}
            </h2>
          </div>
          <div class="detail-url" style="font-size:0.82rem;color:var(--color-text-secondary)">
            ${task.isPrivate ? '<span class="task-private-badge-detail">&#128274; Private</span>' : ''}
            ${task.recurringTemplateId ? '<span class="task-recurring-badge">recurring instance</span>' : ''}
            ${task.isRecurringTemplate ? '<span class="task-recurring-badge">recurring template</span>' : ''}
            ${task.source !== 'manual' ? `<span class="task-source-badge" style="margin-left:0.3rem">${escapeHtml(task.source)}</span>` : ''}
            ${task.sourceRef ? `<span style="color:var(--color-text-tertiary);margin-left:0.3rem">Ref: ${escapeHtml(task.sourceRef)}</span>` : ''}
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary btn-sm" id="toggle-private-btn" title="${task.isPrivate ? 'Remove private flag' : 'Make private'}">${task.isPrivate ? '&#128275; Make Public' : '&#128274; Make Private'}</button>
          <a href="#/tasks/${task.id}/edit" class="btn btn-secondary btn-sm">Edit</a>
          <button class="btn btn-danger btn-sm" id="delete-task-btn">Delete</button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="stats-grid" style="grid-template-columns: repeat(6, 1fr)">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value"><span class="task-status-badge task-status-${task.status}">${escapeHtml(statusLabel)}</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Priority</div>
          <div class="stat-value" style="display:flex;align-items:center;gap:0.4rem;justify-content:center">
            <span class="task-priority-dot" style="background:${priorityColors[task.priority]}"></span>
            <span style="color:${priorityColors[task.priority]};text-transform:capitalize">${task.priority}</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Due Date</div>
          <div class="stat-value ${isOverdue ? 'task-overdue-date' : ''}" style="font-size:0.92rem">
            ${task.dueDate || '<span style="color:var(--color-text-tertiary)">None</span>'}
            ${isOverdue ? '<div style="font-size:0.68rem;color:var(--color-down);margin-top:0.2rem">OVERDUE</div>' : ''}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Assigned To</div>
          <div class="stat-value" style="font-size:0.85rem;display:flex;align-items:center;gap:0.35rem;justify-content:center">
            ${task.assignedToAvatar ? `<img class="task-avatar" src="${escapeHtml(task.assignedToAvatar)}" alt="" referrerpolicy="no-referrer">` : ''}
            ${task.assignedToName ? escapeHtml(task.assignedToName) : '<span style="color:var(--color-text-tertiary)">Unassigned</span>'}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Category</div>
          <div class="stat-value">
            ${task.categoryName
              ? `<span class="task-category-badge" style="background:${task.categoryColor}20;color:${task.categoryColor}">${escapeHtml(task.categoryName)}</span>`
              : '<span style="color:var(--color-text-tertiary)">None</span>'}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Source</div>
          <div class="stat-value"><span class="task-source-badge">${escapeHtml(task.source)}</span></div>
        </div>
      </div>

      <!-- Jira Integration -->
      ${task.jiraKey ? `
      <div class="chart-container jira-card" style="margin-top:1.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="font-size:0.88rem;font-weight:600;color:var(--color-text-secondary)">Linked Jira Issue</h3>
          <div style="display:flex;gap:0.4rem">
            <a href="${escapeHtml(task.jiraUrl || '#')}" target="_blank" class="btn btn-primary btn-sm" style="font-size:0.72rem">Open in Jira &#8599;</a>
            <button class="btn btn-secondary btn-sm" id="sync-jira-btn" style="font-size:0.72rem">&#8635; Sync</button>
            <button class="btn btn-danger btn-sm" id="unlink-jira-btn" style="font-size:0.72rem">Unlink</button>
          </div>
        </div>
        <div class="jira-issue-info">
          <a href="${escapeHtml(task.jiraUrl || '#')}" target="_blank" class="jira-key-link">${escapeHtml(task.jiraKey)}</a>
          <span class="jira-status-badge ${task.jiraStatus ? ('jira-status-' + TaskDetail.jiraStatusCategory(task.jiraStatus)) : ''}">${escapeHtml(task.jiraStatus || 'Unknown')}</span>
          <span class="jira-summary">${escapeHtml(task.jiraSummary || '')}</span>
        </div>
        <div style="margin-top:0.5rem;display:flex;gap:1.5rem;font-size:0.82rem">
          <span style="color:var(--color-text-secondary)">Assignee: <strong>${escapeHtml(task.jiraAssignee || 'Unassigned')}</strong></span>
          <span style="color:var(--color-text-secondary)">Due: <strong>${task.jiraDueDate || 'No due date'}</strong></span>
        </div>
        <div class="jira-synced-at">Last synced: ${TaskDetail.formatTime(task.jiraSyncedAt)}</div>
      </div>
      ` : `
      <div class="chart-container" style="margin-top:1.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <h3 style="font-size:0.88rem;font-weight:600;color:var(--color-text-secondary)">Jira</h3>
          <button class="btn btn-secondary btn-sm" id="show-link-jira-btn" style="font-size:0.72rem">+ Link Jira Issue</button>
        </div>
        <div id="link-jira-section" style="display:none">
          <div style="display:flex;gap:0.5rem;align-items:center">
            <input type="text" id="link-jira-key" placeholder="e.g. PROJ-123" style="flex:1;padding:0.4rem 0.6rem;border-radius:6px;border:1px solid var(--color-border);background:var(--color-card-bg);color:var(--color-text)">
            <button class="btn btn-primary btn-sm" id="link-jira-submit">Link</button>
            <button class="btn btn-secondary btn-sm" id="link-jira-cancel">Cancel</button>
          </div>
          <div id="link-jira-error" style="display:none;color:var(--color-down);font-size:0.78rem;margin-top:0.3rem"></div>
        </div>
        <p id="no-jira-text" style="color:var(--color-text-tertiary);font-size:0.82rem;margin:0">No Jira issue linked.</p>
      </div>
      `}

      <!-- iSmart Ticket Details -->
      ${ismartTicket ? `
      <div class="chart-container ismart-card" style="margin-top:1.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="font-size:0.88rem;font-weight:600;color:var(--color-text-secondary)">iSmart Ticket</h3>
          <span class="ismart-state-badge ismart-state-${(ismartTicket.state || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(ismartTicket.state || 'Unknown')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.5rem">
          <code style="font-size:0.82rem;color:#a78bfa;font-weight:600">${escapeHtml(ismartTicket.reference_id)}</code>
          ${ismartTicket.internal_state ? `<span style="font-size:0.72rem;color:var(--color-text-tertiary)">${escapeHtml(ismartTicket.internal_state)}</span>` : ''}
        </div>
        <div class="ismart-detail-grid">
          ${ismartTicket.priority ? `<div class="ismart-detail-item"><div class="label">iSmart Priority</div><div class="value">${escapeHtml(ismartTicket.priority)}</div></div>` : ''}
          ${ismartTicket.category ? `<div class="ismart-detail-item"><div class="label">Category</div><div class="value">${escapeHtml(ismartTicket.category)}</div></div>` : ''}
          ${ismartTicket.subcategory ? `<div class="ismart-detail-item"><div class="label">Subcategory</div><div class="value">${escapeHtml(ismartTicket.subcategory)}</div></div>` : ''}
          ${ismartTicket.opened_by ? `<div class="ismart-detail-item"><div class="label">Opened By</div><div class="value">${escapeHtml(ismartTicket.opened_by)}</div></div>` : ''}
          ${ismartTicket.assigned_to ? `<div class="ismart-detail-item"><div class="label">iSmart Assigned To</div><div class="value">${escapeHtml(ismartTicket.assigned_to)}</div></div>` : ''}
          ${ismartTicket.group_name ? `<div class="ismart-detail-item"><div class="label">Group</div><div class="value">${escapeHtml(ismartTicket.group_name)}</div></div>` : ''}
          ${ismartTicket.business_service ? `<div class="ismart-detail-item"><div class="label">Business Service</div><div class="value">${escapeHtml(ismartTicket.business_service)}</div></div>` : ''}
          ${ismartTicket.opened_at ? `<div class="ismart-detail-item"><div class="label">Opened At</div><div class="value">${escapeHtml(ismartTicket.opened_at)}</div></div>` : ''}
          ${ismartTicket.due_date ? `<div class="ismart-detail-item"><div class="label">iSmart Due Date</div><div class="value">${escapeHtml(ismartTicket.due_date)}</div></div>` : ''}
          ${ismartTicket.hold_reason ? `<div class="ismart-detail-item"><div class="label">Hold Reason</div><div class="value">${escapeHtml(ismartTicket.hold_reason)}</div></div>` : ''}
          ${ismartTicket.has_breached && ismartTicket.has_breached !== 'No' ? `<div class="ismart-detail-item"><div class="label">SLA Breached</div><div class="value" style="color:var(--color-down)">${escapeHtml(ismartTicket.has_breached)}</div></div>` : ''}
          ${ismartTicket.impact ? `<div class="ismart-detail-item"><div class="label">Impact</div><div class="value">${escapeHtml(ismartTicket.impact)}</div></div>` : ''}
          ${ismartTicket.urgency ? `<div class="ismart-detail-item"><div class="label">Urgency</div><div class="value">${escapeHtml(ismartTicket.urgency)}</div></div>` : ''}
          ${ismartTicket.location ? `<div class="ismart-detail-item"><div class="label">Location</div><div class="value">${escapeHtml(ismartTicket.location)}</div></div>` : ''}
          ${ismartTicket.program_name ? `<div class="ismart-detail-item"><div class="label">Program</div><div class="value">${escapeHtml(ismartTicket.program_name)}</div></div>` : ''}
        </div>
      </div>
      ` : ''}

      <!-- Status Transition -->
      ${!task.isRecurringTemplate ? `
      <div class="chart-container" style="margin-top:1.25rem">
        <h3 style="font-size:0.88rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-secondary)">Transition Status</h3>
        <div class="task-transitions">
          ${TaskDetail.renderTransitionButtons(task)}
        </div>
      </div>
      ` : ''}

      <!-- Description -->
      ${task.description ? `
      <div class="chart-container" style="margin-top:1.25rem">
        <h3 style="font-size:0.88rem;font-weight:600;margin-bottom:0.75rem;color:var(--color-text-secondary)">Description</h3>
        <div style="color:var(--color-text);line-height:1.65;white-space:pre-wrap;font-size:0.88rem">${escapeHtml(task.description)}</div>
      </div>
      ` : ''}

      <!-- Subtasks -->
      ${subtasks.length > 0 || !task.isRecurringTemplate ? `
      <div class="chart-container" style="margin-top:1.25rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="font-size:0.88rem;font-weight:600;color:var(--color-text-secondary)">Subtasks (${subtasks.length})</h3>
          <a href="#/tasks/new?parent=${task.id}" class="btn btn-secondary btn-sm" style="font-size:0.72rem">+ Add Subtask</a>
        </div>
        ${subtasks.length > 0 ? `
          <div style="overflow-x:auto">
            <table class="checks-table" style="margin:0">
              <thead>
                <tr>
                  <th style="width:90px">Status</th>
                  <th>Title</th>
                  <th style="width:90px">Priority</th>
                  <th style="width:100px">Due Date</th>
                </tr>
              </thead>
              <tbody>
                ${subtasks.map(st => {
                  const stOverdue = st.dueDate && st.status !== 'done' && st.status !== 'cancelled' && st.dueDate < today;
                  return `
                    <tr class="task-row" style="cursor:pointer" onclick="location.hash='#/tasks/${st.id}'">
                      <td><span class="task-status-badge task-status-${st.status}">${st.status.replace(/_/g, ' ')}</span></td>
                      <td>${escapeHtml(st.title)}</td>
                      <td><span class="task-priority-dot" style="background:${priorityColors[st.priority]}" title="${st.priority}"></span> ${st.priority}</td>
                      <td class="${stOverdue ? 'task-overdue-date' : ''}">${st.dueDate || '--'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : '<p style="color:var(--color-text-tertiary);font-size:0.82rem">No subtasks yet.</p>'}
      </div>
      ` : ''}

      <!-- Comments Section -->
      <div class="task-comments-section">
        <h3>Activity & Comments (${comments.length})</h3>
        ${comments.length > 0 ? comments.map(c => `
          <div class="task-comment">
            <div class="task-comment-header">
              ${c.userAvatar ? `<img class="task-avatar" src="${escapeHtml(c.userAvatar)}" alt="" referrerpolicy="no-referrer">` : ''}
              <span class="task-comment-author">${escapeHtml(c.userName || 'Unknown')}</span>
              <span class="task-comment-time">${TaskDetail.formatTime(c.createdAt)}</span>
              ${!c.isSystem && c.userId === currentUser?.id ? `<button class="btn btn-danger btn-sm" style="margin-left:auto;font-size:0.65rem;padding:0.1rem 0.4rem" onclick="TaskDetail.deleteComment(${task.id}, ${c.id})">Delete</button>` : ''}
            </div>
            <div class="task-comment-body ${c.isSystem ? 'task-comment-system' : ''}">
              ${escapeHtml(c.body)}
            </div>
          </div>
        `).join('') : '<div class="task-comment" style="color:var(--color-text-tertiary)">No comments yet.</div>'}

        <div class="task-comment-input-wrapper">
          <textarea id="comment-input" placeholder="Add a comment..." rows="2"></textarea>
          <button class="btn btn-primary btn-sm" id="add-comment-btn" style="align-self:flex-end">Post</button>
        </div>
      </div>

      <!-- Metadata Footer -->
      <div class="detail-meta" style="margin-top:1.25rem">
        <span>Created by <strong>${escapeHtml(task.createdByName || 'Unknown')}</strong></span>
        <span>Created ${TaskDetail.formatTime(task.createdAt)}</span>
        <span>Updated ${TaskDetail.formatTime(task.updatedAt)}</span>
        ${task.recurringTemplateId ? `<span><a href="#/tasks/${task.recurringTemplateId}" style="color:var(--color-primary)">View recurring template</a></span>` : ''}
      </div>
    `;

    // Attach event listeners
    document.getElementById('back-btn').addEventListener('click', () => {
      if (task.parentTaskId) {
        location.hash = `#/tasks/${task.parentTaskId}`;
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        location.hash = '#/tasks';
      }
    });

    document.getElementById('delete-task-btn').addEventListener('click', () => TaskDetail.remove(task.id));

    // Toggle private
    const togglePrivateBtn = document.getElementById('toggle-private-btn');
    if (togglePrivateBtn) {
      togglePrivateBtn.addEventListener('click', async () => {
        const action = task.isPrivate ? 'make this task public (visible to all users)' : 'make this task private (hidden from All Tasks for other users)';
        if (!(await Modal.confirm(`Are you sure you want to ${action}?`))) return;
        try {
          await API.post(`/tasks/${task.id}/toggle-private`);
          TaskDetail.render(document.getElementById('app'), task.id);
        } catch (err) {
          await Modal.alert('Failed to toggle privacy: ' + err.message, 'Error');
        }
      });
    }

    document.getElementById('add-comment-btn').addEventListener('click', () => TaskDetail.addComment(task.id));

    // Enter key for comment
    document.getElementById('comment-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        TaskDetail.addComment(task.id);
      }
    });

    // Transition buttons
    container.querySelectorAll('[data-transition]').forEach(btn => {
      btn.addEventListener('click', () => TaskDetail.transition(task.id, btn.dataset.transition));
    });

    // Jira buttons
    const syncJiraBtn = document.getElementById('sync-jira-btn');
    if (syncJiraBtn) {
      syncJiraBtn.addEventListener('click', async () => {
        syncJiraBtn.textContent = 'Syncing...';
        syncJiraBtn.disabled = true;
        try {
          await API.post(`/tasks/${task.id}/sync-jira`);
          TaskDetail.render(document.getElementById('app'), task.id);
        } catch (err) {
          await Modal.alert('Failed to sync Jira: ' + (err.data?.details || err.message), 'Error');
          syncJiraBtn.textContent = '↻ Sync';
          syncJiraBtn.disabled = false;
        }
      });
    }

    const unlinkJiraBtn = document.getElementById('unlink-jira-btn');
    if (unlinkJiraBtn) {
      unlinkJiraBtn.addEventListener('click', async () => {
        if (!(await Modal.confirm(`Unlink Jira issue ${task.jiraKey} from this task?`))) return;
        try {
          await API.delete(`/tasks/${task.id}/link-jira`);
          TaskDetail.render(document.getElementById('app'), task.id);
        } catch (err) {
          await Modal.alert('Failed to unlink Jira: ' + err.message, 'Error');
        }
      });
    }

    const showLinkBtn = document.getElementById('show-link-jira-btn');
    if (showLinkBtn) {
      showLinkBtn.addEventListener('click', () => {
        document.getElementById('link-jira-section').style.display = '';
        document.getElementById('no-jira-text').style.display = 'none';
        showLinkBtn.style.display = 'none';
        document.getElementById('link-jira-key').focus();
      });

      document.getElementById('link-jira-cancel').addEventListener('click', () => {
        document.getElementById('link-jira-section').style.display = 'none';
        document.getElementById('no-jira-text').style.display = '';
        showLinkBtn.style.display = '';
      });

      document.getElementById('link-jira-submit').addEventListener('click', async () => {
        const key = document.getElementById('link-jira-key').value.trim().toUpperCase();
        const errDiv = document.getElementById('link-jira-error');
        if (!key) { errDiv.textContent = 'Please enter a Jira key'; errDiv.style.display = ''; return; }

        errDiv.style.display = 'none';
        const btn = document.getElementById('link-jira-submit');
        btn.textContent = 'Linking...';
        btn.disabled = true;

        try {
          await API.post(`/tasks/${task.id}/link-jira`, { jiraKey: key });
          TaskDetail.render(document.getElementById('app'), task.id);
        } catch (err) {
          errDiv.textContent = err.data?.details || err.data?.errors?.join(', ') || err.message;
          errDiv.style.display = '';
          btn.textContent = 'Link';
          btn.disabled = false;
        }
      });
    }
  },

  renderTransitionButtons(task) {
    const transitions = {
      'todo': [
        { status: 'in_progress', label: 'Start Progress', cls: 'btn-primary' },
        { status: 'cancelled', label: 'Cancel', cls: 'btn-danger' },
      ],
      'in_progress': [
        { status: 'done', label: 'Mark Done', cls: 'btn-primary' },
        { status: 'todo', label: 'Back to To Do', cls: 'btn-secondary' },
        { status: 'cancelled', label: 'Cancel', cls: 'btn-danger' },
      ],
      'done': [
        { status: 'todo', label: 'Reopen', cls: 'btn-secondary' },
      ],
      'cancelled': [
        { status: 'todo', label: 'Reopen', cls: 'btn-secondary' },
      ],
    };

    const available = transitions[task.status] || [];
    if (available.length === 0) return '<span style="color:var(--color-text-tertiary);font-size:0.82rem">No transitions available</span>';

    return available.map(t =>
      `<button class="btn ${t.cls} btn-sm" data-transition="${t.status}">${escapeHtml(t.label)}</button>`
    ).join('');
  },

  async transition(taskId, newStatus) {
    try {
      await API.post(`/tasks/${taskId}/transition`, { status: newStatus });
      TaskDetail.render(document.getElementById('app'), taskId);
    } catch (err) {
      await Modal.alert('Failed to update status: ' + (err.data?.errors?.join(', ') || err.message), 'Error');
    }
  },

  async addComment(taskId) {
    const input = document.getElementById('comment-input');
    const body = input.value.trim();
    if (!body) return;

    try {
      await API.post(`/tasks/${taskId}/comments`, { body });
      TaskDetail.render(document.getElementById('app'), taskId);
    } catch (err) {
      await Modal.alert('Failed to add comment: ' + (err.data?.errors?.join(', ') || err.message), 'Error');
    }
  },

  async deleteComment(taskId, commentId) {
    if (!(await Modal.confirm('Delete this comment?'))) return;
    try {
      await API.delete(`/tasks/${taskId}/comments/${commentId}`);
      TaskDetail.render(document.getElementById('app'), taskId);
    } catch (err) {
      await Modal.alert('Failed to delete comment: ' + err.message, 'Error');
    }
  },

  async remove(taskId) {
    if (!(await Modal.confirm('Are you sure you want to delete this task? This cannot be undone.', 'Delete Task'))) return;
    try {
      await API.delete(`/tasks/${taskId}`);
      location.hash = '#/tasks';
    } catch (err) {
      await Modal.alert('Failed to delete: ' + err.message, 'Error');
    }
  },

  jiraStatusCategory(status) {
    if (!status) return 'todo';
    const s = status.toLowerCase();
    if (s === 'done' || s === 'closed' || s === 'resolved') return 'done';
    if (s === 'in progress' || s === 'in review' || s === 'in development') return 'indeterminate';
    return 'todo';
  },

  formatTime(isoStr) {
    if (!isoStr) return '--';
    try {
      const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
      return d.toLocaleString();
    } catch {
      return isoStr;
    }
  },
};
