/* global API, escapeHtml, currentUser */

const Tasks = {
  refreshTimer: null,
  currentView: 'my',
  currentFilters: { hideCompleted: true },
  currentSort: 'due_date',
  currentPage: 0,
  pageSize: 50,
  categories: [],
  users: [],

  async render(container, view) {
    Tasks.currentView = view || 'my';
    Tasks.currentPage = 0;
    if (Tasks.refreshTimer) { clearInterval(Tasks.refreshTimer); Tasks.refreshTimer = null; }

    container.innerHTML = '<div class="loading" style="text-align:center;padding:3rem;color:var(--color-text-secondary)">Loading tasks...</div>';

    try {
      const [tasksData, stats, categories, users] = await Promise.all([
        Tasks.fetchTasks(),
        API.get(`/tasks/stats?view=${Tasks.currentView}`),
        API.get('/tasks/categories'),
        API.get('/tasks/users'),
      ]);
      Tasks.categories = categories;
      Tasks.users = users;
      Tasks.renderContent(container, tasksData, stats);
    } catch (err) {
      container.innerHTML = `<div class="empty-state" style="text-align:center;padding:3rem"><h2>Error loading tasks</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
  },

  async fetchTasks() {
    const params = new URLSearchParams();
    if (Tasks.currentFilters.hideCompleted !== false) params.set('hideCompleted', '1');
    if (Tasks.currentFilters.status) params.set('status', Tasks.currentFilters.status);
    if (Tasks.currentFilters.priority) params.set('priority', Tasks.currentFilters.priority);
    if (Tasks.currentFilters.category) params.set('category', Tasks.currentFilters.category);
    if (Tasks.currentFilters.source) params.set('source', Tasks.currentFilters.source);
    if (Tasks.currentFilters.search) params.set('search', Tasks.currentFilters.search);
    params.set('sort', Tasks.currentSort);
    params.set('limit', Tasks.pageSize);
    params.set('offset', Tasks.currentPage * Tasks.pageSize);

    const endpoint = Tasks.currentView === 'all' ? '/tasks/all' : Tasks.currentView === 'unassigned' ? '/tasks/unassigned' : '/tasks';
    return API.get(`${endpoint}?${params.toString()}`);
  },

  renderContent(container, tasksData, stats) {
    const { tasks, total } = tasksData;
    const totalPages = Math.ceil(total / Tasks.pageSize);

    container.innerHTML = `
      ${Tasks.renderSummaryBar(stats)}
      ${Tasks.renderToolbar()}
      ${tasks.length > 0 ? Tasks.renderTasksTable(tasks) : Tasks.renderEmptyState()}
      ${totalPages > 1 ? Tasks.renderPagination(total, totalPages) : ''}
    `;

    Tasks.attachListeners(container);
  },

  renderSummaryBar(stats) {
    return `
      <div class="summary-bar" style="grid-template-columns: repeat(5, 1fr)">
        <div class="summary-stat">
          <div class="label">Total</div>
          <div class="value">${stats.total}</div>
        </div>
        <div class="summary-stat">
          <div class="label">To Do</div>
          <div class="value">${stats.todo}</div>
        </div>
        <div class="summary-stat">
          <div class="label">In Progress</div>
          <div class="value" style="color: var(--color-primary)">${stats.inProgress}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Done</div>
          <div class="value" style="color: var(--color-up)">${stats.done}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Overdue</div>
          <div class="value" style="color: var(--color-down)">${stats.overdue}</div>
        </div>
      </div>
    `;
  },

  renderToolbar() {
    const f = Tasks.currentFilters;
    const showCompleted = f.hideCompleted === false;
    const hasFilters = f.status || f.priority || f.category || f.source || f.search;
    return `
      <div class="tasks-toolbar">
        <div class="tasks-toolbar-row">
          <div class="tasks-view-toggle">
            <a href="#/tasks" class="btn btn-sm ${Tasks.currentView === 'my' ? 'btn-primary' : 'btn-secondary'}">My Tasks</a>
            <a href="#/tasks/unassigned" class="btn btn-sm ${Tasks.currentView === 'unassigned' ? 'btn-primary' : 'btn-secondary'}">Unassigned</a>
            <a href="#/tasks/all" class="btn btn-sm ${Tasks.currentView === 'all' ? 'btn-primary' : 'btn-secondary'}">All Tasks</a>
          </div>
          <div class="tasks-filters-inline">
            <select class="tasks-filter-chip" id="filter-status">
              <option value="">Status</option>
              <option value="todo" ${f.status === 'todo' ? 'selected' : ''}>To Do</option>
              <option value="in_progress" ${f.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
              <option value="done" ${f.status === 'done' ? 'selected' : ''}>Done</option>
              <option value="cancelled" ${f.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
            <select class="tasks-filter-chip" id="filter-priority">
              <option value="">Priority</option>
              <option value="urgent" ${f.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              <option value="high" ${f.priority === 'high' ? 'selected' : ''}>High</option>
              <option value="medium" ${f.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${f.priority === 'low' ? 'selected' : ''}>Low</option>
            </select>
            <select class="tasks-filter-chip" id="filter-category">
              <option value="">Category</option>
              ${Tasks.categories.map(c => `<option value="${c.id}" ${f.category == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
            <select class="tasks-filter-chip" id="filter-source">
              <option value="">Source</option>
              <option value="manual" ${f.source === 'manual' ? 'selected' : ''}>Manual</option>
              <option value="ismart" ${f.source === 'ismart' ? 'selected' : ''}>iSmart</option>
              <option value="jira" ${f.source === 'jira' ? 'selected' : ''}>Jira</option>
              <option value="recurring" ${f.source === 'recurring' ? 'selected' : ''}>Recurring</option>
            </select>
            ${hasFilters ? '<button class="tasks-clear-filters" id="clear-filters" title="Clear all filters">&times;</button>' : ''}
          </div>
          <div class="tasks-toolbar-actions">
            <label class="tasks-completed-toggle" title="Show completed and cancelled tasks">
              <input type="checkbox" id="toggle-completed" ${showCompleted ? 'checked' : ''}>
              <span>Show Completed</span>
            </label>
            <span class="tasks-separator"></span>
            <select class="tasks-sort-select" id="sort-select">
              <option value="due_date" ${Tasks.currentSort === 'due_date' ? 'selected' : ''}>Sort: Due Date</option>
              <option value="priority" ${Tasks.currentSort === 'priority' ? 'selected' : ''}>Sort: Priority</option>
              <option value="created" ${Tasks.currentSort === 'created' ? 'selected' : ''}>Sort: Created</option>
              <option value="status" ${Tasks.currentSort === 'status' ? 'selected' : ''}>Sort: Status</option>
            </select>
            <input type="text" id="task-search" class="tasks-search-input" placeholder="Search..." value="${escapeHtml(f.search || '')}">
            <a href="#/tasks/ismart-upload" class="btn btn-secondary btn-sm" title="Upload iSmart tickets">↑ iSmart</a>
            <a href="#/tasks/new" class="btn btn-primary btn-sm">+ New Task</a>
          </div>
        </div>
      </div>
    `;
  },

  renderTasksTable(tasks) {
    return `
      <div class="checks-section" style="margin-top:0">
        <div style="overflow-x:auto">
          <table class="checks-table tasks-table">
            <thead>
              <tr>
                <th style="width:100px">Status</th>
                <th style="width:80px">Priority</th>
                <th>Title</th>
                ${Tasks.currentView !== 'my' ? '<th style="width:170px">Assigned To</th>' : ''}
                <th style="width:130px">Category</th>
                <th style="width:120px">Due Date</th>
              </tr>
            </thead>
            <tbody>
              ${tasks.map(t => Tasks.renderTaskRow(t)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  renderTaskRow(task) {
    const priorityColors = { urgent: 'var(--color-down)', high: '#f59e0b', medium: 'var(--color-primary)', low: 'var(--color-unknown)' };
    const today = new Date().toISOString().split('T')[0];
    const isOverdue = task.dueDate && task.status !== 'done' && task.status !== 'cancelled' && task.dueDate < today;
    const statusLabel = task.status.replace('_', ' ');
    const isSubtask = !!task.parentTaskId;

    return `
      <tr class="task-row ${isOverdue ? 'task-overdue' : ''} ${isSubtask ? 'task-row-subtask' : ''}" style="cursor:pointer" onclick="location.hash='#/tasks/${task.id}'">
        <td><span class="task-status-badge task-status-${task.status}">${escapeHtml(statusLabel)}</span></td>
        <td><span class="task-priority-badge task-priority-${task.priority}">${escapeHtml(task.priority)}</span></td>
        <td class="task-title-cell">
          <div class="task-title-inner">
            ${isSubtask ? '<span class="task-subtask-indicator" title="Subtask">&#8627;</span>' : ''}
            ${task.isPrivate ? '<span class="task-private-badge" title="Private task">&#128274;</span>' : ''}
            <span class="task-title-text">${escapeHtml(task.title)}</span>
            ${isSubtask && task.parentTaskTitle ? `<a href="#/tasks/${task.parentTaskId}" class="task-parent-link" onclick="event.stopPropagation()" title="Parent task">${escapeHtml(task.parentTaskTitle)}</a>` : ''}
            ${task.recurringTemplateId ? '<span class="task-recurring-badge">recurring</span>' : ''}
            ${task.subtaskCount > 0 ? `<span class="task-subtask-count">(${task.subtaskCount} subtask${task.subtaskCount !== 1 ? 's' : ''})</span>` : ''}
          </div>
          ${task.jiraKey || (task.source === 'ismart' && task.sourceRef) ? `
            <div class="task-links-row">
              ${task.jiraKey ? `<a href="${escapeHtml(task.jiraUrl || '#')}" target="_blank" class="jira-inline-chip" onclick="event.stopPropagation()"><span class="jira-inline-key">${escapeHtml(task.jiraKey)}</span><span class="jira-chip-sep"></span><span class="jira-status-badge jira-status-${Tasks.jiraStatusCategory(task.jiraStatus)}" style="font-size:0.6rem;padding:0.05rem 0.3rem">${escapeHtml(task.jiraStatus || 'Unknown')}</span><span class="jira-chip-sep"></span><span class="jira-sprint-badge ${task.jiraSprint ? 'sprint-' + Tasks.sprintClass(task.jiraSprint.label) : 'no-sprint'}" title="${task.jiraSprint ? escapeHtml(task.jiraSprint.name) : 'Not in any sprint'}">${escapeHtml(task.jiraSprint ? task.jiraSprint.label : 'No Sprint')}</span><span class="jira-chip-sep"></span><span class="jira-inline-meta">${escapeHtml(task.jiraAssignee || 'Unassigned')}</span></a>` : ''}
              ${task.source === 'ismart' && task.sourceRef ? `<span class="ismart-ref-badge" title="iSmart ticket">${escapeHtml(task.sourceRef)}</span>` : ''}
            </div>
          ` : ''}
        </td>
        ${Tasks.currentView !== 'my' ? `
          <td>
            ${task.assignedToAvatar ? `<img class="task-avatar" src="${escapeHtml(task.assignedToAvatar)}" alt="" referrerpolicy="no-referrer">` : ''}
            ${task.assignedToName ? escapeHtml(task.assignedToName) : '<span style="color:var(--color-text-tertiary)">Unassigned</span>'}
          </td>
        ` : ''}
        <td>${task.categoryName ? `<span class="task-category-badge" style="background:${task.categoryColor}20;color:${task.categoryColor}">${escapeHtml(task.categoryName)}</span>` : '<span style="color:var(--color-text-tertiary)">--</span>'}</td>
        <td class="${isOverdue ? 'task-overdue-date' : ''}">${task.dueDate || '<span style="color:var(--color-text-tertiary)">--</span>'}</td>
      </tr>
    `;
  },

  renderEmptyState() {
    const hasFilters = Object.values(Tasks.currentFilters).some(v => v);
    return `
      <div style="text-align:center;padding:3rem;color:var(--color-text-secondary)">
        <h3 style="margin-bottom:0.5rem">${hasFilters ? 'No tasks match your filters' : 'No tasks yet'}</h3>
        <p style="margin-bottom:1rem">${hasFilters ? 'Try adjusting your filters or search terms.' : 'Create your first task to get started.'}</p>
        ${!hasFilters ? '<a href="#/tasks/new" class="btn btn-primary btn-sm">+ New Task</a>' : ''}
      </div>
    `;
  },

  renderPagination(total, totalPages) {
    const page = Tasks.currentPage;
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1rem;font-size:0.82rem;color:var(--color-text-secondary)">
        <span>Showing ${page * Tasks.pageSize + 1}–${Math.min((page + 1) * Tasks.pageSize, total)} of ${total}</span>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-secondary btn-sm" id="page-prev" ${page === 0 ? 'disabled' : ''}>Previous</button>
          <button class="btn btn-secondary btn-sm" id="page-next" ${page >= totalPages - 1 ? 'disabled' : ''}>Next</button>
        </div>
      </div>
    `;
  },

  attachListeners(container) {
    // Show Completed toggle
    const completedToggle = document.getElementById('toggle-completed');
    if (completedToggle) {
      completedToggle.addEventListener('change', () => {
        Tasks.currentFilters.hideCompleted = !completedToggle.checked;
        // If hiding completed and a specific done/cancelled status filter is set, clear it
        if (Tasks.currentFilters.hideCompleted && (Tasks.currentFilters.status === 'done' || Tasks.currentFilters.status === 'cancelled')) {
          Tasks.currentFilters.status = undefined;
        }
        Tasks.currentPage = 0;
        Tasks.render(container, Tasks.currentView);
      });
    }

    // Filters
    ['filter-status', 'filter-priority', 'filter-category', 'filter-source', 'sort-select'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => {
          Tasks.currentFilters.status = document.getElementById('filter-status').value || undefined;
          Tasks.currentFilters.priority = document.getElementById('filter-priority').value || undefined;
          Tasks.currentFilters.category = document.getElementById('filter-category').value || undefined;
          Tasks.currentFilters.source = document.getElementById('filter-source').value || undefined;
          Tasks.currentSort = document.getElementById('sort-select').value;
          // If user explicitly selects a status, turn off active toggle
          if (Tasks.currentFilters.status) {
            Tasks.currentFilters.hideCompleted = false;
          }
          Tasks.currentPage = 0;
          Tasks.render(container, Tasks.currentView);
        });
      }
    });

    // Search
    const searchInput = document.getElementById('task-search');
    if (searchInput) {
      let searchTimeout;
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          Tasks.currentFilters.search = searchInput.value.trim() || undefined;
          Tasks.currentPage = 0;
          Tasks.render(container, Tasks.currentView);
        }, 400);
      });
    }

    // Clear filters
    const clearBtn = document.getElementById('clear-filters');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const keepActive = Tasks.currentFilters.hideCompleted;
        Tasks.currentFilters = { hideCompleted: keepActive };
        Tasks.currentSort = 'due_date';
        Tasks.currentPage = 0;
        Tasks.render(container, Tasks.currentView);
      });
    }

    // Pagination
    const prevBtn = document.getElementById('page-prev');
    const nextBtn = document.getElementById('page-next');
    if (prevBtn) prevBtn.addEventListener('click', () => { Tasks.currentPage--; Tasks.render(container, Tasks.currentView); });
    if (nextBtn) nextBtn.addEventListener('click', () => { Tasks.currentPage++; Tasks.render(container, Tasks.currentView); });
  },

  // ─── Create / Edit Form ─────────────────────────────────────────────────

  async renderForm(container, editId, parentId) {
    container.innerHTML = '<div class="loading" style="text-align:center;padding:3rem;color:var(--color-text-secondary)">Loading...</div>';

    try {
      const fetches = [
        API.get('/tasks/categories'),
        API.get('/tasks/users'),
      ];

      let task = null;
      let parentTask = null;

      if (editId) {
        task = await API.get(`/tasks/${editId}`);
        if (task.parentTaskId) parentId = task.parentTaskId;
      }

      const [categories, users] = await Promise.all(fetches);

      if (parentId) {
        try { parentTask = await API.get(`/tasks/${parentId}`); } catch { /* parent may not exist */ }
      }

      Tasks.renderFormContent(container, task, categories, users, parentTask);
    } catch (err) {
      container.innerHTML = `<div class="empty-state" style="text-align:center;padding:3rem"><h2>Error</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
  },

  renderFormContent(container, task, categories, users, parentTask) {
    const isEdit = !!task;
    const isTemplate = task && task.isRecurringTemplate;
    const t = task || {};
    const rp = t.recurrencePattern || {};
    const parentId = parentTask ? parentTask.id : (t.parentTaskId || null);

    let formTitle = isEdit ? (isTemplate ? 'Edit Recurring Template' : 'Edit Task') : 'New Task';
    if (!isEdit && parentTask) formTitle = 'New Subtask';

    container.innerHTML = `
      <div class="form-container" style="position:relative">
        <button type="button" class="form-close-btn" id="form-close-btn" title="Close">&times;</button>
        <h2 class="form-title">${formTitle}</h2>
        ${parentTask ? `
        <div class="subtask-parent-banner">
          <span style="color:var(--color-text-tertiary);font-size:0.78rem">Parent task:</span>
          <a href="#/tasks/${parentTask.id}" class="subtask-parent-link">${escapeHtml(parentTask.title)}</a>
          <span class="task-status-badge task-status-${parentTask.status}" style="font-size:0.6rem;padding:0.1rem 0.4rem">${parentTask.status.replace('_', ' ')}</span>
        </div>
        ` : ''}
        <div id="form-errors"></div>
        <form id="task-form">
          <div class="form-group">
            <label for="title">Title *</label>
            <input type="text" id="title" name="title" value="${escapeHtml(t.title || '')}" required maxlength="255" placeholder="Enter task title">
          </div>

          <div class="form-group">
            <label for="description">Description</label>
            <textarea id="description" name="description" rows="4" maxlength="5000" placeholder="Optional details...">${escapeHtml(t.description || '')}</textarea>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div class="form-group">
              <label for="priority">Priority</label>
              <select id="priority" name="priority">
                <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${t.priority === 'medium' || !t.priority ? 'selected' : ''}>Medium</option>
                <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              </select>
            </div>

            <div class="form-group">
              <label for="categoryId">Category</label>
              <div style="display:flex;gap:0.5rem">
                <select id="categoryId" name="categoryId" style="flex:1">
                  <option value="">-- No Category --</option>
                  ${categories.map(c => `<option value="${c.id}" ${t.categoryId == c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
                <button type="button" class="btn btn-secondary btn-sm" id="add-category-btn">+ New</button>
              </div>
              <div id="new-category-input" style="display:none;margin-top:0.5rem">
                <div style="display:flex;gap:0.5rem">
                  <input type="text" id="new-category-name" placeholder="Category name" style="flex:1">
                  <input type="color" id="new-category-color" value="#2a9d8f" style="width:40px;padding:2px">
                  <button type="button" class="btn btn-primary btn-sm" id="confirm-new-category">Add</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="cancel-new-category">Cancel</button>
                </div>
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div class="form-group">
              <label for="source">Source</label>
              <select id="source" name="source">
                <option value="manual" ${t.source === 'manual' || !t.source ? 'selected' : ''}>Manual</option>
                <option value="ismart" ${t.source === 'ismart' ? 'selected' : ''}>iSmart Ticket</option>
                <option value="jira" ${t.source === 'jira' ? 'selected' : ''}>Jira</option>
              </select>
            </div>

            <div class="form-group">
              <label for="sourceRef">Source Reference</label>
              <input type="text" id="sourceRef" name="sourceRef" value="${escapeHtml(t.sourceRef || '')}" placeholder="e.g. iSmart ticket ID" maxlength="255">
              <div class="hint">External reference ID (optional)</div>
            </div>
          </div>

          <div class="form-group">
            <label for="jiraKey">Link Jira Issue</label>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <input type="text" id="jiraKey" name="jiraKey" value="${escapeHtml(t.jiraKey || '')}" placeholder="e.g. PROJ-123" style="flex:1" maxlength="50">
              <button type="button" class="btn btn-secondary btn-sm" id="verify-jira-btn">Verify</button>
            </div>
            <div class="hint">Enter a Jira issue key to link this task (optional)</div>
            <div id="jira-preview" style="display:none"></div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
            <div class="form-group">
              <label for="dueDate">Due Date</label>
              <input type="date" id="dueDate" name="dueDate" value="${t.dueDate || ''}">
            </div>

            <div class="form-group">
              <label for="assignedTo">Assign To</label>
              <select id="assignedTo" name="assignedTo">
                <option value="">-- Unassigned --</option>
                ${users.map(u => `<option value="${u.id}" ${t.assignedTo == u.id ? 'selected' : ''}>${escapeHtml(u.name)} (${escapeHtml(u.email)})</option>`).join('')}
              </select>
            </div>
          </div>

          ${!isEdit || isTemplate ? `
          <div class="form-group">
            <label>
              <input type="checkbox" id="enable-recurrence" ${t.recurrencePattern ? 'checked' : ''}>
              Make this a recurring task
            </label>
            <div class="hint">Recurring tasks will automatically create new instances on schedule</div>
          </div>

          <div class="recurrence-section" id="recurrence-section" style="${t.recurrencePattern ? '' : 'display:none'}">
            <h4>Recurrence Settings</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
              <div class="form-group">
                <label for="recurrence-type">Frequency</label>
                <select id="recurrence-type">
                  <option value="daily" ${rp.type === 'daily' ? 'selected' : ''}>Daily</option>
                  <option value="weekly" ${rp.type === 'weekly' ? 'selected' : ''}>Weekly</option>
                  <option value="monthly" ${rp.type === 'monthly' ? 'selected' : ''}>Monthly</option>
                  <option value="yearly" ${rp.type === 'yearly' ? 'selected' : ''}>Yearly</option>
                </select>
              </div>
              <div class="form-group">
                <label for="recurrence-interval">Repeat every</label>
                <div style="display:flex;align-items:center;gap:0.5rem">
                  <input type="number" id="recurrence-interval" min="1" max="365" value="${rp.interval || 1}" style="width:70px">
                  <span id="recurrence-interval-label" style="font-size:0.82rem;color:var(--color-text-secondary)">day(s)</span>
                </div>
              </div>
            </div>

            <!-- Daily: day-of-week toggles -->
            <div class="form-group" id="recurrence-daily-days" style="${!rp.type || rp.type === 'daily' ? '' : 'display:none'}">
              <label>Repeat on</label>
              <div class="recurrence-day-toggles" id="day-toggles">
                ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => {
                  const checked = rp.daysOfWeek ? rp.daysOfWeek.includes(i) : false;
                  return `<label class="recurrence-day-toggle ${checked ? 'active' : ''}"><input type="checkbox" value="${i}" ${checked ? 'checked' : ''}><span>${d}</span></label>`;
                }).join('')}
              </div>
              <div class="hint">Leave all unchecked to repeat every day. Select specific days to only repeat on those days.</div>
              <div style="display:flex;gap:0.5rem;margin-top:0.4rem">
                <button type="button" class="btn btn-secondary btn-sm" id="select-weekdays" style="font-size:0.68rem;padding:0.2rem 0.5rem">Weekdays</button>
                <button type="button" class="btn btn-secondary btn-sm" id="select-weekends" style="font-size:0.68rem;padding:0.2rem 0.5rem">Weekends</button>
                <button type="button" class="btn btn-secondary btn-sm" id="select-all-days" style="font-size:0.68rem;padding:0.2rem 0.5rem">Every Day</button>
              </div>
            </div>

            <!-- Weekly: single day of week -->
            <div class="form-group" id="recurrence-weekly-day" style="${rp.type === 'weekly' ? '' : 'display:none'}">
              <label for="recurrence-day-of-week">On day</label>
              <select id="recurrence-day-of-week">
                ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => {
                  const sel = (rp.dayOfWeek !== undefined && rp.dayOfWeek !== null) ? parseInt(Array.isArray(rp.dayOfWeek) ? rp.dayOfWeek[0] : rp.dayOfWeek) === i : (new Date().getDay() === i);
                  return `<option value="${i}" ${sel ? 'selected' : ''}>${d}</option>`;
                }).join('')}
              </select>
            </div>

            <!-- Monthly: day-of-month / nth weekday / last day -->
            <div id="recurrence-monthly-opts" style="${rp.type === 'monthly' ? '' : 'display:none'}">
              <div class="form-group">
                <label>Monthly option</label>
                <select id="recurrence-month-option">
                  <option value="dayOfMonth" ${!rp.monthOption || rp.monthOption === 'dayOfMonth' ? 'selected' : ''}>On a specific day of the month</option>
                  <option value="nthWeekday" ${rp.monthOption === 'nthWeekday' ? 'selected' : ''}>On the Nth weekday (e.g., 2nd Tuesday)</option>
                  <option value="lastDay" ${rp.monthOption === 'lastDay' ? 'selected' : ''}>Last day of the month</option>
                </select>
              </div>
              <div class="form-group" id="recurrence-day-of-month-group" style="${!rp.monthOption || rp.monthOption === 'dayOfMonth' ? '' : 'display:none'}">
                <label for="recurrence-day-of-month">Day of month</label>
                <input type="number" id="recurrence-day-of-month" min="1" max="31" value="${rp.dayOfMonth || 1}">
              </div>
              <div id="recurrence-nth-weekday-group" style="${rp.monthOption === 'nthWeekday' ? '' : 'display:none'}">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                  <div class="form-group">
                    <label for="recurrence-nth-n">Which occurrence</label>
                    <select id="recurrence-nth-n">
                      <option value="1" ${(!rp.nthWeekday || rp.nthWeekday.n == 1) ? 'selected' : ''}>1st</option>
                      <option value="2" ${rp.nthWeekday && rp.nthWeekday.n == 2 ? 'selected' : ''}>2nd</option>
                      <option value="3" ${rp.nthWeekday && rp.nthWeekday.n == 3 ? 'selected' : ''}>3rd</option>
                      <option value="4" ${rp.nthWeekday && rp.nthWeekday.n == 4 ? 'selected' : ''}>4th</option>
                      <option value="5" ${rp.nthWeekday && rp.nthWeekday.n == 5 ? 'selected' : ''}>5th</option>
                      <option value="-1" ${rp.nthWeekday && rp.nthWeekday.n == -1 ? 'selected' : ''}>Last</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="recurrence-nth-day">Day of week</label>
                    <select id="recurrence-nth-day">
                      ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => {
                        const sel = rp.nthWeekday ? parseInt(rp.nthWeekday.day) === i : (i === 1);
                        return `<option value="${i}" ${sel ? 'selected' : ''}>${d}</option>`;
                      }).join('')}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <!-- Yearly: month + day -->
            <div id="recurrence-yearly-opts" style="${rp.type === 'yearly' ? '' : 'display:none'}">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
                <div class="form-group">
                  <label for="recurrence-month">Month</label>
                  <select id="recurrence-month">
                    ${['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => {
                      const sel = rp.month ? rp.month == (i + 1) : (new Date().getMonth() === i);
                      return `<option value="${i + 1}" ${sel ? 'selected' : ''}>${m}</option>`;
                    }).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label for="recurrence-yearly-day">Day of month</label>
                  <input type="number" id="recurrence-yearly-day" min="1" max="31" value="${rp.dayOfMonth || new Date().getDate()}">
                </div>
              </div>
            </div>

            <!-- End Date -->
            <div class="form-group" style="margin-top:0.5rem">
              <label for="recurrence-end">End Date (optional)</label>
              <input type="date" id="recurrence-end" value="${t.recurrenceEndAt || ''}">
              <div class="hint">Leave blank for no end date</div>
            </div>

            <!-- Preview -->
            <div id="recurrence-preview" class="recurrence-preview"></div>
          </div>
          ` : ''}

          <div class="form-group" style="margin-top:0.5rem">
            <label class="tasks-private-check" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
              <input type="checkbox" id="isPrivate" ${t.isPrivate ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--color-primary)">
              <span>Private task</span>
            </label>
            <div class="hint">Private tasks are only visible to you and the assigned user under All Tasks.</div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${isEdit ? 'Update Task' : 'Create Task'}</button>
            <a href="#/tasks" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    `;

    // Close button
    document.getElementById('form-close-btn').addEventListener('click', () => {
      if (parentId) {
        location.hash = `#/tasks/${parentId}`;
      } else if (window.history.length > 1) {
        window.history.back();
      } else {
        location.hash = '#/tasks';
      }
    });

    // Attach form listeners
    const form = document.getElementById('task-form');

    // Category inline creation
    const addCatBtn = document.getElementById('add-category-btn');
    const newCatInput = document.getElementById('new-category-input');
    if (addCatBtn) {
      addCatBtn.addEventListener('click', () => { newCatInput.style.display = 'block'; addCatBtn.style.display = 'none'; });
      document.getElementById('cancel-new-category').addEventListener('click', () => { newCatInput.style.display = 'none'; addCatBtn.style.display = ''; });
      document.getElementById('confirm-new-category').addEventListener('click', async () => {
        const name = document.getElementById('new-category-name').value.trim();
        const color = document.getElementById('new-category-color').value;
        if (!name) return;
        try {
          const cat = await API.post('/tasks/categories', { name, color });
          const select = document.getElementById('categoryId');
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.name;
          opt.selected = true;
          select.appendChild(opt);
          newCatInput.style.display = 'none';
          addCatBtn.style.display = '';
        } catch (err) {
          Modal.alert('Failed to create category: ' + (err.data?.errors?.join(', ') || err.message), 'Error');
        }
      });
    }

    // Recurrence toggle
    const recCheck = document.getElementById('enable-recurrence');
    const recSection = document.getElementById('recurrence-section');
    if (recCheck) {
      recCheck.addEventListener('change', () => {
        recSection.style.display = recCheck.checked ? '' : 'none';
        if (recCheck.checked) Tasks.updateRecurrencePreview();
      });
    }

    // Recurrence type change — show/hide relevant sub-sections
    const recType = document.getElementById('recurrence-type');
    if (recType) {
      const intervalLabels = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };
      recType.addEventListener('change', () => {
        const type = recType.value;
        document.getElementById('recurrence-daily-days').style.display = type === 'daily' ? '' : 'none';
        document.getElementById('recurrence-weekly-day').style.display = type === 'weekly' ? '' : 'none';
        document.getElementById('recurrence-monthly-opts').style.display = type === 'monthly' ? '' : 'none';
        document.getElementById('recurrence-yearly-opts').style.display = type === 'yearly' ? '' : 'none';
        document.getElementById('recurrence-interval-label').textContent = intervalLabels[type] || 'period(s)';
        Tasks.updateRecurrencePreview();
      });
      // Fire initial label update
      document.getElementById('recurrence-interval-label').textContent = intervalLabels[recType.value] || 'period(s)';
    }

    // Daily: day toggles
    const dayToggles = document.getElementById('day-toggles');
    if (dayToggles) {
      dayToggles.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.recurrence-day-toggle').classList.toggle('active', cb.checked);
          Tasks.updateRecurrencePreview();
        });
      });
    }

    // Quick select buttons for daily days
    const selectWeekdays = document.getElementById('select-weekdays');
    const selectWeekends = document.getElementById('select-weekends');
    const selectAllDays = document.getElementById('select-all-days');
    if (selectWeekdays) {
      selectWeekdays.addEventListener('click', () => Tasks.setDayToggles([1,2,3,4,5]));
      selectWeekends.addEventListener('click', () => Tasks.setDayToggles([0,6]));
      selectAllDays.addEventListener('click', () => Tasks.setDayToggles([0,1,2,3,4,5,6]));
    }

    // Monthly option switcher
    const monthOption = document.getElementById('recurrence-month-option');
    if (monthOption) {
      monthOption.addEventListener('change', () => {
        document.getElementById('recurrence-day-of-month-group').style.display = monthOption.value === 'dayOfMonth' ? '' : 'none';
        document.getElementById('recurrence-nth-weekday-group').style.display = monthOption.value === 'nthWeekday' ? '' : 'none';
        Tasks.updateRecurrencePreview();
      });
    }

    // Update preview on any recurrence change
    ['recurrence-interval', 'recurrence-day-of-week', 'recurrence-day-of-month',
     'recurrence-nth-n', 'recurrence-nth-day', 'recurrence-month', 'recurrence-yearly-day',
     'recurrence-end'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => Tasks.updateRecurrencePreview());
    });

    // Initial preview
    if (recCheck && recCheck.checked) Tasks.updateRecurrencePreview();

    // Jira verify button
    const verifyJiraBtn = document.getElementById('verify-jira-btn');
    if (verifyJiraBtn) {
      verifyJiraBtn.addEventListener('click', async () => {
        const jiraKeyInput = document.getElementById('jiraKey');
        const preview = document.getElementById('jira-preview');
        const key = jiraKeyInput.value.trim().toUpperCase();
        if (!key) { preview.style.display = 'none'; return; }

        preview.style.display = 'block';
        preview.className = 'jira-preview';
        preview.innerHTML = '<span style="color:var(--color-text-secondary)">Verifying...</span>';

        try {
          const issues = await API.get(`/tasks/jira/search?q=${encodeURIComponent(key)}`);
          if (issues.length > 0) {
            const issue = issues[0];
            const catClass = issue.statusCategory === 'done' ? 'jira-status-done' : issue.statusCategory === 'indeterminate' ? 'jira-status-indeterminate' : 'jira-status-todo';
            preview.innerHTML = `
              <div style="display:flex;align-items:center;gap:0.75rem">
                <a href="${escapeHtml(issue.url)}" target="_blank" class="jira-key-link">${escapeHtml(issue.key)}</a>
                <span class="jira-status-badge ${catClass}">${escapeHtml(issue.status)}</span>
                <span class="jira-summary">${escapeHtml(issue.summary)}</span>
              </div>
              <div style="margin-top:0.35rem;font-size:0.78rem;color:var(--color-text-tertiary)">
                Assignee: ${escapeHtml(issue.assignee || 'Unassigned')} · Due: ${issue.dueDate || 'No due date'}
              </div>
            `;
            jiraKeyInput.value = issue.key; // Normalize the key
          } else {
            preview.innerHTML = '<span style="color:var(--color-down)">No Jira issue found with that key.</span>';
          }
        } catch (err) {
          preview.innerHTML = `<span style="color:var(--color-down)">Failed to verify: ${escapeHtml(err.message)}</span>`;
        }
      });
    }

    // Form submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorsDiv = document.getElementById('form-errors');
      errorsDiv.innerHTML = '';

      const isPrivateChecked = document.getElementById('isPrivate').checked;

      // Confirm private task
      if (isPrivateChecked && !isEdit) {
        if (!(await Modal.confirm('This task will be private and will not be visible to other users under All Tasks. Continue?', 'Private Task'))) return;
      }

      const body = {
        title: document.getElementById('title').value.trim(),
        description: document.getElementById('description').value.trim(),
        priority: document.getElementById('priority').value,
        categoryId: document.getElementById('categoryId').value || null,
        source: document.getElementById('source').value,
        sourceRef: document.getElementById('sourceRef').value.trim() || null,
        dueDate: document.getElementById('dueDate').value || null,
        assignedTo: document.getElementById('assignedTo').value || null,
        jiraKey: document.getElementById('jiraKey').value.trim().toUpperCase() || null,
        parentTaskId: parentId || null,
        isPrivate: isPrivateChecked,
      };

      // Recurrence
      const recEnabled = document.getElementById('enable-recurrence');
      if (recEnabled && recEnabled.checked) {
        const recTypeVal = document.getElementById('recurrence-type').value;
        body.recurrencePattern = {
          type: recTypeVal,
          interval: parseInt(document.getElementById('recurrence-interval').value, 10) || 1,
        };

        if (recTypeVal === 'daily') {
          // Collect selected days of week
          const selectedDays = [];
          document.querySelectorAll('#day-toggles input[type="checkbox"]:checked').forEach(cb => {
            selectedDays.push(parseInt(cb.value, 10));
          });
          if (selectedDays.length > 0 && selectedDays.length < 7) {
            body.recurrencePattern.daysOfWeek = selectedDays;
          }
        }

        if (recTypeVal === 'weekly') {
          body.recurrencePattern.dayOfWeek = parseInt(document.getElementById('recurrence-day-of-week').value, 10);
        }

        if (recTypeVal === 'monthly') {
          const monthOpt = document.getElementById('recurrence-month-option').value;
          body.recurrencePattern.monthOption = monthOpt;
          if (monthOpt === 'dayOfMonth') {
            body.recurrencePattern.dayOfMonth = parseInt(document.getElementById('recurrence-day-of-month').value, 10) || 1;
          } else if (monthOpt === 'nthWeekday') {
            body.recurrencePattern.nthWeekday = {
              n: parseInt(document.getElementById('recurrence-nth-n').value, 10),
              day: parseInt(document.getElementById('recurrence-nth-day').value, 10),
            };
          }
          // 'lastDay' doesn't need extra params
        }

        if (recTypeVal === 'yearly') {
          body.recurrencePattern.month = parseInt(document.getElementById('recurrence-month').value, 10);
          body.recurrencePattern.dayOfMonth = parseInt(document.getElementById('recurrence-yearly-day').value, 10) || 1;
        }

        const endDate = document.getElementById('recurrence-end').value;
        if (endDate) body.recurrenceEndAt = endDate;
      }

      try {
        let savedTask;
        const jiraKey = body.jiraKey;
        delete body.jiraKey; // Don't send jiraKey in create/update body

        if (isEdit) {
          savedTask = await API.put(`/tasks/${task.id}`, body);
        } else {
          savedTask = await API.post('/tasks', body);
        }

        // Link Jira issue if key provided
        if (jiraKey && savedTask && savedTask.id) {
          try {
            await API.post(`/tasks/${savedTask.id}/link-jira`, { jiraKey });
          } catch (jiraErr) {
            console.warn('Failed to link Jira issue:', jiraErr.message);
          }
        }

        // Navigate back to parent task if creating a subtask, otherwise task list
        location.hash = parentId ? `#/tasks/${parentId}` : '#/tasks';
      } catch (err) {
        const errors = err.data?.errors || [err.message];
        errorsDiv.innerHTML = `<div class="form-errors">${errors.map(e => `<div>${escapeHtml(e)}</div>`).join('')}</div>`;
      }
    });
  },

  setDayToggles(days) {
    document.querySelectorAll('#day-toggles input[type="checkbox"]').forEach(cb => {
      const val = parseInt(cb.value, 10);
      cb.checked = days.includes(val);
      cb.closest('.recurrence-day-toggle').classList.toggle('active', cb.checked);
    });
    Tasks.updateRecurrencePreview();
  },

  updateRecurrencePreview() {
    const preview = document.getElementById('recurrence-preview');
    if (!preview) return;

    const type = document.getElementById('recurrence-type').value;
    const interval = parseInt(document.getElementById('recurrence-interval').value, 10) || 1;
    const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const ordinals = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', '-1': 'last' };
    let desc = '';

    if (type === 'daily') {
      const selectedDays = [];
      document.querySelectorAll('#day-toggles input[type="checkbox"]:checked').forEach(cb => {
        selectedDays.push(parseInt(cb.value, 10));
      });

      if (selectedDays.length === 0 || selectedDays.length === 7) {
        desc = interval === 1 ? 'Every day' : `Every ${interval} days`;
      } else if (selectedDays.length === 5 && [1,2,3,4,5].every(d => selectedDays.includes(d))) {
        desc = 'Every weekday (Mon\u2013Fri)';
      } else if (selectedDays.length === 2 && selectedDays.includes(0) && selectedDays.includes(6)) {
        desc = 'Every weekend (Sat\u2013Sun)';
      } else {
        desc = 'Every ' + selectedDays.map(d => dayNames[d].substring(0, 3)).join(', ');
      }
    } else if (type === 'weekly') {
      const dow = document.getElementById('recurrence-day-of-week');
      const dayName = dow ? dayNames[parseInt(dow.value, 10)] : '';
      desc = interval === 1 ? `Every week on ${dayName}` : `Every ${interval} weeks on ${dayName}`;
    } else if (type === 'monthly') {
      const monthOpt = document.getElementById('recurrence-month-option');
      const opt = monthOpt ? monthOpt.value : 'dayOfMonth';
      const prefix = interval === 1 ? 'Every month' : `Every ${interval} months`;

      if (opt === 'dayOfMonth') {
        const dom = document.getElementById('recurrence-day-of-month');
        desc = `${prefix} on day ${dom ? dom.value : '1'}`;
      } else if (opt === 'nthWeekday') {
        const n = document.getElementById('recurrence-nth-n');
        const d = document.getElementById('recurrence-nth-day');
        const nVal = n ? n.value : '1';
        const dVal = d ? dayNames[parseInt(d.value, 10)] : 'Monday';
        desc = `${prefix} on the ${ordinals[nVal] || nVal} ${dVal}`;
      } else if (opt === 'lastDay') {
        desc = `${prefix} on the last day`;
      }
    } else if (type === 'yearly') {
      const m = document.getElementById('recurrence-month');
      const d = document.getElementById('recurrence-yearly-day');
      const monthName = m ? monthNames[parseInt(m.value, 10) - 1] : '';
      const dayVal = d ? d.value : '1';
      desc = interval === 1 ? `Every year on ${monthName} ${dayVal}` : `Every ${interval} years on ${monthName} ${dayVal}`;
    }

    const endDate = document.getElementById('recurrence-end');
    if (endDate && endDate.value) {
      desc += ` until ${endDate.value}`;
    }

    preview.textContent = desc;
    preview.style.display = desc ? '' : 'none';
  },

  jiraStatusCategory(status) {
    if (!status) return 'todo';
    const s = status.toLowerCase();
    if (s === 'done' || s === 'closed' || s === 'resolved') return 'done';
    if (s === 'in progress' || s === 'in review' || s === 'in development') return 'indeterminate';
    return 'todo';
  },

  sprintClass(label) {
    if (!label) return 'none';
    const l = label.toLowerCase();
    if (l.includes('current')) return 'current';
    if (l.includes('next')) return 'next';
    if (l.includes('past')) return 'past';
    return 'other';
  },
};
