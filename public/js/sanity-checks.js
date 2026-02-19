const SanityChecks = {
  refreshTimer: null,
  expandedGroups: {},
  expandedEnvironments: {},
  filterStatus: 'failing', // default: show what needs attention
  sortBy: 'value-desc',

  // ─── Environment utilities ──────────────────────────────────────────────────

  extractEnvKey(clientUrl) {
    if (!clientUrl) return '_unknown_';
    try {
      return new URL(clientUrl).origin + new URL(clientUrl).pathname.replace(/\/+$/, '');
    } catch {
      return clientUrl;
    }
  },

  extractEnvName(clientUrl) {
    if (!clientUrl) return 'Unknown';
    try {
      const hostname = new URL(clientUrl).hostname;
      // "dev.iconcile.com" → "DEV", "demo.iconcile.com" → "DEMO"
      const sub = hostname.split('.')[0];
      if (sub && sub !== 'www') return sub.toUpperCase();
      return hostname.toUpperCase();
    } catch {
      return clientUrl;
    }
  },

  groupByEnvironment(monitors) {
    const groups = {};
    for (const m of monitors) {
      const key = this.extractEnvKey(m.clientUrl);
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    }
    return groups;
  },

  async render(app) {
    app.innerHTML = '<div class="loading">Loading data checks...</div>';

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    try {
      const monitors = await API.get('/sanity-checks');
      this.renderContent(app, monitors);
      this.refreshTimer = setInterval(() => this.silentRefresh(app), 30000);
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load data checks: ${escapeHtml(err.message)}</div>`;
    }
  },

  async silentRefresh(app) {
    try {
      const monitors = await API.get('/sanity-checks');
      this.renderContent(app, monitors);
    } catch { /* silent */ }
  },

  renderContent(app, monitors) {
    const total = monitors.length;
    const failing = monitors.filter(m => m.currentStatus === 'fail');
    const passing = monitors.filter(m => m.currentStatus === 'pass');
    const errored = monitors.filter(m => m.currentStatus === 'error' || m.currentStatus === 'unknown');
    const neverChecked = monitors.filter(m => !m.lastCheckedAt);

    // Determine which monitors to show based on filter
    let filtered;
    if (this.filterStatus === 'all') {
      filtered = monitors;
    } else if (this.filterStatus === 'failing') {
      filtered = monitors.filter(m => m.currentStatus === 'fail');
    } else if (this.filterStatus === 'passing') {
      filtered = monitors.filter(m => m.currentStatus === 'pass');
    } else if (this.filterStatus === 'error') {
      filtered = monitors.filter(m => m.currentStatus === 'error' || m.currentStatus === 'unknown' || !m.lastCheckedAt);
    }

    // Sort
    filtered = this.sortMonitors(filtered);

    // Calculate totals for the headline
    const totalExceptionValue = failing.reduce((sum, m) => sum + (parseFloat(m.lastValue) || 0), 0);

    // Detect multi-environment
    const allByEnv = this.groupByEnvironment(monitors);
    const envCount = Object.keys(allByEnv).length;
    const isMultiEnv = envCount > 1;

    app.innerHTML = `
      <div class="dc-layout">
        ${this.renderTopBar(total, failing.length, passing.length, errored.length + neverChecked.length, totalExceptionValue)}
        ${this.renderToolbar(filtered.length, isMultiEnv)}
        ${filtered.length > 0
          ? (isMultiEnv
              ? this.renderEnvironmentSections(filtered, monitors)
              : this.renderExceptionsList(filtered))
          : this.renderEmptyState()}
      </div>
    `;

    this.bindEvents(app, isMultiEnv);
  },

  renderTopBar(total, failCount, passCount, errorCount, totalExceptions) {
    return `
      <div class="dc-top-bar">
        <div class="dc-headline">
          <h1>Data Checks</h1>
          <div class="dc-headline-actions">
            <button class="btn btn-secondary btn-sm" id="btn-sync-client">Sync from Client</button>
            <button class="btn btn-secondary btn-sm" id="btn-run-all">Run All</button>
            <a href="#/sanity-checks/add" class="btn btn-primary btn-sm">+ Add Check</a>
          </div>
        </div>
        <div class="dc-summary-cards">
          <button class="dc-summary-card dc-summary-alert ${this.filterStatus === 'failing' ? 'dc-active' : ''}" data-filter="failing">
            <div class="dc-summary-number">${failCount}</div>
            <div class="dc-summary-label">Need Action</div>
            ${totalExceptions > 0 ? `<div class="dc-summary-detail">${this.formatNumber(totalExceptions)} total exceptions</div>` : ''}
          </button>
          <button class="dc-summary-card dc-summary-ok ${this.filterStatus === 'passing' ? 'dc-active' : ''}" data-filter="passing">
            <div class="dc-summary-number">${passCount}</div>
            <div class="dc-summary-label">Clear</div>
          </button>
          <button class="dc-summary-card dc-summary-error ${this.filterStatus === 'error' ? 'dc-active' : ''}" data-filter="error">
            <div class="dc-summary-number">${errorCount}</div>
            <div class="dc-summary-label">Error</div>
          </button>
          <button class="dc-summary-card ${this.filterStatus === 'all' ? 'dc-active' : ''}" data-filter="all">
            <div class="dc-summary-number">${total}</div>
            <div class="dc-summary-label">Total</div>
          </button>
        </div>
      </div>
    `;
  },

  renderToolbar(count, isMultiEnv) {
    const label = this.filterStatus === 'failing' ? 'exceptions needing action'
                : this.filterStatus === 'passing' ? 'checks clear'
                : this.filterStatus === 'error' ? 'checks with errors'
                : 'total checks';

    // Check if all envs are expanded or collapsed
    const allExpanded = isMultiEnv && Object.values(this.expandedEnvironments).every(v => v !== false);

    return `
      <div class="dc-toolbar">
        <span class="dc-toolbar-count">${count} ${label}</span>
        <div class="dc-toolbar-right">
          ${isMultiEnv ? `
            <button class="dc-env-toggle-all" id="dc-env-toggle-all" title="${allExpanded ? 'Collapse all environments' : 'Expand all environments'}">
              ${allExpanded ? '&#9660; Collapse All' : '&#9654; Expand All'}
            </button>
          ` : ''}
          <select class="dc-sort-select" id="dc-sort">
            <option value="value-desc" ${this.sortBy === 'value-desc' ? 'selected' : ''}>Highest value first</option>
            <option value="value-asc" ${this.sortBy === 'value-asc' ? 'selected' : ''}>Lowest value first</option>
            <option value="severity" ${this.sortBy === 'severity' ? 'selected' : ''}>Severity</option>
            <option value="name" ${this.sortBy === 'name' ? 'selected' : ''}>Name</option>
            <option value="last-checked" ${this.sortBy === 'last-checked' ? 'selected' : ''}>Last checked</option>
            <option value="group" ${this.sortBy === 'group' ? 'selected' : ''}>Group</option>
          </select>
        </div>
      </div>
    `;
  },

  renderEnvironmentSections(filtered, allMonitors) {
    const filteredByEnv = this.groupByEnvironment(filtered);
    const allByEnv = this.groupByEnvironment(allMonitors);

    // Sort environments: those with failures first, then alphabetical
    const envKeys = Object.keys(allByEnv).sort((a, b) => {
      const aFails = (allByEnv[a] || []).filter(m => m.currentStatus === 'fail').length;
      const bFails = (allByEnv[b] || []).filter(m => m.currentStatus === 'fail').length;
      if (aFails > 0 && bFails === 0) return -1;
      if (bFails > 0 && aFails === 0) return 1;
      return this.extractEnvName(a).localeCompare(this.extractEnvName(b));
    });

    // Smart defaults: auto-expand envs with failures, collapse healthy ones
    // If nothing is failing anywhere, expand all
    const anyFailing = allMonitors.some(m => m.currentStatus === 'fail');
    for (const key of envKeys) {
      if (this.expandedEnvironments[key] === undefined) {
        if (!anyFailing) {
          this.expandedEnvironments[key] = true;
        } else {
          const envFails = (allByEnv[key] || []).some(m => m.currentStatus === 'fail');
          this.expandedEnvironments[key] = envFails;
        }
      }
    }

    // Only render env sections that have filtered monitors (or all if showing totals)
    const sectionsHtml = envKeys.map(envKey => {
      const envFiltered = filteredByEnv[envKey] || [];
      const envAll = allByEnv[envKey] || [];
      // Skip env sections with 0 filtered monitors
      if (envFiltered.length === 0) return '';
      return this.renderEnvironmentSection(envKey, envFiltered, envAll);
    }).join('');

    return `<div class="dc-env-list">${sectionsHtml}</div>`;
  },

  renderEnvironmentSection(envKey, filteredMonitors, allEnvMonitors) {
    const envName = this.extractEnvName(envKey);
    const isExpanded = this.expandedEnvironments[envKey] !== false;

    // Stats from ALL monitors in this env (not just filtered)
    const failCount = allEnvMonitors.filter(m => m.currentStatus === 'fail').length;
    const passCount = allEnvMonitors.filter(m => m.currentStatus === 'pass').length;
    const errorCount = allEnvMonitors.filter(m => m.currentStatus === 'error' || m.currentStatus === 'unknown' || !m.lastCheckedAt).length;
    const totalCount = allEnvMonitors.length;

    // Health: red if any fail, amber if any error, green otherwise
    const healthClass = failCount > 0 ? 'dc-env-health-fail' : errorCount > 0 ? 'dc-env-health-error' : 'dc-env-health-pass';
    const borderClass = failCount > 0 ? 'dc-env-border-fail' : errorCount > 0 ? 'dc-env-border-error' : 'dc-env-border-pass';

    return `
      <div class="dc-env-section ${borderClass}">
        <button class="dc-env-header" data-env-key="${escapeHtml(envKey)}">
          <span class="dc-env-toggle">${isExpanded ? '&#9660;' : '&#9654;'}</span>
          <span class="dc-env-health ${healthClass}"></span>
          <span class="dc-env-name">${escapeHtml(envName)}</span>
          <span class="dc-env-url">${escapeHtml(envKey)}</span>
          <span class="dc-env-badges">
            ${failCount > 0 ? `<span class="dc-badge dc-badge-fail">${failCount} failing</span>` : ''}
            ${passCount > 0 ? `<span class="dc-badge dc-badge-pass">${passCount} clear</span>` : ''}
            ${errorCount > 0 ? `<span class="dc-badge dc-badge-error">${errorCount} error</span>` : ''}
            <span class="dc-badge">${totalCount} total</span>
          </span>
          <span class="dc-env-run-all" data-env-url="${escapeHtml(envKey)}" title="Run all checks for ${escapeHtml(envName)}">&#9654; Run</span>
        </button>
        ${isExpanded ? `
          <div class="dc-env-body">
            ${this.renderExceptionsList(filteredMonitors)}
          </div>
        ` : ''}
      </div>
    `;
  },

  renderExceptionsList(monitors) {
    // Group if sort is by group
    if (this.sortBy === 'group') {
      return this.renderGroupedList(monitors);
    }

    return `
      <div class="dc-list">
        ${monitors.map(m => this.renderRow(m)).join('')}
      </div>
    `;
  },

  renderGroupedList(monitors) {
    const groups = {};
    for (const m of monitors) {
      const g = m.groupName || 'Ungrouped';
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    }

    return `
      <div class="dc-list">
        ${Object.entries(groups).map(([group, items]) => {
          const failCount = items.filter(m => m.currentStatus === 'fail').length;
          const isExpanded = this.expandedGroups[group] !== false;
          return `
            <div class="dc-group">
              <button class="dc-group-header" data-group="${escapeHtml(group)}">
                <span class="dc-group-toggle">${isExpanded ? '&#9660;' : '&#9654;'}</span>
                <span class="dc-group-name">${escapeHtml(group)}</span>
                <span class="dc-group-stats">
                  ${failCount > 0 ? `<span class="dc-badge dc-badge-fail">${failCount} failing</span>` : ''}
                  <span class="dc-badge">${items.length} checks</span>
                </span>
              </button>
              ${isExpanded ? items.map(m => this.renderRow(m)).join('') : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  renderRow(monitor) {
    const status = monitor.currentStatus || 'unknown';
    const isFail = status === 'fail';
    const isError = status === 'error' || status === 'unknown';
    const isPass = status === 'pass';
    const value = monitor.lastValue;
    const hasValue = value !== null && value !== undefined;
    const severity = monitor.severity || 'medium';
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

    const passRate = monitor.stats24h && monitor.stats24h.passRate ? monitor.stats24h.passRate : null;
    const avgExec = monitor.stats24h && monitor.stats24h.avgExecutionTimeMs ? monitor.stats24h.avgExecutionTimeMs : null;

    const lastCheckedLabel = monitor.lastCheckedAt
      ? this.timeAgo(new Date(monitor.lastCheckedAt.endsWith('Z') ? monitor.lastCheckedAt : monitor.lastCheckedAt + 'Z'))
      : 'Never';

    return `
      <a href="#/sanity-checks/${monitor.id}" class="dc-row ${isFail ? 'dc-row-fail' : isError ? 'dc-row-error' : 'dc-row-pass'}">
        <div class="dc-row-status">
          <span class="dc-status-indicator dc-status-${isFail ? 'fail' : isError ? 'error' : 'pass'}"></span>
        </div>
        <div class="dc-row-main">
          <div class="dc-row-title">
            <span class="dc-row-name">${escapeHtml(monitor.name)}</span>
            <span class="dc-row-code">${escapeHtml(monitor.code)}</span>
            ${monitor.groupName ? `<span class="dc-row-group">${escapeHtml(monitor.groupName)}</span>` : ''}
          </div>
          <div class="dc-row-meta">
            <span class="dc-severity dc-severity-${severity}">${severity}</span>
            ${passRate !== null ? `<span class="dc-row-meta-item">Pass rate: ${passRate}%</span>` : ''}
            ${avgExec !== null ? `<span class="dc-row-meta-item">${avgExec}ms</span>` : ''}
            <span class="dc-row-meta-item dc-row-time">${lastCheckedLabel}</span>
          </div>
        </div>
        <div class="dc-row-value-col">
          ${hasValue ? `
            <div class="dc-row-value ${isFail ? 'dc-value-bad' : 'dc-value-ok'}">
              ${this.formatNumber(value)}
            </div>
            ${isFail ? '<div class="dc-row-value-label">exceptions</div>' : '<div class="dc-row-value-label">records</div>'}
          ` : `
            <div class="dc-row-value dc-value-none">&mdash;</div>
          `}
        </div>
        <div class="dc-row-actions">
          <button class="dc-btn-run" data-id="${monitor.id}" title="Run now">&#9654;</button>
        </div>
      </a>
    `;
  },

  renderEmptyState() {
    if (this.filterStatus === 'failing') {
      return `
        <div class="dc-empty dc-empty-good">
          <div class="dc-empty-icon">&#10003;</div>
          <h2>All clear</h2>
          <p>No data checks are currently failing. All exceptions have been resolved.</p>
          <button class="btn btn-secondary btn-sm" data-filter="all">View all checks</button>
        </div>
      `;
    }
    return `
      <div class="dc-empty">
        <h2>No checks found</h2>
        <p>Sync from a Pulse Client or add checks manually.</p>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:1rem;">
          <button class="btn btn-secondary" id="btn-sync-client-empty">Sync from Client</button>
          <a href="#/sanity-checks/add" class="btn btn-primary">+ Add Check</a>
        </div>
      </div>
    `;
  },

  sortMonitors(monitors) {
    const sevWeight = { critical: 0, high: 1, medium: 2, low: 3 };
    switch (this.sortBy) {
      case 'value-desc':
        return [...monitors].sort((a, b) => (parseFloat(b.lastValue) || 0) - (parseFloat(a.lastValue) || 0));
      case 'value-asc':
        return [...monitors].sort((a, b) => (parseFloat(a.lastValue) || 0) - (parseFloat(b.lastValue) || 0));
      case 'severity':
        return [...monitors].sort((a, b) => (sevWeight[a.severity] || 2) - (sevWeight[b.severity] || 2));
      case 'name':
        return [...monitors].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      case 'last-checked':
        return [...monitors].sort((a, b) => new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0));
      case 'group':
        return [...monitors].sort((a, b) => (a.groupName || 'zzz').localeCompare(b.groupName || 'zzz'));
      default:
        return monitors;
    }
  },

  bindEvents(app, isMultiEnv) {
    // Filter cards
    app.querySelectorAll('[data-filter]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.filterStatus = el.dataset.filter;
        this.render(app);
      });
    });

    // Sort
    const sortSelect = document.getElementById('dc-sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        this.sortBy = sortSelect.value;
        this.render(app);
      });
    }

    // Run now buttons
    app.querySelectorAll('.dc-btn-run').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.checkNow(btn.dataset.id, app);
      });
    });

    // Run all button
    const runAllBtn = document.getElementById('btn-run-all');
    if (runAllBtn) {
      runAllBtn.addEventListener('click', () => this.runAll(app));
    }

    // Sync button(s) — bind both the top-bar and empty-state buttons
    [document.getElementById('btn-sync-client'), document.getElementById('btn-sync-client-empty')]
      .filter(Boolean)
      .forEach(btn => btn.addEventListener('click', () => this.syncFromClient(app)));

    // Group toggles
    app.querySelectorAll('.dc-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.dataset.group;
        this.expandedGroups[group] = this.expandedGroups[group] === false;
        this.render(app);
      });
    });

    // Environment header toggles
    app.querySelectorAll('.dc-env-header').forEach(header => {
      header.addEventListener('click', (e) => {
        // Don't toggle if clicking the "Run" button
        if (e.target.closest('.dc-env-run-all')) return;
        const envKey = header.dataset.envKey;
        this.expandedEnvironments[envKey] = !this.expandedEnvironments[envKey];
        this.render(app);
      });
    });

    // Per-environment "Run" buttons
    app.querySelectorAll('.dc-env-run-all').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.runAllForEnv(btn.dataset.envUrl, app);
      });
    });

    // Collapse/Expand All environments toggle
    const toggleAllBtn = document.getElementById('dc-env-toggle-all');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const allExpanded = Object.values(this.expandedEnvironments).every(v => v !== false);
        const newState = !allExpanded;
        for (const key of Object.keys(this.expandedEnvironments)) {
          this.expandedEnvironments[key] = newState;
        }
        this.render(app);
      });
    }
  },

  async syncFromClient(app) {
    const clientUrl = prompt('Enter the Pulse Client URL:', 'https://dev.iconcile.com/pulse-client');
    if (!clientUrl) return;

    try {
      const result = await API.post('/sanity-checks/discover-all', { clientUrl });
      await Modal.alert(`Sync complete: ${result.created} created, ${result.skipped} already existed (${result.total} total checks)`);
      this.render(app);
    } catch (err) {
      Modal.alert('Sync failed: ' + err.message);
    }
  },

  async checkNow(id, app) {
    try {
      await API.post(`/sanity-checks/${id}/check`);
      this.silentRefresh(app);
    } catch (err) {
      Modal.alert('Check failed: ' + err.message);
    }
  },

  async runAll(app) {
    const btn = document.getElementById('btn-run-all');
    if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }

    try {
      const monitors = await API.get('/sanity-checks');
      const active = monitors.filter(m => m.isActive);
      let completed = 0;

      for (const m of active) {
        try {
          await API.post(`/sanity-checks/${m.id}/check`);
          completed++;
        } catch { /* continue */ }
      }

      if (btn) { btn.disabled = false; btn.textContent = 'Run All'; }
      this.render(app);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Run All'; }
      Modal.alert('Run all failed: ' + err.message);
    }
  },

  async runAllForEnv(envUrl, app) {
    // Find the button and disable it
    const btn = app.querySelector(`.dc-env-run-all[data-env-url="${CSS.escape(envUrl)}"]`);
    if (btn) { btn.textContent = 'Running...'; btn.style.pointerEvents = 'none'; }

    try {
      const monitors = await API.get('/sanity-checks');
      const envMonitors = monitors.filter(m => this.extractEnvKey(m.clientUrl) === envUrl && m.isActive);

      for (const m of envMonitors) {
        try {
          await API.post(`/sanity-checks/${m.id}/check`);
        } catch { /* continue */ }
      }

      this.render(app);
    } catch (err) {
      if (btn) { btn.textContent = '\u25B6 Run'; btn.style.pointerEvents = ''; }
      Modal.alert('Run failed: ' + err.message);
    }
  },

  formatNumber(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  },

  timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  },
};
