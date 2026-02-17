const Settings = {
  currentTab: 'health',

  async render(container) {
    container.innerHTML = '<div class="loading">Loading settings...</div>';

    try {
      const [smtp, health] = await Promise.all([
        API.get('/settings/smtp'),
        Settings.fetchHealth(),
      ]);
      Settings.renderLayout(container, smtp, health);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
  },

  async fetchHealth() {
    try {
      const res = await fetch('/health/details');
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  renderLayout(container, smtp, health) {
    const isHealth = Settings.currentTab === 'health';
    const isSmtp = Settings.currentTab === 'smtp';

    container.innerHTML = `
      <div class="settings-layout">
        <aside class="settings-sidebar">
          <nav class="settings-sidebar-nav">
            <a href="javascript:void(0)" data-tab="health" class="${isHealth ? 'active' : ''}">API Health</a>
            <a href="javascript:void(0)" data-tab="smtp" class="${isSmtp ? 'active' : ''}">SMTP Configuration</a>
          </nav>
        </aside>
        <div class="settings-content" id="settings-panel"></div>
      </div>
    `;

    container.querySelectorAll('.settings-sidebar-nav a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        Settings.currentTab = link.dataset.tab;
        container.querySelectorAll('.settings-sidebar-nav a').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        Settings.renderPanel(document.getElementById('settings-panel'), smtp, health);
      });
    });

    Settings.renderPanel(document.getElementById('settings-panel'), smtp, health);
  },

  renderPanel(panel, smtp, health) {
    if (Settings.currentTab === 'health') {
      Settings.renderHealthPanel(panel, health);
    } else {
      Settings.renderSmtpPanel(panel, smtp);
    }
  },

  // ---- API Health Panel ----

  renderHealthPanel(panel, data) {
    if (!data) {
      panel.innerHTML = `
        <div class="empty-state" style="padding:3rem 1rem">
          <h2>Health Unavailable</h2>
          <p>Could not fetch API health details.</p>
        </div>
      `;
      return;
    }

    const statusClass = data.status === 'healthy' ? 'up' : data.status === 'degraded' ? 'paused' : 'down';

    panel.innerHTML = `
      <div class="detail-header" style="margin-bottom:1.5rem">
        <div class="detail-info">
          <h2>
            <span class="status-dot ${statusClass}"></span>
            API Health
          </h2>
          <div class="detail-url">v${escapeHtml(data.version || '--')} &bull; Node ${escapeHtml(data.nodeVersion || '--')}</div>
        </div>
        <div>
          <span class="status-badge ${statusClass}">
            <span class="status-dot ${statusClass}"></span>
            ${data.status.toUpperCase()}
          </span>
        </div>
      </div>

      <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.5rem">
        <div class="stat-card">
          <div class="stat-label">Uptime</div>
          <div class="stat-value" style="font-size:1rem">${Settings.formatUptime(data.uptime)}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Memory (RSS)</div>
          <div class="stat-value" style="font-size:1rem">${data.memoryUsage ? data.memoryUsage.rss : '--'} MB</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Heap Used</div>
          <div class="stat-value" style="font-size:1rem">${data.memoryUsage ? data.memoryUsage.heapUsed + ' / ' + data.memoryUsage.heapTotal : '--'} MB</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Started At</div>
          <div class="stat-value" style="font-size:0.78rem">${Settings.formatTime(data.startedAt)}</div>
        </div>
      </div>

      ${Settings.renderCheckCard('Database', data.checks?.database, Settings.renderDbDetails)}
      ${Settings.renderCheckCard('Scheduler', data.checks?.scheduler, Settings.renderSchedulerDetails)}
      ${Settings.renderCheckCard('Monitors', data.checks?.monitors, Settings.renderMonitorDetails)}
      ${Settings.renderCheckCard('Recent Checks', data.checks?.checks, Settings.renderChecksDetails)}
      ${Settings.renderCheckCard('SMTP', data.checks?.smtp, Settings.renderSmtpCheckDetails)}
      ${Settings.renderCheckCard('Authentication', data.checks?.auth, Settings.renderAuthDetails)}
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
      items.push(`Last tick: <strong>${Settings.formatTime(data.lastTickAt)}</strong>`);
    }
    if (data.lastTickDurationMs !== null && data.lastTickDurationMs !== undefined) {
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

  renderSmtpCheckDetails(data) {
    return `Configured: <strong>${data.configured ? 'Yes' : 'No'}</strong> &bull; Host: <strong>${escapeHtml(data.host)}</strong>`;
  },

  renderAuthDetails(data) {
    const parts = [];
    if (data.google) parts.push(`Google: <strong>${data.google.configured ? 'Configured' : 'Not configured'}</strong>`);
    if (data.microsoft) parts.push(`Microsoft: <strong>${data.microsoft.configured ? 'Configured' : 'Not configured'}</strong>`);
    return parts.join(' &bull; ');
  },

  // ---- SMTP Configuration Panel ----

  renderSmtpPanel(panel, smtp) {
    const statusColor = smtp.configured ? 'var(--color-up)' : 'var(--color-down)';
    const statusText = smtp.configured ? 'Configured' : 'Not Configured';

    panel.innerHTML = `
      <div style="margin-bottom:2rem">
        <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;letter-spacing:-0.02em">SMTP Configuration</h2>
        <div class="stats-grid" style="margin-bottom:1rem">
          <div class="stat-card">
            <div class="stat-label">Status</div>
            <div class="stat-value" style="font-size:1rem;color:${statusColor}">${statusText}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Host</div>
            <div class="stat-value" style="font-size:0.85rem;word-break:break-all">${escapeHtml(smtp.host)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Port</div>
            <div class="stat-value" style="font-size:1rem">${smtp.port}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">User</div>
            <div class="stat-value" style="font-size:0.85rem">${escapeHtml(smtp.user)}</div>
          </div>
        </div>
        <div style="font-size:0.78rem;color:var(--color-text-tertiary)">
          From: ${escapeHtml(smtp.from)} &bull; Secure: ${smtp.secure ? 'Yes' : 'No'}
        </div>
      </div>

      <div style="border-top:1px solid var(--color-border);padding-top:1.5rem">
        <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-secondary)">Test Email</h3>
        <p style="font-size:0.82rem;color:var(--color-text-tertiary);margin-bottom:1rem">
          Send a test email to verify your SMTP configuration is working correctly.
        </p>
        <div id="test-email-result"></div>
        <form id="test-email-form" style="display:flex;gap:0.75rem;align-items:flex-start">
          <div style="flex:1">
            <input type="email" id="test-email-input" placeholder="recipient@example.com" required>
          </div>
          <button type="submit" class="btn btn-primary" id="test-email-btn">
            Send Test Email
          </button>
        </form>
      </div>
    `;

    document.getElementById('test-email-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('test-email-input');
      const btn = document.getElementById('test-email-btn');
      const resultEl = document.getElementById('test-email-result');
      const email = emailInput.value.trim();

      if (!email) return;

      btn.disabled = true;
      btn.textContent = 'Sending...';
      resultEl.innerHTML = '';

      try {
        const result = await API.post('/settings/test-email', { email });
        resultEl.innerHTML = `
          <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.85rem;color:#34d399">
            Test email sent successfully to <strong>${escapeHtml(email)}</strong>. Check your inbox (or Mailtrap dashboard).
          </div>
        `;
        btn.textContent = 'Sent!';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Send Test Email';
        }, 3000);
      } catch (err) {
        const details = err.data?.details || err.message;
        resultEl.innerHTML = `
          <div class="form-errors" style="margin-bottom:1rem">
            <strong>Failed to send test email</strong><br>
            ${escapeHtml(details)}
          </div>
        `;
        btn.disabled = false;
        btn.textContent = 'Send Test Email';
      }
    });
  },

  // ---- Helpers ----

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
