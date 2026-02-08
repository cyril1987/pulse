const MonitorDetail = {
  async render(container, id) {
    container.innerHTML = '<div class="loading">Loading monitor...</div>';

    try {
      const [monitor, stats, latestChecks, checksPage] = await Promise.all([
        API.get(`/monitors/${id}`),
        API.get(`/monitors/${id}/stats`),
        API.get(`/monitors/${id}/checks/latest?limit=50`),
        API.get(`/monitors/${id}/checks?limit=20&offset=0`),
      ]);

      MonitorDetail.renderContent(container, monitor, stats, latestChecks, checksPage);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
  },

  renderContent(container, monitor, stats, latestChecks, checksPage) {
    const statusClass = monitor.isActive ? monitor.currentStatus : 'paused';
    const statusLabel = monitor.isActive ? monitor.currentStatus : 'paused';
    const stat24h = stats['24h'] || {};
    const stat7d = stats['7d'] || {};

    let html = `
      <div class="detail-header">
        <div class="detail-info">
          <h2>
            <span class="status-dot ${statusClass}"></span>
            ${escapeHtml(monitor.name)}
          </h2>
          <div class="detail-url">${escapeHtml(monitor.url)}</div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary btn-sm" id="check-now-btn" onclick="MonitorDetail.checkNow(${monitor.id})">Check Now</button>
          <a href="#/edit/${monitor.id}" class="btn btn-secondary btn-sm">Edit</a>
          ${
            monitor.isActive
              ? `<div class="downtime-dropdown">
                  <button class="btn btn-secondary btn-sm" onclick="MonitorDetail.toggleDowntimeMenu(event)">Schedule Downtime</button>
                  <div class="downtime-menu" id="downtime-menu">
                    <div class="downtime-menu-title">Pause monitoring for:</div>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 900)">15 minutes</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 1800)">30 minutes</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 3600)">1 hour</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 7200)">2 hours</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 14400)">4 hours</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 28800)">8 hours</button>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 86400)">24 hours</button>
                    <div class="downtime-menu-divider"></div>
                    <button onclick="MonitorDetail.scheduleDowntime(${monitor.id}, 0)">Indefinitely</button>
                  </div>
                </div>`
              : `<button class="btn btn-primary btn-sm" onclick="MonitorDetail.resume(${monitor.id})">Resume</button>`
          }
          <button class="btn btn-danger btn-sm" onclick="MonitorDetail.remove(${monitor.id})">Delete</button>
        </div>
      </div>

      ${!monitor.isActive ? `
        <div class="downtime-banner">
          <div class="downtime-banner-icon">&#9208;</div>
          <div class="downtime-banner-text">
            <strong>Monitoring paused</strong>
            ${monitor.pausedUntil
              ? `<span>Auto-resumes at ${new Date(monitor.pausedUntil + 'Z').toLocaleString()} (<span id="downtime-countdown" data-until="${monitor.pausedUntil}"></span>)</span>`
              : '<span>Paused indefinitely</span>'
            }
          </div>
          <button class="btn btn-primary btn-sm" onclick="MonitorDetail.resume(${monitor.id})">Resume Now</button>
        </div>
      ` : ''}

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" style="color: var(--color-${statusClass})">${statusLabel.toUpperCase()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime (24h)</div>
          <div class="stat-value">${stat24h.uptimePercent !== null ? stat24h.uptimePercent + '%' : '--'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Avg Response (24h)</div>
          <div class="stat-value">${stat24h.avgResponseMs !== null ? stat24h.avgResponseMs + 'ms' : '--'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Uptime (7d)</div>
          <div class="stat-value">${stat7d.uptimePercent !== null ? stat7d.uptimePercent + '%' : '--'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Checks (24h)</div>
          <div class="stat-value">${stat24h.totalChecks || 0}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Frequency</div>
          <div class="stat-value">${MonitorDetail.formatFrequency(monitor.frequencySeconds)}</div>
        </div>
      </div>

      <div class="chart-container">
        <h3>Response Time (recent checks)</h3>
        <canvas id="response-chart"></canvas>
      </div>

      <div class="checks-section">
        <h3>Recent Checks</h3>
        <table class="checks-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Code</th>
              <th>Response Time</th>
              <th>Error</th>
              <th>Checked At</th>
            </tr>
          </thead>
          <tbody>
            ${checksPage.checks.length === 0 ? '<tr><td colspan="5" style="text-align:center;padding:1.5rem">No checks recorded yet</td></tr>' : ''}
            ${checksPage.checks
              .map(
                (c) => `
              <tr>
                <td><span class="${c.isSuccess ? 'success' : 'failure'}">${c.isSuccess ? 'OK' : 'FAIL'}</span></td>
                <td>${c.statusCode || '--'}</td>
                <td>${c.responseTimeMs !== null ? c.responseTimeMs + 'ms' : '--'}</td>
                <td>${c.errorMessage ? escapeHtml(c.errorMessage) : '--'}</td>
                <td>${new Date(c.checkedAt + 'Z').toLocaleString()}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        ${
          checksPage.total > checksPage.limit
            ? `<div class="pagination">
                <span>${checksPage.total} total checks</span>
              </div>`
            : ''
        }
      </div>

      ${monitor.customHeaders && monitor.customHeaders.length > 0 ? `
        <div class="chart-container" style="margin-top:1rem">
          <h3 style="margin-bottom:0.5rem">Custom Headers</h3>
          <div style="font-size:0.82rem;color:var(--color-text-secondary)">
            ${monitor.customHeaders.map(h => `<div style="margin-bottom:0.25rem"><strong>${escapeHtml(h.key)}</strong>: <code>${escapeHtml(h.value)}</code></div>`).join('')}
          </div>
        </div>
      ` : ''}

      <div class="detail-meta">
        <span>Notify: ${escapeHtml(monitor.notifyEmail)}</span>
        <span>Expected: ${monitor.expectedStatus}</span>
        <span>Timeout: ${monitor.timeoutMs}ms</span>
        ${monitor.customHeaders && monitor.customHeaders.length > 0 ? `<span>Headers: ${monitor.customHeaders.length} custom</span>` : ''}
        <span>Created: ${new Date(monitor.createdAt + 'Z').toLocaleString()}</span>
      </div>
    `;

    container.innerHTML = html;

    // Start countdown timer if paused with a scheduled end
    if (MonitorDetail._countdownTimer) {
      clearInterval(MonitorDetail._countdownTimer);
      MonitorDetail._countdownTimer = null;
    }
    MonitorDetail.startCountdown();

    // Draw response time chart
    const canvas = document.getElementById('response-chart');
    if (canvas && latestChecks.length > 0) {
      const values = latestChecks.map((c) => (c.isSuccess ? c.responseTimeMs : null));
      const labels = latestChecks.map((c) => {
        const d = new Date(c.checkedAt + 'Z');
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      });
      Chart.line(canvas, { values, labels });
    }
  },

  formatFrequency(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.round(seconds / 60) + 'm';
    return Math.round(seconds / 3600) + 'h';
  },

  async checkNow(id) {
    const btn = document.getElementById('check-now-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Checking...';
    }
    try {
      const result = await API.post(`/monitors/${id}/check`);
      const check = result.check;
      const msg = check.isSuccess
        ? `OK — ${check.statusCode} in ${check.responseTimeMs}ms`
        : `FAILED — ${check.errorMessage || 'Status ' + check.statusCode}`;
      alert(msg);
      MonitorDetail.render(document.getElementById('app'), id);
    } catch (err) {
      alert('Check failed: ' + err.message);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Check Now';
      }
    }
  },

  async pause(id) {
    try {
      await API.post(`/monitors/${id}/pause`);
      MonitorDetail.render(document.getElementById('app'), id);
    } catch (err) {
      alert('Failed to pause: ' + err.message);
    }
  },

  async resume(id) {
    try {
      await API.post(`/monitors/${id}/resume`);
      MonitorDetail.render(document.getElementById('app'), id);
    } catch (err) {
      alert('Failed to resume: ' + err.message);
    }
  },

  async remove(id) {
    if (!confirm('Are you sure you want to delete this monitor? This cannot be undone.')) return;
    try {
      await API.delete(`/monitors/${id}`);
      location.hash = '#/';
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  },

  toggleDowntimeMenu(event) {
    event.stopPropagation();
    const menu = document.getElementById('downtime-menu');
    if (menu) {
      menu.classList.toggle('open');
    }
    // Close menu when clicking elsewhere
    const closeMenu = () => {
      if (menu) menu.classList.remove('open');
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  },

  async scheduleDowntime(id, duration) {
    try {
      await API.post(`/monitors/${id}/downtime`, { duration });
      MonitorDetail.render(document.getElementById('app'), id);
    } catch (err) {
      alert('Failed to schedule downtime: ' + err.message);
    }
  },

  startCountdown() {
    const el = document.getElementById('downtime-countdown');
    if (!el) return;
    const update = () => {
      const until = new Date(el.dataset.until + 'Z').getTime();
      const now = Date.now();
      const diff = until - now;
      if (diff <= 0) {
        el.textContent = 'resuming...';
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const parts = [];
      if (h > 0) parts.push(h + 'h');
      if (m > 0) parts.push(m + 'm');
      parts.push(s + 's');
      el.textContent = parts.join(' ') + ' remaining';
    };
    update();
    MonitorDetail._countdownTimer = setInterval(update, 1000);
  },
};
