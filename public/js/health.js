const Health = {
  refreshTimer: null,

  async fetchDetails() {
    const res = await fetch('/health/details');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async render(container) {
    container.innerHTML = '<div class="loading">Loading health status...</div>';

    try {
      const data = await Health.fetchDetails();
      if (!data) return;
      Health.renderContent(container, data);

      // Auto-refresh every 30 seconds
      Health.refreshTimer = setInterval(async () => {
        try {
          const freshData = await Health.fetchDetails();
          if (freshData) Health.renderContent(container, freshData);
        } catch {}
      }, 30000);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
  },

  renderContent(container, data) {
    const overallColor = data.status === 'healthy'
      ? 'var(--color-up)' : data.status === 'degraded'
      ? 'var(--color-paused)' : 'var(--color-down)';

    const uptimeStr = Health.formatUptime(data.uptime);

    container.innerHTML = `
      <div style="max-width:800px;margin:0 auto">
        <div class="detail-header" style="margin-bottom:1.5rem">
          <div class="detail-info">
            <h2 style="display:flex;align-items:center;gap:0.6rem">
              <span class="status-dot ${data.status === 'healthy' ? 'up' : data.status === 'degraded' ? 'paused' : 'down'}"></span>
              API Health
            </h2>
            <div class="detail-url">v${escapeHtml(data.version)} &bull; Node ${escapeHtml(data.nodeVersion)}</div>
          </div>
          <div>
            <span class="status-badge ${data.status === 'healthy' ? 'up' : data.status === 'degraded' ? 'paused' : 'down'}">
              <span class="status-dot ${data.status === 'healthy' ? 'up' : data.status === 'degraded' ? 'paused' : 'down'}"></span>
              ${data.status.toUpperCase()}
            </span>
          </div>
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">
          <div class="stat-card">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" style="font-size:1rem">${uptimeStr}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Memory (RSS)</div>
            <div class="stat-value" style="font-size:1rem">${data.memoryUsage.rss} MB</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Heap Used</div>
            <div class="stat-value" style="font-size:1rem">${data.memoryUsage.heapUsed} / ${data.memoryUsage.heapTotal} MB</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Started At</div>
            <div class="stat-value" style="font-size:0.78rem">${Health.formatTime(data.startedAt)}</div>
          </div>
        </div>

        ${Health.renderCheckCard('Database', data.checks.database, Health.renderDbDetails)}
        ${Health.renderCheckCard('Scheduler', data.checks.scheduler, Health.renderSchedulerDetails)}
        ${Health.renderCheckCard('Monitors', data.checks.monitors, Health.renderMonitorDetails)}
        ${Health.renderCheckCard('Recent Checks', data.checks.checks, Health.renderChecksDetails)}
        ${Health.renderCheckCard('SMTP', data.checks.smtp, Health.renderSmtpDetails)}
        ${Health.renderCheckCard('Authentication', data.checks.auth, Health.renderAuthDetails)}
      </div>
    `;
  },

  renderCheckCard(title, data, detailFn) {
    if (!data) return '';
    const status = data.status || 'ok';
    const statusClass = status === 'ok' ? 'up' : status === 'warning' ? 'paused' : 'down';
    const statusLabel = status === 'ok' ? 'OK' : status === 'warning' ? 'WARN' : 'ERROR';

    return `
      <div class="chart-container" style="margin-bottom:0.75rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
          <h3 style="margin:0">${title}</h3>
          <span class="status-badge ${statusClass}" style="font-size:0.62rem">
            <span class="status-dot ${statusClass}"></span>
            ${statusLabel}
          </span>
        </div>
        <div style="font-size:0.82rem;color:var(--color-text-secondary)">
          ${detailFn ? detailFn(data) : ''}
          ${data.error ? `<div style="color:var(--color-down);margin-top:0.5rem">Error: ${escapeHtml(data.error)}</div>` : ''}
        </div>
      </div>
    `;
  },

  renderDbDetails(data) {
    return `<span>Latency: <strong>${data.latencyMs ?? '-'}ms</strong></span>`;
  },

  renderSchedulerDetails(data) {
    const items = [
      `Running: <strong>${data.running ? 'Yes' : 'No'}</strong>`,
      `Interval: <strong>${(data.intervalMs / 1000)}s</strong>`,
    ];
    if (data.lastTickAt) {
      items.push(`Last tick: <strong>${Health.formatTime(data.lastTickAt)}</strong>`);
    }
    if (data.lastTickDurationMs !== null) {
      items.push(`Tick duration: <strong>${data.lastTickDurationMs}ms</strong>`);
    }
    if (data.lastTickError) {
      items.push(`<span style="color:var(--color-down)">Last error: ${escapeHtml(data.lastTickError)}</span>`);
    }
    return items.join(' &bull; ');
  },

  renderMonitorDetails(data) {
    const parts = [
      `Total: <strong>${data.total}</strong>`,
      `Active: <strong>${data.active}</strong>`,
      `Paused: <strong>${data.paused}</strong>`,
    ];
    if (data.byStatus) {
      for (const [status, count] of Object.entries(data.byStatus)) {
        const color = status === 'up' ? 'var(--color-up)' : status === 'down' ? 'var(--color-down)' : 'var(--color-text-tertiary)';
        parts.push(`<span style="color:${color}">${status}: <strong>${count}</strong></span>`);
      }
    }
    return parts.join(' &bull; ');
  },

  renderChecksDetails(data) {
    const lines = [];
    if (data.last5Min) {
      const rate = data.last5Min.successRate !== null ? `${data.last5Min.successRate}%` : 'N/A';
      const avg = data.last5Min.avgResponseMs !== null ? `${data.last5Min.avgResponseMs}ms avg` : '';
      lines.push(`Last 5 min: <strong>${data.last5Min.total}</strong> checks, <strong>${rate}</strong> success${avg ? ' &bull; ' + avg : ''}`);
    }
    if (data.last1Hour) {
      const rate = data.last1Hour.successRate !== null ? `${data.last1Hour.successRate}%` : 'N/A';
      lines.push(`Last 1 hour: <strong>${data.last1Hour.total}</strong> checks, <strong>${rate}</strong> success`);
    }
    return lines.join('<br>');
  },

  renderSmtpDetails(data) {
    return `Configured: <strong>${data.configured ? 'Yes' : 'No'}</strong> &bull; Host: <strong>${escapeHtml(data.host)}</strong>`;
  },

  renderAuthDetails(data) {
    const parts = [];
    if (data.google) parts.push(`Google: <strong>${data.google.configured ? 'Configured' : 'Not configured'}</strong>`);
    if (data.microsoft) parts.push(`Microsoft: <strong>${data.microsoft.configured ? 'Configured' : 'Not configured'}</strong>`);
    return parts.join(' &bull; ');
  },

  formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  },

  formatTime(isoStr) {
    if (!isoStr) return '-';
    const d = new Date(isoStr.endsWith('Z') ? isoStr : isoStr + 'Z');
    return d.toLocaleString();
  },
};
