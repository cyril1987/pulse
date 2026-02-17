const MonitorForm = {
  async render(container, editId) {
    let monitor = null;

    if (editId) {
      try {
        monitor = await API.get(`/monitors/${editId}`);
      } catch (err) {
        container.innerHTML = `<div class="empty-state"><h2>Monitor not found</h2><p>${err.message}</p></div>`;
        return;
      }
    }

    const title = monitor ? 'Edit Monitor' : 'Add Monitor';
    const url = monitor ? monitor.url : '';
    const name = monitor ? monitor.name : '';
    const frequency = monitor ? monitor.frequencySeconds : 300;
    const expectedStatus = monitor ? monitor.expectedStatus : 200;
    const timeoutMs = monitor ? monitor.timeoutMs : 10000;
    const notifyEmail = monitor ? monitor.notifyEmail : '';
    const existingHeaders = monitor && monitor.customHeaders ? monitor.customHeaders : [];
    const group = monitor ? (monitor.group || '') : '';

    const uploadLink = monitor ? '' : `
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1.5rem;padding-bottom:1rem;border-bottom:1px solid var(--color-border)">
        <span style="font-size:0.82rem;color:var(--color-text-tertiary)">Have multiple monitors?</span>
        <a href="#/upload" class="btn btn-secondary btn-sm" style="display:inline-flex;align-items:center;gap:0.4rem">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload Excel
        </a>
      </div>
    `;

    container.innerHTML = `
      <div class="form-container">
        <h2 class="form-title">${title}</h2>
        ${uploadLink}
        <div id="form-errors"></div>
        <form id="monitor-form">
          <div class="form-group">
            <label for="group">Group</label>
            <div class="group-select-wrapper" id="group-select-wrapper">
              <select id="group" name="group">
                <option value="">-- No Group --</option>
              </select>
              <button type="button" class="btn btn-secondary btn-sm" id="add-group-btn" title="Add new group">+ New</button>
            </div>
            <div id="new-group-input" style="display:none;margin-top:0.5rem">
              <div style="display:flex;gap:0.5rem;align-items:center">
                <input type="text" id="new-group-name" placeholder="Enter new group name" style="flex:1">
                <button type="button" class="btn btn-primary btn-sm" id="confirm-new-group">Add</button>
                <button type="button" class="btn btn-secondary btn-sm" id="cancel-new-group">Cancel</button>
              </div>
            </div>
            <div class="hint">Optional group to organize monitors on the dashboard</div>
          </div>

          <div class="form-group">
            <label for="url">URL</label>
            <input type="url" id="url" name="url" value="${escapeAttr(url)}" placeholder="https://example.com" required>
            <div class="hint">The URL to monitor (must be http or https)</div>
          </div>

          <div class="form-group">
            <label for="name">Name</label>
            <input type="text" id="name" name="name" value="${escapeAttr(name)}" placeholder="My Website">
            <div class="hint">A friendly name for this monitor (auto-derived from URL if blank)</div>
          </div>

          <div class="form-group">
            <label for="frequency">Check Frequency</label>
            <select id="frequency" name="frequency">
              <option value="60" ${frequency === 60 ? 'selected' : ''}>Every 1 minute</option>
              <option value="300" ${frequency === 300 ? 'selected' : ''}>Every 5 minutes</option>
              <option value="900" ${frequency === 900 ? 'selected' : ''}>Every 15 minutes</option>
              <option value="1800" ${frequency === 1800 ? 'selected' : ''}>Every 30 minutes</option>
              <option value="3600" ${frequency === 3600 ? 'selected' : ''}>Every 1 hour</option>
            </select>
          </div>

          <div class="form-group">
            <label for="expectedStatus">Expected Status Code</label>
            <input type="number" id="expectedStatus" name="expectedStatus" value="${expectedStatus}" min="100" max="599">
            <div class="hint">The HTTP status code that indicates success (default: 200)</div>
          </div>

          <div class="form-group">
            <label for="timeoutMs">Timeout (ms)</label>
            <input type="number" id="timeoutMs" name="timeoutMs" value="${timeoutMs}" min="1000" max="30000" step="1000">
            <div class="hint">How long to wait for a response before considering it a timeout (1000-30000ms)</div>
          </div>

          <div class="form-group">
            <label for="notifyEmail">Notification Email</label>
            <input type="email" id="notifyEmail" name="notifyEmail" value="${escapeAttr(notifyEmail)}" placeholder="admin@example.com" required>
            <div class="hint">Email address to receive alerts when this URL goes down or recovers</div>
          </div>

          <div class="form-group">
            <label>Custom HTTP Headers</label>
            <div class="hint" style="margin-bottom:0.5rem">Add custom headers for API authentication (e.g., Authorization, x-api-key). Values are stored securely and masked in the UI.</div>
            <div id="custom-headers-list"></div>
            <button type="button" id="add-header-btn" class="btn btn-secondary btn-sm" style="margin-top:0.5rem">+ Add Header</button>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary">${monitor ? 'Update Monitor' : 'Create Monitor'}</button>
            <a href="#/" class="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    `;

    // Initialize custom headers UI
    const headersList = document.getElementById('custom-headers-list');
    const addBtn = document.getElementById('add-header-btn');
    let headerIndex = 0;

    function addHeaderRow(key, value, isMasked) {
      if (headersList.querySelectorAll('.header-row').length >= 10) return;
      const row = document.createElement('div');
      row.className = 'header-row';
      row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.4rem';
      const idx = headerIndex++;
      row.innerHTML = `
        <input type="text" class="header-key" data-idx="${idx}" value="${escapeAttr(key || '')}" placeholder="Header name (e.g. Authorization)" style="flex:1">
        <input type="text" class="header-value" data-idx="${idx}" value="${isMasked ? '' : escapeAttr(value || '')}" placeholder="${isMasked ? 'Re-enter value to update' : 'Header value'}" style="flex:1.5">
        <button type="button" class="btn btn-danger btn-sm header-remove" style="padding:0.25rem 0.5rem;font-size:0.75rem">Remove</button>
      `;
      row.querySelector('.header-remove').addEventListener('click', () => row.remove());
      headersList.appendChild(row);
    }

    // Populate existing headers (keys shown, values masked — user must re-enter)
    for (const h of existingHeaders) {
      addHeaderRow(h.key, '', true);
    }

    addBtn.addEventListener('click', () => addHeaderRow('', '', false));

    // Populate group dropdown from existing groups
    const groupSelect = document.getElementById('group');
    API.get('/monitors/groups').then(groups => {
      for (const g of groups) {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        if (g === group) opt.selected = true;
        groupSelect.appendChild(opt);
      }
      // If editing and group exists but wasn't in the list, add it
      if (group && !groups.includes(group)) {
        const opt = document.createElement('option');
        opt.value = group;
        opt.textContent = group;
        opt.selected = true;
        groupSelect.appendChild(opt);
      }
    }).catch(() => {});

    // Add new group inline
    document.getElementById('add-group-btn').addEventListener('click', () => {
      document.getElementById('new-group-input').style.display = 'block';
      document.getElementById('new-group-name').focus();
    });
    document.getElementById('cancel-new-group').addEventListener('click', () => {
      document.getElementById('new-group-input').style.display = 'none';
      document.getElementById('new-group-name').value = '';
    });
    document.getElementById('confirm-new-group').addEventListener('click', () => {
      const newName = document.getElementById('new-group-name').value.trim();
      if (!newName) return;
      if (newName.length > 100) {
        alert('Group name must be 100 characters or fewer');
        return;
      }
      // Check if already in the dropdown
      const exists = Array.from(groupSelect.options).some(o => o.value === newName);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = newName;
        opt.textContent = newName;
        groupSelect.appendChild(opt);
      }
      groupSelect.value = newName;
      document.getElementById('new-group-input').style.display = 'none';
      document.getElementById('new-group-name').value = '';
    });
    // Allow Enter key in new group input
    document.getElementById('new-group-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('confirm-new-group').click();
      }
    });

    document.getElementById('monitor-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorsEl = document.getElementById('form-errors');
      errorsEl.innerHTML = '';

      // Collect custom headers
      const headerRows = headersList.querySelectorAll('.header-row');
      const customHeaders = [];
      for (const row of headerRows) {
        const key = row.querySelector('.header-key').value.trim();
        const value = row.querySelector('.header-value').value;
        if (key && value) {
          customHeaders.push({ key, value });
        }
      }

      const groupVal = (document.getElementById('group').value || '').trim();
      const formData = {
        url: document.getElementById('url').value.trim(),
        name: document.getElementById('name').value.trim(),
        frequency: parseInt(document.getElementById('frequency').value, 10),
        expectedStatus: parseInt(document.getElementById('expectedStatus').value, 10),
        timeoutMs: parseInt(document.getElementById('timeoutMs').value, 10),
        notifyEmail: document.getElementById('notifyEmail').value.trim(),
      };

      if (groupVal) formData.group = groupVal;
      if (customHeaders.length > 0) {
        formData.customHeaders = customHeaders;
      }

      try {
        if (monitor) {
          await API.put(`/monitors/${monitor.id}`, formData);
        } else {
          await API.post('/monitors', formData);
        }
        location.hash = '#/';
      } catch (err) {
        const errors = err.data?.errors || [err.message];
        errorsEl.innerHTML = `
          <div class="form-errors">
            <ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
          </div>
        `;
      }
    });
  },
};

function escapeAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
