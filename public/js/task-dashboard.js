/* global API, escapeHtml, currentUser */

const TaskDashboard = {
  refreshTimer: null,
  currentView: 'personal', // 'personal' | 'standup'
  currentUserId: null,      // null = all users (standup); number = filtered user
  users: [],
  data: null,

  async render(container, viewMode) {
    if (TaskDashboard.refreshTimer) {
      clearInterval(TaskDashboard.refreshTimer);
      TaskDashboard.refreshTimer = null;
    }

    TaskDashboard.currentView = viewMode || 'personal';
    TaskDashboard.currentUserId = null;

    container.innerHTML = '<div class="loading">Loading dashboard…</div>';

    try {
      TaskDashboard.users = await API.get('/tasks/users');
    } catch {
      TaskDashboard.users = [];
    }

    await TaskDashboard.load(container);

    TaskDashboard.refreshTimer = setInterval(() => {
      TaskDashboard.load(container).catch(console.error);
    }, 60000);
  },

  async load(container) {
    const params = new URLSearchParams();
    params.set('view', TaskDashboard.currentView);
    if (TaskDashboard.currentView === 'standup' && TaskDashboard.currentUserId) {
      params.set('userId', TaskDashboard.currentUserId);
    }
    const data = await API.get(`/tasks/dashboard?${params.toString()}`);
    TaskDashboard.data = data;
    TaskDashboard.renderContent(container, data);
  },

  renderContent(container, data) {
    const isStandup = TaskDashboard.currentView === 'standup';

    const tabActions = `
      <a href="#/tasks/standup" class="btn btn-secondary btn-sm" title="Standup overview">🗣️ Standup</a>
      <a href="#/tasks/ismart-upload" class="btn btn-secondary btn-sm" title="Upload iSmart tickets">↑ iSmart</a>
      <a href="#/tasks/new" class="btn btn-primary btn-sm">+ New Task</a>
    `;
    container.innerHTML = `
      ${renderTasksTabs(isStandup ? 'manage' : 'dashboard', tabActions)}
      <div class="td-header">
        <div class="td-header-left">
          <h1 class="td-title">
            ${isStandup ? '🗣️ Standup Overview' : '📊 My Task Dashboard'}
          </h1>
          <p class="td-subtitle">
            ${isStandup
              ? 'Team-wide task metrics for your daily standup call'
              : `Personal task summary for ${escapeHtml(currentUser?.name || 'you')}`}
          </p>
        </div>
        ${isStandup ? '<div class="td-header-actions"><a href="#/tasks/manage" class="btn btn-sm btn-secondary">← Back to Tasks</a></div>' : ''}
      </div>

      ${isStandup ? TaskDashboard.renderStandupUserFilter() : ''}

      ${TaskDashboard.renderKpiRow(data.counts, isStandup)}

      <div class="td-main-grid">
        <div class="td-main-col">
          ${data.counts.overdue > 0 ? TaskDashboard.renderTaskList('🔴 Overdue', data.overdueTasks, 'overdue', isStandup) : ''}
          ${data.dueTodayTasks.length > 0 ? TaskDashboard.renderTaskList('📅 Due Today', data.dueTodayTasks, 'due-today', isStandup) : ''}
          ${TaskDashboard.renderTaskList('⚙️ In Progress', data.inProgressTasks, 'in-progress', isStandup)}
          ${data.recentlyCompleted.length > 0 ? TaskDashboard.renderTaskList('✅ Completed This Week', data.recentlyCompleted, 'completed', isStandup) : ''}
        </div>
        <div class="td-side-col">
          ${isStandup ? TaskDashboard.renderByUser(data.byUser) : ''}
          ${TaskDashboard.renderBreakdownPanel('Priority Breakdown', data.byPriority, TaskDashboard.priorityBreakdown)}
          ${TaskDashboard.renderCategoryPanel(data.byCategory)}
          ${TaskDashboard.renderVelocityChart(data.velocity)}
          ${TaskDashboard.renderSourcePanel(data.bySource)}
        </div>
      </div>
    `;

    // Wire up standup user filter
    const userFilterSel = container.querySelector('#td-standup-user-filter');
    if (userFilterSel) {
      userFilterSel.addEventListener('change', async (e) => {
        TaskDashboard.currentUserId = e.target.value ? parseInt(e.target.value, 10) : null;
        container.querySelector('.td-main-grid').innerHTML = '<div class="loading">Refreshing…</div>';
        await TaskDashboard.load(container);
      });
    }
  },

  renderStandupUserFilter() {
    const users = TaskDashboard.users || [];
    return `
      <div class="td-standup-filter">
        <label class="td-filter-label">Focus user:</label>
        <select id="td-standup-user-filter" class="tasks-filter-chip">
          <option value="">— All team members —</option>
          ${users.map(u => `<option value="${u.id}" ${TaskDashboard.currentUserId === u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
        </select>
      </div>
    `;
  },

  renderKpiRow(counts, isStandup) {
    const kpis = [
      { label: 'Total Open',  value: counts.todo + counts.inProgress, cls: '' },
      { label: 'In Progress', value: counts.inProgress, cls: 'color-primary' },
      { label: 'Todo',        value: counts.todo, cls: '' },
      { label: 'Overdue',     value: counts.overdue, cls: counts.overdue > 0 ? 'color-danger' : '' },
      { label: 'Due Today',   value: counts.dueToday, cls: counts.dueToday > 0 ? 'color-warning' : '' },
      { label: 'This Week',   value: counts.dueThisWeek, cls: '' },
      { label: '🔥 Urgent',   value: counts.urgentOpen, cls: counts.urgentOpen > 0 ? 'color-danger' : '' },
      { label: 'Done Today',  value: counts.completedToday, cls: counts.completedToday > 0 ? 'color-success' : '' },
      { label: 'Done This Wk', value: counts.completedThisWeek, cls: 'color-success' },
      { label: 'Done Total',  value: counts.done, cls: '' },
    ];

    return `
      <div class="td-kpi-row">
        ${kpis.map(k => `
          <div class="td-kpi-card">
            <div class="td-kpi-label">${k.label}</div>
            <div class="td-kpi-value ${k.cls}">${k.value}</div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderTaskList(title, tasks, type, showAssignee) {
    if (tasks.length === 0) {
      return `
        <div class="td-section">
          <div class="td-section-title">${title}</div>
          <div class="td-empty">No tasks here 🎉</div>
        </div>
      `;
    }
    return `
      <div class="td-section">
        <div class="td-section-title">${title} <span class="td-count">${tasks.length}${tasks.length === 20 ? '+' : ''}</span></div>
        <div class="td-task-list">
          ${tasks.map(t => TaskDashboard.renderTaskRow(t, type, showAssignee)).join('')}
        </div>
      </div>
    `;
  },

  renderTaskRow(task, type, showAssignee) {
    const priorityCls = `task-priority-${task.priority || 'medium'}`;
    const priorityDot = { urgent: '🔴', high: '🟠', medium: '🔵', low: '⚪' }[task.priority] || '🔵';
    const dueLabel = type === 'overdue'
      ? `<span class="td-overdue-label">${task.daysOverdue}d overdue</span>`
      : task.dueDate
        ? `<span class="td-due-label">${task.dueDate}</span>`
        : '';

    const assigneeHtml = showAssignee && task.assignedToName
      ? `<span class="td-assignee">${getAvatarHtml(task.assignedTo, task.assignedToName, 'td-row-avatar')} ${escapeHtml(task.assignedToName)}</span>`
      : '';

    const catHtml = task.categoryName
      ? `<span class="td-cat-badge" style="background:${TaskDashboard.safeColor(task.categoryColor)}20;color:${TaskDashboard.safeColor(task.categoryColor)}">${escapeHtml(task.categoryName)}</span>`
      : '';

    const completedAt = type === 'completed' && task.completedAt
      ? `<span class="td-completed-at">${TaskDashboard.relativeTime(task.completedAt)}</span>`
      : '';

    return `
      <a class="td-task-row" href="#/tasks/${task.id}">
        <span class="td-priority-dot" title="${task.priority}">${priorityDot}</span>
        <span class="td-task-title">${escapeHtml(task.title)}</span>
        <span class="td-task-meta">
          ${catHtml}${assigneeHtml}${dueLabel}${completedAt}
        </span>
      </a>
    `;
  },

  renderByUser(byUser) {
    if (!byUser || byUser.length === 0) return '';
    return `
      <div class="td-panel">
        <div class="td-panel-title">👥 Team Overview</div>
        <div class="td-user-list">
          ${byUser.map(u => `
            <div class="td-user-row" data-user-id="${u.id}">
              <div class="td-user-info">
                ${getAvatarHtml(u.id, u.name, 'td-user-avatar')}
                <span class="td-user-name">${escapeHtml(u.name)}</span>
                ${u.overdue > 0 ? `<span class="td-user-badge danger">${u.overdue} overdue</span>` : ''}
                ${u.dueToday > 0 ? `<span class="td-user-badge warning">${u.dueToday} due today</span>` : ''}
              </div>
              <div class="td-user-stats">
                <span title="In progress">${u.inProgress} 🔄</span>
                <span title="Todo">${u.todo} 📋</span>
                <span title="Done today" class="color-success">${u.completedToday} ✅</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  priorityBreakdown: {
    urgent: { label: 'Urgent', cls: 'color-danger' },
    high:   { label: 'High',   cls: 'color-warning' },
    medium: { label: 'Medium', cls: 'color-primary' },
    low:    { label: 'Low',    cls: 'color-text-tertiary' },
  },

  renderBreakdownPanel(title, byObj, meta) {
    const total = Object.values(byObj).reduce((s, v) => s + v, 0);
    if (total === 0) return '';
    const rows = Object.entries(meta)
      .filter(([k]) => byObj[k])
      .map(([k, m]) => {
        const count = byObj[k] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return `
          <div class="td-breakdown-row">
            <span class="td-breakdown-label ${m.cls}">${m.label}</span>
            <div class="td-breakdown-bar-wrap">
              <div class="td-breakdown-bar" style="width:${pct}%"></div>
            </div>
            <span class="td-breakdown-count">${count}</span>
          </div>
        `;
      });
    return `
      <div class="td-panel">
        <div class="td-panel-title">${title}</div>
        ${rows.join('')}
      </div>
    `;
  },

  renderCategoryPanel(byCategory) {
    if (!byCategory || byCategory.length === 0) return '';
    const total = byCategory.reduce((s, c) => s + c.count, 0);
    return `
      <div class="td-panel">
        <div class="td-panel-title">🏷️ By Category</div>
        ${byCategory.map(c => {
          const pct = total > 0 ? Math.round((c.count / total) * 100) : 0;
          const color = TaskDashboard.safeColor(c.color);
          return `
            <div class="td-breakdown-row">
              <span class="td-breakdown-label" style="color:${color}">${escapeHtml(c.category)}</span>
              <div class="td-breakdown-bar-wrap">
                <div class="td-breakdown-bar" style="width:${pct}%;background:${color}"></div>
              </div>
              <span class="td-breakdown-count">${c.count}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderSourcePanel(bySource) {
    const sourceLabels = {
      manual: '✏️ Manual',
      ismart: '📂 iSmart',
      recurring: '🔁 Recurring',
      jira: '🎫 Jira',
      sanity_check: '🔬 Data Check',
    };
    const total = Object.values(bySource).reduce((s, v) => s + v, 0);
    if (total === 0) return '';
    return `
      <div class="td-panel">
        <div class="td-panel-title">📥 By Source</div>
        ${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return `
            <div class="td-breakdown-row">
              <span class="td-breakdown-label">${sourceLabels[k] || escapeHtml(k)}</span>
              <div class="td-breakdown-bar-wrap">
                <div class="td-breakdown-bar" style="width:${pct}%"></div>
              </div>
              <span class="td-breakdown-count">${v}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderVelocityChart(velocity) {
    if (!velocity || velocity.length === 0) return '';
    const max = Math.max(...velocity.map(d => d.completed), 1);
    const bars = velocity.map((d, i) => {
      const heightPct = max > 0 ? Math.round((d.completed / max) * 100) : 0;
      const dayLabel = new Date(d.day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const isToday = d.day === new Date().toISOString().slice(0, 10);
      return `
        <div class="td-vel-bar-wrap" title="${dayLabel}: ${d.completed} completed">
          <div class="td-vel-bar ${isToday ? 'td-vel-today' : ''}" style="height:${heightPct}%"></div>
          ${d.completed > 0 ? `<div class="td-vel-count">${d.completed}</div>` : ''}
        </div>
      `;
    });

    return `
      <div class="td-panel">
        <div class="td-panel-title">📈 14-Day Velocity</div>
        <div class="td-velocity">
          ${bars.join('')}
        </div>
        <div class="td-vel-labels">
          <span>${new Date(velocity[0].day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          <span>Today</span>
        </div>
      </div>
    `;
  },

  safeColor(color) {
    if (!color) return '#6b7280';
    return /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#6b7280';
  },

  relativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(typeof dateStr === 'string' ? dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z') : dateStr);
    const diffMs = Date.now() - d.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  },
};
