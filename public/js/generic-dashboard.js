const GenericDashboard = {
  refreshTimer: null,
  collapsedGroups: new Set(),
  defaultsApplied: false,

  async render(container) {
    if (GenericDashboard.refreshTimer) {
      clearInterval(GenericDashboard.refreshTimer);
      GenericDashboard.refreshTimer = null;
    }

    container.innerHTML = '<div class="loading">Loading monitors...</div>';

    try {
      const monitors = await API.get('/generic-monitors');
      GenericDashboard.renderContent(container, monitors);

      GenericDashboard.refreshTimer = setInterval(async () => {
        try {
          const updated = await API.get('/generic-monitors');
          GenericDashboard.renderContent(container, updated);
        } catch (e) {
          console.error('Refresh failed:', e);
        }
      }, 30000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error loading monitors</h2><p>${err.message}</p></div>`;
    }
  },

  renderContent(container, monitors) {
    const upCount = monitors.filter(m => m.currentStatus === 'up').length;
    const downCount = monitors.filter(m => m.currentStatus === 'down').length;
    const degradedCount = monitors.filter(m => m.currentStatus === 'degraded').length;
    const unknownCount = monitors.filter(m => m.currentStatus === 'unknown').length;

    let html = `
      <div class="summary-bar">
        <div class="summary-stat">
          <div class="label">Total</div>
          <div class="value">${monitors.length}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Up</div>
          <div class="value up">${upCount}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Down</div>
          <div class="value down">${downCount}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Degraded</div>
          <div class="value" style="color:var(--color-warning,#f59e0b)">${degradedCount}</div>
        </div>
        <div class="summary-stat">
          <div class="label">Unknown</div>
          <div class="value unknown">${unknownCount}</div>
        </div>
      </div>
      <div class="tasks-toolbar">
        <div class="tasks-toolbar-row" style="justify-content:space-between;align-items:center">
          <div style="font-size:0.82rem;color:var(--color-text-tertiary)">
            Monitors auto-register when clients send reports to <code>POST /report</code>
          </div>
        </div>
      </div>
    `;

    if (monitors.length === 0) {
      html += `
        <div class="empty-state">
          <h2>No monitors yet</h2>
          <p>Monitors appear automatically when clients send their first report.</p>
          <div style="margin-top:1rem;text-align:left;max-width:480px;margin-left:auto;margin-right:auto">
            <p style="font-size:0.85rem;color:var(--color-text-secondary);margin-bottom:0.5rem"><strong>Send a report:</strong></p>
            <pre style="background:var(--color-bg-secondary);padding:1rem;border-radius:8px;font-size:0.78rem;overflow-x:auto;text-align:left">curl -X POST ${location.origin}/report \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "My App Server",
    "group": "Production",
    "status": "up",
    "message": "All systems operational",
    "metrics": {
      "cpu": "23%",
      "memory": "1.2GB/4GB"
    },
    "environment": {
      "os": "Ubuntu 22.04",
      "version": "2.1.0"
    }
  }'</pre>
          </div>
        </div>
      `;
    } else {
      // Group monitors
      const groups = {};
      for (const m of monitors) {
        const groupName = m.group || null;
        if (!groups[groupName]) groups[groupName] = [];
        groups[groupName].push(m);
      }

      const groupNames = Object.keys(groups).sort((a, b) => {
        if (a === 'null') return 1;
        if (b === 'null') return -1;
        return a.localeCompare(b);
      });

      const hasMultipleGroups = groupNames.length > 1 || (groupNames.length === 1 && groupNames[0] !== 'null');

      if (hasMultipleGroups && !GenericDashboard.defaultsApplied) {
        GenericDashboard.defaultsApplied = true;
        for (const gName of groupNames) {
          const gId = gName === 'null' ? '__ungrouped__' : gName;
          GenericDashboard.collapsedGroups.add(gId);
        }
      }

      if (hasMultipleGroups) {
        const allCollapsed = groupNames.every(gName => {
          const gId = gName === 'null' ? '__ungrouped__' : gName;
          return GenericDashboard.collapsedGroups.has(gId);
        });
        const toggleLabel = allCollapsed ? 'Expand All' : 'Collapse All';
        html += `
          <div class="group-controls">
            <button class="group-controls-btn" id="generic-toggle-all-groups">${toggleLabel}</button>
          </div>
        `;
      }

      for (const gName of groupNames) {
        const groupMonitors = groups[gName];
        const isUngrouped = gName === 'null';
        const displayName = isUngrouped ? 'Ungrouped' : gName;
        const groupId = isUngrouped ? '__ungrouped__' : gName;
        const isCollapsed = GenericDashboard.collapsedGroups.has(groupId);

        const gUp = groupMonitors.filter(m => m.currentStatus === 'up').length;
        const gDown = groupMonitors.filter(m => m.currentStatus === 'down').length;
        const gOther = groupMonitors.length - gUp - gDown;

        let groupStatus = 'up';
        if (gDown > 0) groupStatus = 'down';
        else if (gUp === 0) groupStatus = 'unknown';

        if (hasMultipleGroups) {
          html += `
            <div class="group-section">
              <div class="group-header" data-group-id="${GenericDashboard.escapeHtml(groupId)}" role="button">
                <div class="group-header-left">
                  <span class="group-toggle ${isCollapsed ? 'collapsed' : ''}">&rsaquo;</span>
                  <span class="status-dot ${groupStatus}" style="display:inline-block"></span>
                  <span class="group-name">${GenericDashboard.escapeHtml(displayName)}</span>
                </div>
                <div class="group-header-stats">
                  <span class="group-stat">${groupMonitors.length} monitor${groupMonitors.length !== 1 ? 's' : ''}</span>
                  ${gUp > 0 ? `<span class="group-stat group-stat-up">${gUp} up</span>` : ''}
                  ${gDown > 0 ? `<span class="group-stat group-stat-down">${gDown} down</span>` : ''}
                  ${gOther > 0 ? `<span class="group-stat group-stat-other">${gOther} other</span>` : ''}
                </div>
              </div>
          `;
        }

        if (!isCollapsed || !hasMultipleGroups) {
          html += '<div class="monitors-grid">';
          html += GenericDashboard.renderMonitorCards(groupMonitors);
          html += '</div>';
        }

        if (hasMultipleGroups) {
          html += '</div>';
        }
      }
    }

    container.innerHTML = html;

    // Attach expand/collapse all toggle
    const toggleAllBtn = document.getElementById('generic-toggle-all-groups');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const groupIds = [];
        container.querySelectorAll('.group-header').forEach(h => groupIds.push(h.dataset.groupId));
        const allCollapsed = groupIds.every(id => GenericDashboard.collapsedGroups.has(id));
        if (allCollapsed) {
          GenericDashboard.collapsedGroups.clear();
        } else {
          groupIds.forEach(id => GenericDashboard.collapsedGroups.add(id));
        }
        GenericDashboard.renderContent(container, monitors);
      });
    }

    // Attach group toggle listeners
    container.querySelectorAll('.group-header').forEach(header => {
      header.addEventListener('click', () => {
        const groupId = header.dataset.groupId;
        if (GenericDashboard.collapsedGroups.has(groupId)) {
          GenericDashboard.collapsedGroups.delete(groupId);
        } else {
          GenericDashboard.collapsedGroups.add(groupId);
        }
        GenericDashboard.renderContent(container, monitors);
      });
    });
  },

  renderMonitorCards(monitors) {
    let html = '';
    for (const m of monitors) {
      const statusClass = m.currentStatus || 'unknown';
      const statusLabel = m.currentStatus || 'unknown';
      const lastReported = m.lastReportedAt
        ? new Date(m.lastReportedAt + 'Z').toLocaleString()
        : 'Never';

      // Render latest metrics as key-value pills
      let metricsHtml = '';
      if (m.latestMetrics && typeof m.latestMetrics === 'object') {
        const entries = Object.entries(m.latestMetrics).slice(0, 6);
        metricsHtml = entries.map(([k, v]) =>
          `<div class="card-stat-item"><span class="stat-label">${GenericDashboard.escapeHtml(k)}: </span><span class="stat-value">${GenericDashboard.escapeHtml(String(v))}</span></div>`
        ).join('');
      }

      // Render environment summary (first 3 keys)
      let envHtml = '';
      if (m.environment && typeof m.environment === 'object') {
        const entries = Object.entries(m.environment).slice(0, 3);
        envHtml = `<div class="card-env-info">${entries.map(([k, v]) =>
          `<span class="env-tag">${GenericDashboard.escapeHtml(k)}: ${GenericDashboard.escapeHtml(String(v))}</span>`
        ).join('')}</div>`;
      }

      html += `
        <a href="#/generic/${m.id}" class="monitor-card status-${statusClass}">
          <div class="card-header">
            <span class="card-name">${GenericDashboard.escapeHtml(m.name)}</span>
            <span class="status-badge ${statusClass}">
              <span class="status-dot ${statusClass}"></span>
              ${statusLabel}
            </span>
          </div>
          ${m.latestMessage ? `<div class="card-url">${GenericDashboard.escapeHtml(m.latestMessage)}</div>` : ''}
          ${envHtml}
          <div class="card-stats">
            ${metricsHtml}
            <div class="card-stat-item">
              <span class="stat-label">Last report: </span>
              <span class="stat-value">${lastReported}</span>
            </div>
          </div>
        </a>
      `;
    }
    return html;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
