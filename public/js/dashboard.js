const Dashboard = {
  refreshTimer: null,
  collapsedGroups: new Set(),
  defaultsApplied: false,

  async render(container) {
    if (Dashboard.refreshTimer) {
      clearInterval(Dashboard.refreshTimer);
      Dashboard.refreshTimer = null;
    }

    container.innerHTML = '<div class="loading">Loading monitors...</div>';

    try {
      const monitors = await API.get('/monitors');
      Dashboard.renderContent(container, monitors);

      Dashboard.refreshTimer = setInterval(async () => {
        try {
          const updated = await API.get('/monitors');
          Dashboard.renderContent(container, updated);
        } catch (e) {
          console.error('Refresh failed:', e);
        }
      }, 30000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error loading monitors</h2><p>${escapeHtml(err.message)}</p></div>`;
    }
  },

  renderContent(container, monitors) {
    const upCount = monitors.filter((m) => m.currentStatus === 'up').length;
    const downCount = monitors.filter((m) => m.currentStatus === 'down').length;
    const unknownCount = monitors.filter(
      (m) => m.currentStatus === 'unknown' || !m.isActive
    ).length;

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
          <div class="label">Unknown / Paused</div>
          <div class="value unknown">${unknownCount}</div>
        </div>
      </div>
      <div class="tasks-toolbar">
        <div class="tasks-toolbar-row" style="justify-content:flex-end">
          <div class="tasks-toolbar-actions">
            <a href="#/upload" class="btn btn-secondary btn-sm">↑ Bulk Upload</a>
            <a href="#/add" class="btn btn-primary btn-sm">+ Add Monitor</a>
          </div>
        </div>
      </div>
    `;

    if (monitors.length === 0) {
      html += `
        <div class="empty-state">
          <h2>No monitors yet</h2>
          <p>Add your first URL monitor to get started.</p>
          <a href="#/add" class="btn btn-primary">+ Add Monitor</a>
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

      // Sort: named groups alphabetically first, ungrouped last
      const groupNames = Object.keys(groups).sort((a, b) => {
        if (a === 'null') return 1;
        if (b === 'null') return -1;
        return a.localeCompare(b);
      });

      const hasMultipleGroups = groupNames.length > 1 || (groupNames.length === 1 && groupNames[0] !== 'null');

      // Default: collapse all groups on first load
      if (hasMultipleGroups && !Dashboard.defaultsApplied) {
        Dashboard.defaultsApplied = true;
        for (const gName of groupNames) {
          const gId = gName === 'null' ? '__ungrouped__' : gName;
          Dashboard.collapsedGroups.add(gId);
        }
      }

      // Expand / Collapse all toggle
      if (hasMultipleGroups) {
        const allCollapsed = groupNames.every(gName => {
          const gId = gName === 'null' ? '__ungrouped__' : gName;
          return Dashboard.collapsedGroups.has(gId);
        });
        const toggleLabel = allCollapsed ? 'Expand All' : 'Collapse All';
        const toggleIcon = allCollapsed
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
        html += `
          <div class="group-controls">
            <button class="group-controls-btn" id="toggle-all-groups">
              ${toggleIcon} ${toggleLabel}
            </button>
          </div>
        `;
      }

      for (const gName of groupNames) {
        const groupMonitors = groups[gName];
        const isUngrouped = gName === 'null';
        const displayName = isUngrouped ? 'Ungrouped' : gName;
        const groupId = isUngrouped ? '__ungrouped__' : gName;
        const isCollapsed = Dashboard.collapsedGroups.has(groupId);

        const gUp = groupMonitors.filter(m => m.currentStatus === 'up').length;
        const gDown = groupMonitors.filter(m => m.currentStatus === 'down').length;
        const gOther = groupMonitors.length - gUp - gDown;

        // Determine overall group status
        let groupStatus = 'up';
        if (gDown > 0) groupStatus = 'down';
        else if (gUp === 0) groupStatus = 'unknown';

        if (hasMultipleGroups) {
          html += `
            <div class="group-section">
              <div class="group-header" data-group-id="${escapeHtml(groupId)}" role="button">
                <div class="group-header-left">
                  <span class="group-toggle ${isCollapsed ? 'collapsed' : ''}">&rsaquo;</span>
                  <span class="status-dot ${groupStatus}" style="display:inline-block"></span>
                  <span class="group-name">${escapeHtml(displayName)}</span>
                </div>
                <div class="group-header-stats">
                  <span class="group-stat">${groupMonitors.length} monitor${groupMonitors.length !== 1 ? 's' : ''}</span>
                  ${gUp > 0 ? `<span class="group-stat group-stat-up">${gUp} up</span>` : ''}
                  ${gDown > 0 ? `<span class="group-stat group-stat-down">${gDown} down</span>` : ''}
                  ${gOther > 0 ? `<span class="group-stat group-stat-other">${gOther} other</span>` : ''}
                </div>
              </div>
          `;

          // Show combined sparkline when collapsed
          if (isCollapsed) {
            const monitorIds = groupMonitors.map(m => m.id).join(',');
            html += `
              <div class="group-sparkline-row">
                <canvas data-group-combined-sparkline="${escapeHtml(groupId)}" data-monitor-ids="${monitorIds}"></canvas>
              </div>
            `;
          }
        }

        if (!isCollapsed || !hasMultipleGroups) {
          html += '<div class="monitors-grid">';
          html += Dashboard.renderMonitorCards(groupMonitors);
          html += '</div>';
        }

        if (hasMultipleGroups) {
          html += '</div>';
        }
      }
    }

    container.innerHTML = html;

    // Attach expand/collapse all toggle
    const toggleAllBtn = document.getElementById('toggle-all-groups');
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        const groupIds = [];
        container.querySelectorAll('.group-header').forEach(h => groupIds.push(h.dataset.groupId));
        const allCollapsed = groupIds.every(id => Dashboard.collapsedGroups.has(id));
        if (allCollapsed) {
          Dashboard.collapsedGroups.clear();
        } else {
          groupIds.forEach(id => Dashboard.collapsedGroups.add(id));
        }
        Dashboard.renderContent(container, monitors);
      });
    }

    // Attach group toggle listeners
    container.querySelectorAll('.group-header').forEach(header => {
      header.addEventListener('click', () => {
        const groupId = header.dataset.groupId;
        if (Dashboard.collapsedGroups.has(groupId)) {
          Dashboard.collapsedGroups.delete(groupId);
        } else {
          Dashboard.collapsedGroups.add(groupId);
        }
        Dashboard.renderContent(container, monitors);
      });
    });

    // Load sparklines only for visible (non-collapsed) monitor cards
    container.querySelectorAll('canvas[data-monitor-id]').forEach(canvas => {
      Dashboard.loadSparkline(parseInt(canvas.dataset.monitorId, 10));
    });

    // Load combined sparklines for collapsed groups
    container.querySelectorAll('canvas[data-group-combined-sparkline]').forEach(canvas => {
      const monitorIds = canvas.dataset.monitorIds.split(',').map(Number);
      Dashboard.loadCombinedGroupSparkline(monitorIds, canvas);
    });
  },

  renderMonitorCards(monitors) {
    let html = '';
    for (const m of monitors) {
      const statusClass = m.isActive ? m.currentStatus : 'paused';
      const statusLabel = m.isActive ? m.currentStatus : 'paused';
      const uptime =
        m.uptimePercent24h !== null ? m.uptimePercent24h + '%' : '--';
      const avgMs =
        m.avgResponseMs24h !== null ? m.avgResponseMs24h + 'ms' : '--';
      const lastChecked = m.lastCheckedAt
        ? new Date(m.lastCheckedAt + 'Z').toLocaleString()
        : 'Never';

      let downtimeInfo = '';
      if (!m.isActive && m.pausedUntil) {
        downtimeInfo = `<div class="card-downtime-info" data-until="${m.pausedUntil}">&#9208; Resumes at ${new Date(m.pausedUntil + 'Z').toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>`;
      } else if (!m.isActive) {
        downtimeInfo = '<div class="card-downtime-info">&#9208; Paused indefinitely</div>';
      }

      html += `
        <a href="#/${m.id}" class="monitor-card status-${statusClass}">
          <div class="card-header">
            <span class="card-name">${escapeHtml(m.name)}</span>
            <span class="status-badge ${statusClass}">
              <span class="status-dot ${statusClass}"></span>
              ${statusLabel}
            </span>
          </div>
          <div class="card-url">${escapeHtml(m.url)}</div>
          ${downtimeInfo}
          <div class="card-stats">
            <div class="card-stat-item">
              <span class="stat-label">Uptime (24h): </span>
              <span class="stat-value">${uptime}</span>
            </div>
            <div class="card-stat-item">
              <span class="stat-label">Avg: </span>
              <span class="stat-value">${avgMs}</span>
            </div>
            <div class="card-stat-item">
              <span class="stat-label">Checked: </span>
              <span class="stat-value">${lastChecked}</span>
            </div>
          </div>
          <div class="card-sparkline">
            <canvas data-monitor-id="${m.id}"></canvas>
          </div>
          <div class="card-actions">
            <button class="btn btn-primary btn-sm" data-check-id="${m.id}" onclick="event.preventDefault();event.stopPropagation();Dashboard.checkNow(${m.id},this)">Check Now</button>
          </div>
        </a>
      `;
    }
    return html;
  },

  async checkNow(monitorId, btn) {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checking...';
    }
    try {
      const result = await API.post(`/monitors/${monitorId}/check`);
      const check = result.check;
      if (btn) {
        btn.textContent = check.isSuccess ? 'OK' : 'FAIL';
        btn.className = check.isSuccess
          ? 'btn btn-sm' + ' btn-primary'
          : 'btn btn-sm' + ' btn-danger';
      }
      // Refresh dashboard after a short delay to show updated status
      setTimeout(() => {
        const app = document.getElementById('app');
        if (location.hash === '#/' || location.hash === '' || location.hash === '#') {
          Dashboard.render(app);
        }
      }, 1000);
    } catch (err) {
      if (btn) {
        btn.textContent = 'Error';
        btn.disabled = false;
      }
    }
  },

  async loadSparkline(monitorId) {
    try {
      const checks = await API.get(
        `/monitors/${monitorId}/checks/latest?limit=20`
      );
      const canvas = document.querySelector(
        `canvas[data-monitor-id="${monitorId}"]`
      );
      if (canvas && checks.length > 0) {
        Chart.sparkline(canvas, checks);
      }
    } catch (e) {
      // Sparkline loading is best-effort
    }
  },

  async loadCombinedGroupSparkline(monitorIds, canvas) {
    try {
      // Fetch checks for all monitors in parallel
      const allChecks = await Promise.all(
        monitorIds.map(id => API.get(`/monitors/${id}/checks/latest?limit=20`).catch(() => []))
      );

      // Merge by time slot index: worst status wins, use max response time
      const maxLen = Math.max(...allChecks.map(c => c.length), 0);
      if (maxLen === 0) return;

      const combined = [];
      for (let i = 0; i < maxLen; i++) {
        let worstSuccess = true;
        let maxResponseMs = 0;
        let hasData = false;

        for (const checks of allChecks) {
          if (i < checks.length) {
            hasData = true;
            if (!checks[i].isSuccess) worstSuccess = false;
            if (checks[i].responseTimeMs > maxResponseMs) {
              maxResponseMs = checks[i].responseTimeMs;
            }
          }
        }

        if (hasData) {
          combined.push({
            isSuccess: worstSuccess,
            responseTimeMs: maxResponseMs,
          });
        }
      }

      if (canvas && combined.length > 0) {
        Chart.sparkline(canvas, combined);
      }
    } catch (e) {
      // Sparkline loading is best-effort
    }
  },
};

// escapeHtml is defined in api.js (loaded before this file)
