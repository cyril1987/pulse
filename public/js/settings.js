const Settings = {
  currentTab: 'health',

  async render(container) {
    container.innerHTML = '<div class="loading">Loading settings...</div>';

    try {
      const [emailConfig, health, jira, notifPrefs] = await Promise.all([
        API.get('/settings/email').catch(() => ({ configured: false, provider: 'SMTP' })),
        Settings.fetchHealth(),
        API.get('/settings/jira').catch(() => ({ configured: false, baseUrl: '(not set)', userEmail: '(not set)' })),
        API.get('/settings/notification-prefs').catch(() => ({
          monitorAlerts: true, taskAssigned: true, taskStatusChange: true,
          taskDueSoon: true, taskOverdue: true, dailyDigest: false,
        })),
      ]);
      Settings.renderLayout(container, emailConfig, health, jira, notifPrefs);
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

  renderLayout(container, emailConfig, health, jira, notifPrefs) {
    const isHealth = Settings.currentTab === 'health';
    const isEmail = Settings.currentTab === 'email';
    const isNotifications = Settings.currentTab === 'notifications';
    const isJira = Settings.currentTab === 'jira';

    container.innerHTML = `
      <div class="settings-layout">
        <aside class="settings-sidebar">
          <nav class="settings-sidebar-nav">
            <a href="javascript:void(0)" data-tab="health" class="${isHealth ? 'active' : ''}">API Health</a>
            <a href="javascript:void(0)" data-tab="email" class="${isEmail ? 'active' : ''}">Email Configuration</a>
            <a href="javascript:void(0)" data-tab="notifications" class="${isNotifications ? 'active' : ''}">Notifications</a>
            <a href="javascript:void(0)" data-tab="jira" class="${isJira ? 'active' : ''}">Jira Integration</a>
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
        Settings.renderPanel(document.getElementById('settings-panel'), emailConfig, health, jira, notifPrefs);
      });
    });

    Settings.renderPanel(document.getElementById('settings-panel'), emailConfig, health, jira, notifPrefs);
  },

  renderPanel(panel, emailConfig, health, jira, notifPrefs) {
    if (Settings.currentTab === 'health') {
      Settings.renderHealthPanel(panel, health);
    } else if (Settings.currentTab === 'email') {
      Settings.renderEmailPanel(panel, emailConfig);
    } else if (Settings.currentTab === 'notifications') {
      Settings.renderNotificationsPanel(panel, notifPrefs);
    } else if (Settings.currentTab === 'jira') {
      Settings.renderJiraPanel(panel, jira);
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

  // ---- Email Configuration Panel ----

  renderEmailPanel(panel, emailConfig) {
    const statusColor = emailConfig.configured ? 'var(--color-up)' : 'var(--color-down)';
    const statusText = emailConfig.configured ? 'Configured' : 'Not Configured';
    const isSendGrid = emailConfig.provider === 'SendGrid';
    const providerBadge = isSendGrid
      ? '<span style="background:#1A82E2;color:white;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:600">SendGrid</span>'
      : '<span style="background:#6b7280;color:white;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.7rem;font-weight:600">SMTP</span>';

    panel.innerHTML = `
      <div style="margin-bottom:2rem">
        <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;letter-spacing:-0.02em">
          Email Configuration ${providerBadge}
        </h2>
        <div class="stats-grid" style="margin-bottom:1rem">
          <div class="stat-card">
            <div class="stat-label">Status</div>
            <div class="stat-value" style="font-size:1rem;color:${statusColor}">${statusText}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Provider</div>
            <div class="stat-value" style="font-size:1rem">${escapeHtml(emailConfig.provider)}</div>
          </div>
          ${isSendGrid ? `
            <div class="stat-card">
              <div class="stat-label">API Key</div>
              <div class="stat-value" style="font-size:0.85rem">${escapeHtml(emailConfig.apiKeyPreview || '(not set)')}</div>
            </div>
          ` : `
            <div class="stat-card">
              <div class="stat-label">Host</div>
              <div class="stat-value" style="font-size:0.85rem;word-break:break-all">${escapeHtml(emailConfig.host || '(not set)')}</div>
            </div>
          `}
          <div class="stat-card">
            <div class="stat-label">${isSendGrid ? 'From' : 'Port'}</div>
            <div class="stat-value" style="font-size:0.85rem">${isSendGrid ? escapeHtml(emailConfig.from || '') : (emailConfig.port || '--')}</div>
          </div>
        </div>
        <div style="font-size:0.78rem;color:var(--color-text-tertiary)">
          From: ${escapeHtml(emailConfig.from || '')}
          ${!isSendGrid ? ` &bull; User: ${escapeHtml(emailConfig.user || '(not set)')} &bull; Secure: ${emailConfig.secure ? 'Yes' : 'No'}` : ''}
        </div>
        <div style="font-size:0.78rem;color:var(--color-text-tertiary);margin-top:0.5rem">
          ${isSendGrid
            ? 'Configure via <code>SENDGRID_API_KEY</code> and <code>EMAIL_FROM</code> environment variables.'
            : 'Configure via <code>SMTP_HOST</code>, <code>SMTP_PORT</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code>, <code>SMTP_FROM</code> environment variables. Or set <code>SENDGRID_API_KEY</code> to switch to SendGrid.'}
        </div>
      </div>

      <div style="border-top:1px solid var(--color-border);padding-top:1.5rem">
        <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-secondary)">Test Email</h3>
        <p style="font-size:0.82rem;color:var(--color-text-tertiary);margin-bottom:1rem">
          Send a test email to verify your ${escapeHtml(emailConfig.provider)} configuration is working correctly.
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
            Test email sent successfully to <strong>${escapeHtml(email)}</strong>.
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

  // ---- Notifications Panel ----

  renderNotificationsPanel(panel, prefs) {
    const types = [
      { key: 'monitorAlerts', label: 'Monitor Alerts', desc: 'Get notified when a URL monitor goes down or recovers' },
      { key: 'taskAssigned', label: 'Task Assignment', desc: 'Get notified when a task is assigned to you' },
      { key: 'taskStatusChange', label: 'Task Status Changes', desc: 'Get notified when a task assigned to you changes status' },
      { key: 'taskDueSoon', label: 'Due Soon Reminders', desc: 'Get notified when your task is due within 24 hours' },
      { key: 'taskOverdue', label: 'Overdue Alerts', desc: 'Get notified when your task is past its due date' },
      { key: 'dailyDigest', label: 'Daily Digest', desc: 'Receive a daily summary of your open tasks at 8:00 AM IST' },
    ];

    panel.innerHTML = `
      <div style="margin-bottom:2rem">
        <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:0.5rem;letter-spacing:-0.02em">Notification Preferences</h2>
        <p style="font-size:0.82rem;color:var(--color-text-tertiary);margin-bottom:1.5rem">
          Choose which email notifications you want to receive. Changes are saved per user.
        </p>
        <div id="notif-prefs-form">
          ${types.map(t => `
            <div class="notif-pref-row">
              <label class="notif-pref-label">
                <input type="checkbox" data-key="${t.key}" ${prefs[t.key] ? 'checked' : ''}>
                <strong>${t.label}</strong>
              </label>
              <p class="notif-pref-desc">${t.desc}</p>
            </div>
          `).join('')}
        </div>
        <div id="notif-prefs-result" style="margin-top:1rem"></div>
        <button class="btn btn-primary" id="save-notif-prefs" style="margin-top:1rem">Save Preferences</button>
      </div>
    `;

    document.getElementById('save-notif-prefs').addEventListener('click', async () => {
      const btn = document.getElementById('save-notif-prefs');
      const resultEl = document.getElementById('notif-prefs-result');
      const body = {};

      panel.querySelectorAll('[data-key]').forEach(cb => {
        body[cb.dataset.key] = cb.checked;
      });

      btn.disabled = true;
      btn.textContent = 'Saving...';
      resultEl.innerHTML = '';

      try {
        await API.put('/settings/notification-prefs', body);
        resultEl.innerHTML = `
          <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-sm);padding:0.75rem 1rem;font-size:0.85rem;color:#34d399">
            Notification preferences saved successfully.
          </div>
        `;
        btn.textContent = 'Saved!';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Save Preferences';
          resultEl.innerHTML = '';
        }, 3000);
      } catch (err) {
        resultEl.innerHTML = `
          <div class="form-errors">
            <strong>Failed to save preferences</strong><br>
            ${escapeHtml(err.message)}
          </div>
        `;
        btn.disabled = false;
        btn.textContent = 'Save Preferences';
      }
    });
  },

  // ---- Jira Integration Panel ----

  renderJiraPanel(panel, jira) {
    const statusColor = jira.configured ? 'var(--color-up)' : 'var(--color-down)';
    const statusText = jira.configured ? 'Configured' : 'Not Configured';

    panel.innerHTML = `
      <div style="margin-bottom:2rem">
        <h2 style="font-size:1.3rem;font-weight:700;margin-bottom:1.5rem;letter-spacing:-0.02em">Jira Integration</h2>
        <div class="stats-grid" style="margin-bottom:1rem;grid-template-columns:repeat(3,1fr)">
          <div class="stat-card">
            <div class="stat-label">Status</div>
            <div class="stat-value" style="font-size:1rem;color:${statusColor}">${statusText}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Base URL</div>
            <div class="stat-value" style="font-size:0.82rem;word-break:break-all">${escapeHtml(jira.baseUrl)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">User Email</div>
            <div class="stat-value" style="font-size:0.85rem">${escapeHtml(jira.userEmail)}</div>
          </div>
        </div>
        <div style="font-size:0.78rem;color:var(--color-text-tertiary)">
          Configure Jira credentials in your <code>.env</code> file: <code>JIRA_BASE_URL</code>, <code>JIRA_USER_EMAIL</code>, <code>JIRA_API_TOKEN</code>
        </div>
      </div>

      <div style="border-top:1px solid var(--color-border);padding-top:1.5rem">
        <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-secondary)">Test Connection</h3>
        <p style="font-size:0.82rem;color:var(--color-text-tertiary);margin-bottom:1rem">
          Verify that your Jira API credentials are working correctly.
        </p>
        <div id="jira-test-result"></div>
        <button class="btn btn-primary" id="test-jira-btn" ${!jira.configured ? 'disabled' : ''}>
          Test Jira Connection
        </button>
      </div>
    `;

    const testBtn = document.getElementById('test-jira-btn');
    testBtn.addEventListener('click', async () => {
      const resultEl = document.getElementById('jira-test-result');
      testBtn.disabled = true;
      testBtn.textContent = 'Testing...';
      resultEl.innerHTML = '';

      try {
        const result = await API.post('/settings/test-jira');
        resultEl.innerHTML = `
          <div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:var(--radius-sm);padding:0.75rem 1rem;margin-bottom:1rem;font-size:0.85rem;color:#34d399">
            <strong>Connection successful!</strong><br>
            Logged in as: <strong>${escapeHtml(result.displayName)}</strong> (${escapeHtml(result.emailAddress || '')})<br>
            Server: ${escapeHtml(result.serverUrl)}
          </div>
        `;
        testBtn.textContent = 'Connected!';
        setTimeout(() => {
          testBtn.disabled = false;
          testBtn.textContent = 'Test Jira Connection';
        }, 3000);
      } catch (err) {
        const details = err.data?.details || err.message;
        resultEl.innerHTML = `
          <div class="form-errors" style="margin-bottom:1rem">
            <strong>Connection failed</strong><br>
            ${escapeHtml(details)}
          </div>
        `;
        testBtn.disabled = false;
        testBtn.textContent = 'Test Jira Connection';
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
