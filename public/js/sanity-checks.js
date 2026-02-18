const SanityChecks = {
  refreshTimer: null,
  expandedGroups: {},

  async render(app) {
    app.innerHTML = '<div class="loading">Loading sanity checks...</div>';

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    try {
      const monitors = await API.get('/sanity-checks');
      this.renderContent(app, monitors);
      this.refreshTimer = setInterval(() => this.render(app), 30000);
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load sanity checks: ${escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(app, monitors) {
    const total = monitors.length;
    const passing = monitors.filter(m => m.currentStatus === 'pass').length;
    const failing = monitors.filter(m => m.currentStatus === 'fail').length;
    const error = monitors.filter(m => m.currentStatus === 'error').length;
    const unknown = monitors.filter(m => m.currentStatus === 'unknown').length;

    const groups = {};
    for (const m of monitors) {
      const group = m.groupName || 'Ungrouped';
      if (!groups[group]) groups[group] = [];
      groups[group].push(m);
    }

    app.innerHTML = `
      <div class="page-header">
        <h1>Data Sanity Checks</h1>
        <a href="#/sanity-checks/add" class="btn btn-primary">+ Add Monitor</a>
      </div>

      <div class="summary-bar">
        <div class="summary-item">
          <span class="summary-value">${total}</span>
          <span class="summary-label">Total</span>
        </div>
        <div class="summary-item summary-up">
          <span class="summary-value">${passing}</span>
          <span class="summary-label">Passing</span>
        </div>
        <div class="summary-item summary-down">
          <span class="summary-value">${failing}</span>
          <span class="summary-label">Failing</span>
        </div>
        <div class="summary-item summary-unknown">
          <span class="summary-value">${error + unknown}</span>
          <span class="summary-label">Error/Unknown</span>
        </div>
      </div>

      <div class="monitor-groups">
        ${Object.entries(groups).map(([group, items]) => this.renderGroup(group, items)).join('')}
      </div>
    `;

    // Bind check-now buttons
    app.querySelectorAll('.btn-check-now').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.checkNow(btn.dataset.id, app);
      });
    });
  },

  renderGroup(group, monitors) {
    const isExpanded = this.expandedGroups[group] !== false;
    const passing = monitors.filter(m => m.currentStatus === 'pass').length;
    const failing = monitors.filter(m => m.currentStatus === 'fail').length;

    return `
      <div class="monitor-group">
        <div class="group-header" onclick="SanityChecks.toggleGroup('${escapeHtml(group)}')">
          <span class="group-toggle">${isExpanded ? '▼' : '▶'}</span>
          <span class="group-name">${escapeHtml(group)}</span>
          <span class="group-stats">
            <span class="badge badge-up">${passing} pass</span>
            ${failing > 0 ? `<span class="badge badge-down">${failing} fail</span>` : ''}
            <span class="badge">${monitors.length} total</span>
          </span>
        </div>
        ${isExpanded ? `<div class="monitor-cards">${monitors.map(m => this.renderCard(m)).join('')}</div>` : ''}
      </div>
    `;
  },

  renderCard(monitor) {
    const statusClass = monitor.currentStatus === 'pass' ? 'up' : monitor.currentStatus === 'fail' ? 'down' : 'unknown';
    const statusLabel = monitor.currentStatus || 'unknown';
    const severityClass = monitor.severity === 'critical' ? 'severity-critical' : monitor.severity === 'high' ? 'severity-high' : '';

    return `
      <a href="#/sanity-checks/${monitor.id}" class="monitor-card">
        <div class="monitor-card-header">
          <span class="status-dot status-${statusClass}"></span>
          <span class="monitor-name">${escapeHtml(monitor.name)}</span>
          <span class="badge badge-sm ${severityClass}">${escapeHtml(monitor.severity)}</span>
        </div>
        <div class="monitor-card-meta">
          <span class="monitor-code">${escapeHtml(monitor.code)}</span>
          <span class="monitor-url-badge">${escapeHtml(new URL(monitor.clientUrl).hostname)}</span>
        </div>
        <div class="monitor-card-stats">
          <span>Value: ${monitor.lastValue !== null && monitor.lastValue !== undefined ? monitor.lastValue : '—'}</span>
          <span>Pass Rate: ${monitor.stats24h && monitor.stats24h.passRate ? monitor.stats24h.passRate + '%' : '—'}</span>
          ${monitor.stats24h && monitor.stats24h.avgExecutionTimeMs ? `<span>Avg: ${monitor.stats24h.avgExecutionTimeMs}ms</span>` : ''}
        </div>
        <div class="monitor-card-footer">
          <span class="last-checked">${monitor.lastCheckedAt ? 'Last: ' + new Date(monitor.lastCheckedAt).toLocaleString() : 'Never checked'}</span>
          <button class="btn btn-sm btn-check-now" data-id="${monitor.id}" title="Run Now">▶</button>
        </div>
      </a>
    `;
  },

  toggleGroup(group) {
    this.expandedGroups[group] = this.expandedGroups[group] === false;
    const app = document.getElementById('app');
    API.get('/sanity-checks').then(monitors => this.renderContent(app, monitors));
  },

  async checkNow(id, app) {
    try {
      await API.post(`/sanity-checks/${id}/check`);
      this.render(app);
    } catch (err) {
      Modal.alert('Check failed: ' + err.message);
    }
  },
};
