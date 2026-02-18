const SanityCheckDetail = {
  async render(app, id) {
    app.innerHTML = '<div class="loading">Loading sanity check...</div>';

    try {
      const [monitor, results] = await Promise.all([
        API.get(`/api/sanity-checks/${id}`),
        API.get(`/api/sanity-checks/${id}/results?limit=50`),
      ]);

      this.renderContent(app, monitor, results);
    } catch (err) {
      app.innerHTML = `<div class="error">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  },

  renderContent(app, monitor, resultsData) {
    const statusClass = monitor.currentStatus === 'pass' ? 'up' : monitor.currentStatus === 'fail' ? 'down' : 'unknown';
    const results = resultsData.results || [];

    app.innerHTML = `
      <div class="detail-header">
        <a href="#/sanity-checks" class="btn btn-back">&larr; Back</a>
        <div class="detail-title">
          <span class="status-dot status-${statusClass}"></span>
          <h1>${escapeHtml(monitor.name)}</h1>
        </div>
        <div class="detail-subtitle">
          <span class="badge">${escapeHtml(monitor.code)}</span>
          <span class="monitor-url-badge">${escapeHtml(monitor.clientUrl)}</span>
        </div>
      </div>

      <div class="detail-actions">
        <button id="btn-run-now" class="btn btn-primary">Run Now</button>
        <a href="#/sanity-checks/edit/${monitor.id}" class="btn">Edit</a>
        ${monitor.isActive
          ? `<button id="btn-pause" class="btn btn-warning">Pause</button>`
          : `<button id="btn-resume" class="btn btn-success">Resume</button>`}
        <button id="btn-delete" class="btn btn-danger">Delete</button>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value status-text-${statusClass}">${monitor.currentStatus || 'unknown'}</div>
          <div class="stat-label">Status</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monitor.lastValue !== null && monitor.lastValue !== undefined ? monitor.lastValue : '—'}</div>
          <div class="stat-label">Current Value</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monitor.stats && monitor.stats['24h'] ? monitor.stats['24h'].passRate + '%' : '—'}</div>
          <div class="stat-label">Pass Rate (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monitor.stats && monitor.stats['24h'] ? (monitor.stats['24h'].avgExecutionTimeMs || '—') + 'ms' : '—'}</div>
          <div class="stat-label">Avg Exec Time (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monitor.stats && monitor.stats['24h'] ? monitor.stats['24h'].totalChecks : 0}</div>
          <div class="stat-label">Total Checks (24h)</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${monitor.valueChanges || 0}</div>
          <div class="stat-label">Value Changes</div>
        </div>
      </div>

      <div class="detail-section">
        <h2>Configuration</h2>
        <div class="config-grid">
          <div><strong>Check Type:</strong> ${escapeHtml(monitor.checkType)}</div>
          <div><strong>Expected Min:</strong> ${monitor.expectedMin !== null && monitor.expectedMin !== undefined ? monitor.expectedMin : '—'}</div>
          <div><strong>Expected Max:</strong> ${monitor.expectedMax !== null && monitor.expectedMax !== undefined ? monitor.expectedMax : '—'}</div>
          <div><strong>Severity:</strong> <span class="badge">${escapeHtml(monitor.severity)}</span></div>
          <div><strong>Frequency:</strong> ${monitor.frequencySeconds}s</div>
          <div><strong>Notify:</strong> ${monitor.notifyEmail || '—'}</div>
        </div>
      </div>

      <div class="detail-section">
        <h2>Recent Results</h2>
        ${results.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Value</th>
                <th>Previous</th>
                <th>Changed</th>
                <th>Exec Time</th>
                <th>Error</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr class="${r.valueChanged ? 'row-highlight' : ''}">
                  <td><span class="badge badge-${r.status === 'pass' ? 'up' : r.status === 'fail' ? 'down' : 'unknown'}">${r.status}</span></td>
                  <td>${r.actualValue !== null && r.actualValue !== undefined ? r.actualValue : '—'}</td>
                  <td>${r.previousValue !== null && r.previousValue !== undefined ? r.previousValue : '—'}</td>
                  <td>${r.valueChanged ? '<span class="badge badge-warning">Yes</span>' : 'No'}</td>
                  <td>${r.executionTimeMs}ms</td>
                  <td class="error-cell">${r.errorMessage ? escapeHtml(r.errorMessage).substring(0, 80) : '—'}</td>
                  <td>${new Date(r.checkedAt).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : '<p>No results yet.</p>'}
      </div>
    `;

    // Bind action buttons
    document.getElementById('btn-run-now')?.addEventListener('click', () => this.runNow(monitor.id, app));
    document.getElementById('btn-pause')?.addEventListener('click', () => this.toggleActive(monitor.id, 'pause', app));
    document.getElementById('btn-resume')?.addEventListener('click', () => this.toggleActive(monitor.id, 'resume', app));
    document.getElementById('btn-delete')?.addEventListener('click', () => this.remove(monitor.id));
  },

  async runNow(id, app) {
    try {
      await API.post(`/api/sanity-checks/${id}/check`);
      this.render(app, id);
    } catch (err) {
      Modal.alert('Check failed: ' + err.message);
    }
  },

  async toggleActive(id, action, app) {
    try {
      await API.post(`/api/sanity-checks/${id}/${action}`);
      this.render(app, id);
    } catch (err) {
      Modal.alert(`Failed to ${action}: ` + err.message);
    }
  },

  async remove(id) {
    if (!confirm('Are you sure you want to delete this monitor? All results will be lost.')) return;
    try {
      await API.delete(`/api/sanity-checks/${id}`);
      location.hash = '#/sanity-checks';
    } catch (err) {
      Modal.alert('Failed to delete: ' + err.message);
    }
  },
};
