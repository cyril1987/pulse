const GenericMonitorDetail = {
  async render(container, id) {
    container.innerHTML = '<div class="loading">Loading monitor...</div>';

    try {
      const [monitor, reportsPage] = await Promise.all([
        API.get(`/generic-monitors/${id}`),
        API.get(`/generic-monitors/${id}/reports?limit=30&offset=0`),
      ]);

      GenericMonitorDetail.renderContent(container, monitor, reportsPage);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
  },

  renderContent(container, monitor, reportsPage) {
    const statusClass = monitor.currentStatus || 'unknown';
    const statusLabel = monitor.currentStatus || 'unknown';

    // Environment info table
    let envHtml = '';
    if (monitor.environment && typeof monitor.environment === 'object') {
      const entries = Object.entries(monitor.environment);
      if (entries.length > 0) {
        envHtml = `
          <div class="chart-container">
            <h3>Environment Information</h3>
            <table class="checks-table">
              <thead>
                <tr><th>Property</th><th>Value</th></tr>
              </thead>
              <tbody>
                ${entries.map(([k, v]) => `
                  <tr>
                    <td><strong>${escapeHtml(k)}</strong></td>
                    <td>${escapeHtml(String(v))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `;
      }
    }

    // Latest metrics
    let metricsHtml = '';
    if (monitor.latestMetrics && typeof monitor.latestMetrics === 'object') {
      const entries = Object.entries(monitor.latestMetrics);
      if (entries.length > 0) {
        metricsHtml = `
          <div class="stats-grid">
            ${entries.map(([k, v]) => `
              <div class="stat-card">
                <div class="stat-label">${escapeHtml(k)}</div>
                <div class="stat-value">${escapeHtml(String(v))}</div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }

    let html = `
      <div class="detail-header">
        <div class="detail-info">
          <h2>
            <span class="status-dot ${statusClass}"></span>
            ${escapeHtml(monitor.name)}
          </h2>
          ${monitor.latestMessage ? `<div class="detail-url">${escapeHtml(monitor.latestMessage)}</div>` : ''}
        </div>
        <div class="detail-actions">
          <button class="btn btn-danger btn-sm" onclick="GenericMonitorDetail.remove(${monitor.id})">Delete</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" style="color: var(--color-${statusClass})">${statusLabel.toUpperCase()}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Reports</div>
          <div class="stat-value">${monitor.totalReports}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Last Reported</div>
          <div class="stat-value" style="font-size:0.85rem">${monitor.lastReportedAt ? new Date(monitor.lastReportedAt + 'Z').toLocaleString() : 'Never'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">First Seen</div>
          <div class="stat-value" style="font-size:0.85rem">${new Date(monitor.createdAt + 'Z').toLocaleString()}</div>
        </div>
      </div>

      ${metricsHtml ? `<div class="chart-container"><h3>Latest Metrics</h3></div>${metricsHtml}` : ''}

      ${envHtml}

      <div class="checks-section">
        <h3>Recent Reports</h3>
        <table class="checks-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Message</th>
              <th>Metrics</th>
              <th>Reported At</th>
            </tr>
          </thead>
          <tbody>
            ${reportsPage.reports.length === 0
              ? '<tr><td colspan="4" style="text-align:center;padding:1.5rem">No reports recorded yet</td></tr>'
              : reportsPage.reports.map(r => `
                <tr>
                  <td>
                    <span class="${r.status === 'up' ? 'success' : r.status === 'down' ? 'failure' : ''}">${escapeHtml(r.status.toUpperCase())}</span>
                  </td>
                  <td>${r.message ? escapeHtml(r.message) : '--'}</td>
                  <td>${r.metrics ? GenericMonitorDetail.formatMetricsCell(r.metrics) : '--'}</td>
                  <td>${new Date(r.reportedAt + 'Z').toLocaleString()}</td>
                </tr>
              `).join('')}
          </tbody>
        </table>
        ${reportsPage.total > reportsPage.limit
          ? `<div class="pagination"><span>${reportsPage.total} total reports</span></div>`
          : ''}
      </div>

      <div class="detail-meta">
        ${monitor.group ? `<span>Group: ${escapeHtml(monitor.group)}</span>` : ''}
        <span>Created: ${new Date(monitor.createdAt + 'Z').toLocaleString()}</span>
      </div>
    `;

    container.innerHTML = html;
  },

  formatMetricsCell(metrics) {
    if (!metrics || typeof metrics !== 'object') return '--';
    const entries = Object.entries(metrics).slice(0, 4);
    return entries.map(([k, v]) =>
      `<span style="display:inline-block;margin-right:0.5rem;font-size:0.78rem"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</span>`
    ).join('');
  },

  async remove(id) {
    if (!(await Modal.confirm('Are you sure you want to delete this monitor and all its reports? This cannot be undone.', 'Delete Monitor'))) return;
    try {
      await API.delete(`/generic-monitors/${id}`);
      location.hash = '#/generic';
    } catch (err) {
      Modal.alert('Failed to delete: ' + err.message, 'Error');
    }
  },
};
