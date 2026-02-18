const SanityCheckForm = {
  discoveredChecks: [],

  async render(app, editId) {
    let monitor = null;
    let groups = [];

    try {
      groups = await API.get('/sanity-checks/groups');
    } catch { /* ignore */ }

    if (editId) {
      try {
        monitor = await API.get(`/sanity-checks/${editId}`);
      } catch (err) {
        app.innerHTML = `<div class="error">Failed to load monitor: ${escapeHtml(err.message)}</div>`;
        return;
      }
    }

    this.discoveredChecks = [];
    this.renderForm(app, monitor, groups);
  },

  renderForm(app, monitor, groups) {
    const isEdit = !!monitor;
    const title = isEdit ? 'Edit Sanity Check Monitor' : 'Add Sanity Check Monitor';

    app.innerHTML = `
      <div class="page-header">
        <h1>${title}</h1>
        <button class="btn btn-back" onclick="history.back()">Cancel</button>
      </div>

      <form id="sanity-check-form" class="form-card">
        <div class="form-errors" id="form-errors" style="display:none;"></div>

        <div class="form-group">
          <label for="clientUrl">Client URL *</label>
          <div class="input-with-action">
            <input type="url" id="clientUrl" name="clientUrl" required
                   value="${isEdit ? escapeHtml(monitor.clientUrl) : ''}"
                   placeholder="http://40.81.225.147:8081">
            <button type="button" id="btn-discover" class="btn btn-sm">Discover Checks</button>
          </div>
        </div>

        <div class="form-group">
          <label for="code">Check Code *</label>
          <div id="code-container">
            <input type="text" id="code" name="code" required
                   value="${isEdit ? escapeHtml(monitor.code) : ''}"
                   placeholder="NEG_ORDERS" pattern="[A-Za-z0-9_-]+"
                   ${isEdit ? 'readonly' : ''}>
          </div>
          <div id="discovered-checks" style="display:none;"></div>
        </div>

        <div class="form-group">
          <label for="name">Name *</label>
          <input type="text" id="name" name="name" required
                 value="${isEdit ? escapeHtml(monitor.name) : ''}"
                 placeholder="Negative Order Amounts">
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="checkType">Check Type</label>
            <select id="checkType" name="checkType">
              <option value="count_zero" ${!isEdit || monitor.checkType === 'count_zero' ? 'selected' : ''}>Count Zero (expect 0)</option>
              <option value="count_positive" ${isEdit && monitor.checkType === 'count_positive' ? 'selected' : ''}>Count Positive (expect > 0)</option>
              <option value="count_range" ${isEdit && monitor.checkType === 'count_range' ? 'selected' : ''}>Count Range</option>
              <option value="custom_threshold" ${isEdit && monitor.checkType === 'custom_threshold' ? 'selected' : ''}>Custom Threshold</option>
            </select>
          </div>

          <div class="form-group">
            <label for="severity">Severity</label>
            <select id="severity" name="severity">
              <option value="low" ${isEdit && monitor.severity === 'low' ? 'selected' : ''}>Low</option>
              <option value="medium" ${(!isEdit || monitor.severity === 'medium') ? 'selected' : ''}>Medium</option>
              <option value="high" ${isEdit && monitor.severity === 'high' ? 'selected' : ''}>High</option>
              <option value="critical" ${isEdit && monitor.severity === 'critical' ? 'selected' : ''}>Critical</option>
            </select>
          </div>
        </div>

        <div class="form-row" id="threshold-row" style="display:none;">
          <div class="form-group">
            <label for="expectedMin">Expected Min</label>
            <input type="number" id="expectedMin" name="expectedMin"
                   value="${isEdit && monitor.expectedMin !== null ? monitor.expectedMin : ''}">
          </div>
          <div class="form-group">
            <label for="expectedMax">Expected Max</label>
            <input type="number" id="expectedMax" name="expectedMax"
                   value="${isEdit && monitor.expectedMax !== null ? monitor.expectedMax : ''}">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="frequencySeconds">Check Frequency</label>
            <select id="frequencySeconds" name="frequencySeconds">
              <option value="60" ${isEdit && monitor.frequencySeconds === 60 ? 'selected' : ''}>Every minute</option>
              <option value="300" ${(!isEdit || monitor.frequencySeconds === 300) ? 'selected' : ''}>Every 5 minutes</option>
              <option value="900" ${isEdit && monitor.frequencySeconds === 900 ? 'selected' : ''}>Every 15 minutes</option>
              <option value="1800" ${isEdit && monitor.frequencySeconds === 1800 ? 'selected' : ''}>Every 30 minutes</option>
              <option value="3600" ${isEdit && monitor.frequencySeconds === 3600 ? 'selected' : ''}>Every hour</option>
            </select>
          </div>

          <div class="form-group">
            <label for="groupName">Group</label>
            <div id="group-container">
              <select id="groupName" name="groupName">
                <option value="">— No Group —</option>
                ${groups.map(g => `<option value="${escapeHtml(g)}" ${isEdit && monitor.groupName === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')}
                <option value="__new__">+ Add New Group</option>
              </select>
            </div>
            <div id="new-group-input" style="display:none;">
              <input type="text" id="newGroupName" placeholder="New group name">
              <button type="button" id="btn-cancel-new-group" class="btn btn-sm">Cancel</button>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label for="notifyEmail">Notification Email</label>
          <input type="email" id="notifyEmail" name="notifyEmail"
                 value="${isEdit ? escapeHtml(monitor.notifyEmail || '') : ''}"
                 placeholder="admin@example.com">
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${isEdit ? 'Update Monitor' : 'Create Monitor'}</button>
        </div>
      </form>
    `;

    // Toggle threshold fields based on check type
    const checkTypeSelect = document.getElementById('checkType');
    const thresholdRow = document.getElementById('threshold-row');
    const updateThresholdVisibility = () => {
      const type = checkTypeSelect.value;
      thresholdRow.style.display = (type === 'count_range' || type === 'custom_threshold') ? 'flex' : 'none';
    };
    checkTypeSelect.addEventListener('change', updateThresholdVisibility);
    updateThresholdVisibility();

    // Group dropdown: "Add New Group"
    const groupSelect = document.getElementById('groupName');
    const newGroupInput = document.getElementById('new-group-input');
    groupSelect.addEventListener('change', () => {
      if (groupSelect.value === '__new__') {
        groupSelect.style.display = 'none';
        newGroupInput.style.display = 'flex';
        document.getElementById('newGroupName').focus();
      }
    });
    document.getElementById('btn-cancel-new-group')?.addEventListener('click', () => {
      newGroupInput.style.display = 'none';
      groupSelect.style.display = 'block';
      groupSelect.value = '';
    });

    // Discover button
    document.getElementById('btn-discover')?.addEventListener('click', () => this.discover());

    // Form submit
    document.getElementById('sanity-check-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit(isEdit, isEdit ? monitor.id : null);
    });
  },

  async discover() {
    const clientUrl = document.getElementById('clientUrl').value.trim();
    if (!clientUrl) {
      Modal.alert('Please enter a Client URL first');
      return;
    }

    try {
      const btn = document.getElementById('btn-discover');
      btn.textContent = 'Discovering...';
      btn.disabled = true;

      const checks = await API.get(`/sanity-checks/discover?clientUrl=${encodeURIComponent(clientUrl)}`);
      this.discoveredChecks = checks;

      const container = document.getElementById('discovered-checks');
      if (checks.length > 0) {
        container.style.display = 'block';
        container.innerHTML = `
          <p class="form-help">Available checks on this client:</p>
          <div class="discovered-list">
            ${checks.map(c => `
              <button type="button" class="btn btn-sm btn-discovered" data-code="${escapeHtml(c.code)}" data-name="${escapeHtml(c.name)}" data-type="${escapeHtml(c.checkType || '')}">
                <strong>${escapeHtml(c.code)}</strong> — ${escapeHtml(c.name)}
              </button>
            `).join('')}
          </div>
        `;

        container.querySelectorAll('.btn-discovered').forEach(btn => {
          btn.addEventListener('click', () => {
            document.getElementById('code').value = btn.dataset.code;
            document.getElementById('name').value = btn.dataset.name;
            if (btn.dataset.type) {
              document.getElementById('checkType').value = btn.dataset.type;
              document.getElementById('checkType').dispatchEvent(new Event('change'));
            }
          });
        });
      } else {
        container.style.display = 'block';
        container.innerHTML = '<p class="form-help">No checks found on this client.</p>';
      }

      btn.textContent = 'Discover Checks';
      btn.disabled = false;
    } catch (err) {
      document.getElementById('btn-discover').textContent = 'Discover Checks';
      document.getElementById('btn-discover').disabled = false;
      Modal.alert('Discovery failed: ' + err.message);
    }
  },

  async submit(isEdit, editId) {
    const errorsDiv = document.getElementById('form-errors');
    errorsDiv.style.display = 'none';

    const groupSelect = document.getElementById('groupName');
    const newGroupName = document.getElementById('newGroupName');
    let groupName = groupSelect.value;
    if (groupName === '__new__' && newGroupName.value.trim()) {
      groupName = newGroupName.value.trim();
    } else if (groupName === '__new__') {
      groupName = '';
    }

    const data = {
      code: document.getElementById('code').value.trim(),
      name: document.getElementById('name').value.trim(),
      clientUrl: document.getElementById('clientUrl').value.trim(),
      checkType: document.getElementById('checkType').value,
      severity: document.getElementById('severity').value,
      frequencySeconds: parseInt(document.getElementById('frequencySeconds').value, 10),
      groupName,
      notifyEmail: document.getElementById('notifyEmail').value.trim(),
    };

    const expectedMin = document.getElementById('expectedMin').value;
    const expectedMax = document.getElementById('expectedMax').value;
    if (expectedMin !== '') data.expectedMin = parseInt(expectedMin, 10);
    if (expectedMax !== '') data.expectedMax = parseInt(expectedMax, 10);

    try {
      if (isEdit) {
        await API.put(`/sanity-checks/${editId}`, data);
        location.hash = `#/sanity-checks/${editId}`;
      } else {
        const result = await API.post('/sanity-checks', data);
        location.hash = `#/sanity-checks/${result.id}`;
      }
    } catch (err) {
      errorsDiv.style.display = 'block';
      if (err.errors && Array.isArray(err.errors)) {
        errorsDiv.innerHTML = err.errors.map(e => `<p>${escapeHtml(e)}</p>`).join('');
      } else {
        errorsDiv.innerHTML = `<p>${escapeHtml(err.message || err.error || 'Unknown error')}</p>`;
      }
    }
  },
};
