const Dashboard = {
  refreshTimer: null,

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
      container.innerHTML = `<div class="empty-state"><h2>Error loading monitors</h2><p>${err.message}</p></div>`;
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
      html += '<div class="monitors-grid">';
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
      html += '</div>';
    }

    container.innerHTML = html;

    // Load sparklines
    for (const m of monitors) {
      Dashboard.loadSparkline(m.id);
    }
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
};

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
