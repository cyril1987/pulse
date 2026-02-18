const SanityCheckDetail = {
  async render(app, id) {
    app.innerHTML = '<div class="loading">Loading check details...</div>';

    try {
      const [monitor, results] = await Promise.all([
        API.get(`/sanity-checks/${id}`),
        API.get(`/sanity-checks/${id}/results?limit=50`),
      ]);

      this.renderContent(app, monitor, results);
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(app, monitor, resultsData) {
    const status = monitor.currentStatus || 'unknown';
    const isFail = status === 'fail';
    const isError = status === 'error' || status === 'unknown';
    const isPass = status === 'pass';
    const results = resultsData.results || [];
    const value = monitor.lastValue;
    const hasValue = value !== null && value !== undefined;

    const stats = monitor.stats || {};
    const s24h = stats['24h'] || {};
    const s7d = stats['7d'] || {};

    app.innerHTML = `
      <div class="dcd-layout">
        <!-- Header -->
        <div class="dcd-header">
          <a href="#/sanity-checks" class="btn-back">&larr;</a>
          <div class="dcd-header-info">
            <div class="dcd-header-top">
              <span class="dc-status-indicator dc-status-${isFail ? 'fail' : isError ? 'error' : 'pass'}"></span>
              <h1>${escapeHtml(monitor.name)}</h1>
            </div>
            <div class="dcd-header-meta">
              <span class="dc-row-code">${escapeHtml(monitor.code)}</span>
              ${monitor.groupName ? `<span class="dc-row-group">${escapeHtml(monitor.groupName)}</span>` : ''}
              <span class="dc-severity dc-severity-${monitor.severity}">${monitor.severity}</span>
              <span class="dcd-client-url">${escapeHtml(monitor.clientUrl)}</span>
            </div>
          </div>
          <div class="dcd-header-actions">
            <button id="btn-run-now" class="btn btn-primary btn-sm">Run Now</button>
            <a href="#/sanity-checks/${monitor.id}/edit" class="btn btn-secondary btn-sm">Edit</a>
            ${monitor.isActive
              ? `<button id="btn-pause" class="btn btn-secondary btn-sm">Pause</button>`
              : `<button id="btn-resume" class="btn btn-primary btn-sm">Resume</button>`}
            <button id="btn-delete" class="btn btn-danger btn-sm">Delete</button>
          </div>
        </div>

        <!-- Current value hero -->
        <div class="dcd-hero ${isFail ? 'dcd-hero-fail' : isError ? 'dcd-hero-error' : 'dcd-hero-pass'}">
          <div class="dcd-hero-value-wrap">
            <div class="dcd-hero-value">${hasValue ? this.formatNumber(value) : '&mdash;'}</div>
            <div class="dcd-hero-label">
              ${isFail ? 'Exceptions found — needs action' : isPass ? 'Check passing' : 'Check error'}
            </div>
          </div>
          ${monitor.lastCheckedAt ? `
            <div class="dcd-hero-time">
              Last checked ${this.timeAgo(new Date(monitor.lastCheckedAt.endsWith('Z') ? monitor.lastCheckedAt : monitor.lastCheckedAt + 'Z'))}
              <span class="dcd-hero-timestamp">${new Date(monitor.lastCheckedAt.endsWith('Z') ? monitor.lastCheckedAt : monitor.lastCheckedAt + 'Z').toLocaleString()}</span>
            </div>
          ` : '<div class="dcd-hero-time">Never checked</div>'}
        </div>

        <!-- Stats row -->
        <div class="dcd-stats-row">
          <div class="dcd-stat">
            <div class="dcd-stat-value">${s24h.totalChecks || 0}</div>
            <div class="dcd-stat-label">Checks (24h)</div>
          </div>
          <div class="dcd-stat">
            <div class="dcd-stat-value ${s24h.passRate && parseFloat(s24h.passRate) < 100 ? 'dc-value-bad' : ''}">${s24h.passRate ? s24h.passRate + '%' : '—'}</div>
            <div class="dcd-stat-label">Pass Rate (24h)</div>
          </div>
          <div class="dcd-stat">
            <div class="dcd-stat-value">${s24h.failCount || 0}</div>
            <div class="dcd-stat-label">Failures (24h)</div>
          </div>
          <div class="dcd-stat">
            <div class="dcd-stat-value">${s24h.avgExecutionTimeMs ? s24h.avgExecutionTimeMs + 'ms' : '—'}</div>
            <div class="dcd-stat-label">Avg Exec Time</div>
          </div>
          <div class="dcd-stat">
            <div class="dcd-stat-value">${s7d.passRate ? s7d.passRate + '%' : '—'}</div>
            <div class="dcd-stat-label">Pass Rate (7d)</div>
          </div>
          <div class="dcd-stat">
            <div class="dcd-stat-value">${monitor.valueChanges || 0}</div>
            <div class="dcd-stat-label">Value Changes</div>
          </div>
        </div>

        <!-- SQL Query -->
        ${monitor.query ? `
        <div class="dcd-section">
          <div class="dcd-section-header">SQL Query</div>
          <div class="dcd-query-wrap">
            <pre class="dcd-query-code">${escapeHtml(monitor.query)}</pre>
          </div>
        </div>
        ` : ''}

        <!-- Config -->
        <div class="dcd-section">
          <div class="dcd-section-header">Configuration</div>
          <div class="dcd-config-grid">
            <div class="dcd-config-item">
              <span class="dcd-config-label">Check Type</span>
              <span class="dcd-config-value">${escapeHtml(monitor.checkType)}</span>
            </div>
            <div class="dcd-config-item">
              <span class="dcd-config-label">Expected Min</span>
              <span class="dcd-config-value">${monitor.expectedMin !== null && monitor.expectedMin !== undefined ? monitor.expectedMin : '—'}</span>
            </div>
            <div class="dcd-config-item">
              <span class="dcd-config-label">Expected Max</span>
              <span class="dcd-config-value">${monitor.expectedMax !== null && monitor.expectedMax !== undefined ? monitor.expectedMax : '—'}</span>
            </div>
            <div class="dcd-config-item">
              <span class="dcd-config-label">Frequency</span>
              <span class="dcd-config-value">${this.formatFrequency(monitor.frequencySeconds)}</span>
            </div>
            <div class="dcd-config-item">
              <span class="dcd-config-label">Notify</span>
              <span class="dcd-config-value">${monitor.notifyEmail ? escapeHtml(monitor.notifyEmail) : '—'}</span>
            </div>
            <div class="dcd-config-item">
              <span class="dcd-config-label">Active</span>
              <span class="dcd-config-value">${monitor.isActive ? 'Yes' : 'Paused'}</span>
            </div>
          </div>
        </div>

        <!-- Result history -->
        <div class="dcd-section">
          <div class="dcd-section-header">Execution History <span class="dcd-section-count">${resultsData.total || results.length} total</span></div>
          ${results.length > 0 ? `
            <div class="dcd-results-table-wrap">
              <table class="dcd-results-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Value</th>
                    <th>Prev</th>
                    <th>Changed</th>
                    <th>Exec Time</th>
                    <th>Error</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  ${results.map(r => this.renderResultRow(r)).join('')}
                </tbody>
              </table>
            </div>
          ` : '<div class="dcd-no-results">No results yet. Click "Run Now" to execute the first check.</div>'}
        </div>
      </div>
    `;

    // Bind actions
    document.getElementById('btn-run-now')?.addEventListener('click', () => this.runNow(monitor.id, app));
    document.getElementById('btn-pause')?.addEventListener('click', () => this.toggleActive(monitor.id, 'pause', app));
    document.getElementById('btn-resume')?.addEventListener('click', () => this.toggleActive(monitor.id, 'resume', app));
    document.getElementById('btn-delete')?.addEventListener('click', () => this.remove(monitor.id));
  },

  renderResultRow(r) {
    const isFail = r.status === 'fail';
    const isError = r.status === 'error';
    return `
      <tr class="${r.valueChanged ? 'dcd-row-changed' : ''} ${isFail ? 'dcd-row-fail' : ''}">
        <td><span class="dc-badge dc-badge-${r.status === 'pass' ? 'pass' : r.status === 'fail' ? 'fail' : 'error'}">${r.status}</span></td>
        <td class="dcd-val-cell ${isFail ? 'dc-value-bad' : ''}">${r.actualValue !== null && r.actualValue !== undefined ? this.formatNumber(r.actualValue) : '—'}</td>
        <td>${r.previousValue !== null && r.previousValue !== undefined ? this.formatNumber(r.previousValue) : '—'}</td>
        <td>${r.valueChanged ? '<span class="dc-badge dc-badge-changed">changed</span>' : '—'}</td>
        <td>${r.executionTimeMs}ms</td>
        <td class="dcd-error-cell">${r.errorMessage ? escapeHtml(r.errorMessage).substring(0, 100) : '—'}</td>
        <td class="dcd-time-cell">${new Date(r.checkedAt && !r.checkedAt.endsWith('Z') ? r.checkedAt + 'Z' : r.checkedAt).toLocaleString()}</td>
      </tr>
    `;
  },

  formatNumber(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return val;
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString();
  },

  formatFrequency(seconds) {
    if (!seconds) return '—';
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min';
    return Math.floor(seconds / 3600) + 'h';
  },

  timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
  },

  async runNow(id, app) {
    try {
      await API.post(`/sanity-checks/${id}/check`);
      this.render(app, id);
    } catch (err) {
      Modal.alert('Check failed: ' + err.message);
    }
  },

  async toggleActive(id, action, app) {
    try {
      await API.post(`/sanity-checks/${id}/${action}`);
      this.render(app, id);
    } catch (err) {
      Modal.alert(`Failed to ${action}: ` + err.message);
    }
  },

  async remove(id) {
    const confirmed = await Modal.confirm('Are you sure you want to delete this check? All results will be lost.');
    if (!confirmed) return;
    try {
      await API.delete(`/sanity-checks/${id}`);
      location.hash = '#/sanity-checks';
    } catch (err) {
      Modal.alert('Failed to delete: ' + err.message);
    }
  },
};
