const BulkUpload = {
  parsedRows: [],
  currentStep: 1,
  importResults: null,
  availableGroups: [],

  render(container) {
    this.parsedRows = [];
    this.currentStep = 1;
    this.importResults = null;
    this.availableGroups = [];
    // Pre-fetch available groups
    API.get('/monitors/groups').then(groups => {
      this.availableGroups = groups;
    }).catch(() => {});
    this.renderUploadStep(container);
  },

  // ── Step 1: File Selection ──────────────────────────────────────────

  renderUploadStep(container) {
    this.currentStep = 1;
    container.innerHTML = `
      <div class="form-container" style="max-width:720px">
        ${this.renderSteps(1)}
        <h2 class="form-title">Bulk Upload Monitors</h2>
        <p style="color:var(--color-text-secondary);font-size:0.88rem;margin-bottom:1.5rem">
          Upload an Excel (.xlsx, .xls) or CSV file to create multiple monitors at once.
        </p>
        <div id="upload-errors"></div>
        <div class="upload-dropzone" id="upload-dropzone">
          <div class="upload-dropzone-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="upload-dropzone-text">Drag and drop a file here, or click to browse</div>
          <div class="upload-dropzone-hint">Supported: .xlsx, .xls, .csv (max 100 rows, 5MB)</div>
          <input type="file" id="file-input" accept=".xlsx,.xls,.csv" style="display:none">
        </div>
        <div class="form-actions" style="margin-top:1.5rem">
          <button type="button" class="btn btn-secondary" id="download-template-btn">Download Template</button>
          <a href="#/" class="btn btn-secondary">Cancel</a>
        </div>
      </div>
    `;

    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('file-input');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) this.handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) this.handleFile(fileInput.files[0]);
    });

    document.getElementById('download-template-btn').addEventListener('click', () => this.downloadTemplate());
  },

  handleFile(file) {
    const errorsEl = document.getElementById('upload-errors');
    errorsEl.innerHTML = '';

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      errorsEl.innerHTML = '<div class="form-errors"><ul><li>Unsupported file format. Please upload .xlsx, .xls, or .csv</li></ul></div>';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      errorsEl.innerHTML = '<div class="form-errors"><ul><li>File too large. Maximum size is 5MB.</li></ul></div>';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });

        if (jsonRows.length === 0) {
          errorsEl.innerHTML = '<div class="form-errors"><ul><li>The file contains no data rows.</li></ul></div>';
          return;
        }
        if (jsonRows.length > 100) {
          errorsEl.innerHTML = `<div class="form-errors"><ul><li>Maximum 100 rows per upload. Your file has ${jsonRows.length} rows.</li></ul></div>`;
          return;
        }

        this.parsedRows = this.normalizeAndValidate(jsonRows);
        this.renderStagingStep(document.getElementById('app'));
      } catch (err) {
        errorsEl.innerHTML = `<div class="form-errors"><ul><li>Failed to parse file: ${escapeHtml(err.message)}</li></ul></div>`;
      }
    };
    reader.readAsArrayBuffer(file);
  },

  downloadTemplate() {
    const headers = [
      'group', 'url', 'name', 'notify_email', 'frequency_seconds',
      'expected_status', 'timeout_ms',
      'header_1_key', 'header_1_value',
      'header_2_key', 'header_2_value',
      'header_3_key', 'header_3_value'
    ];
    const sampleRows = [
      {
        group: 'Production', url: 'https://example.com', name: 'Example Site',
        notify_email: 'admin@example.com', frequency_seconds: 300,
        expected_status: 200, timeout_ms: 10000,
        header_1_key: '', header_1_value: '',
        header_2_key: '', header_2_value: '',
        header_3_key: '', header_3_value: ''
      },
      {
        group: 'Demo Environment', url: 'https://api.example.com/health', name: 'Example API',
        notify_email: 'devops@example.com', frequency_seconds: 60,
        expected_status: 200, timeout_ms: 5000,
        header_1_key: 'Authorization', header_1_value: 'Bearer YOUR_TOKEN',
        header_2_key: '', header_2_value: '',
        header_3_key: '', header_3_value: ''
      }
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows, { header: headers });
    // Set column widths for readability
    ws['!cols'] = [
      { wch: 20 }, { wch: 35 }, { wch: 18 }, { wch: 25 }, { wch: 18 },
      { wch: 15 }, { wch: 12 },
      { wch: 18 }, { wch: 25 },
      { wch: 18 }, { wch: 25 },
      { wch: 18 }, { wch: 25 }
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Monitors');
    XLSX.writeFile(wb, 'iconcile-pulse-monitors-template.xlsx');
  },

  // ── Parsing & Validation ────────────────────────────────────────────

  normalizeAndValidate(jsonRows) {
    const columnMap = {
      'group': 'group', 'group_name': 'group', 'monitor_group': 'group', 'category': 'group', 'environment': 'group',
      'url': 'url', 'website': 'url', 'endpoint': 'url',
      'name': 'name', 'monitor_name': 'name',
      'notify_email': 'notifyEmail', 'notifyemail': 'notifyEmail',
      'email': 'notifyEmail', 'notification_email': 'notifyEmail',
      'frequency_seconds': 'frequency', 'frequency': 'frequency', 'frequencyseconds': 'frequency',
      'expected_status': 'expectedStatus', 'expectedstatus': 'expectedStatus', 'status_code': 'expectedStatus',
      'timeout_ms': 'timeoutMs', 'timeoutms': 'timeoutMs', 'timeout': 'timeoutMs',
      'custom_headers_json': 'customHeadersJson',
    };
    // Add header_N_key/value mappings
    for (let n = 1; n <= 10; n++) {
      columnMap[`header_${n}_key`] = `header_${n}_key`;
      columnMap[`header_${n}_value`] = `header_${n}_value`;
    }

    const rows = jsonRows.map((row, i) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        const mapped = columnMap[key.toLowerCase().trim()];
        if (mapped) {
          normalized[mapped] = typeof value === 'string' ? value.trim() : value;
        }
      }

      // Assemble customHeaders
      normalized.customHeaders = [];
      if (normalized.customHeadersJson) {
        try {
          normalized.customHeaders = JSON.parse(normalized.customHeadersJson);
        } catch { /* validation will catch it */ }
        delete normalized.customHeadersJson;
      } else {
        for (let h = 1; h <= 10; h++) {
          const key = normalized[`header_${h}_key`];
          const value = normalized[`header_${h}_value`];
          if (key && value) {
            normalized.customHeaders.push({ key: String(key).trim(), value: String(value).trim() });
          }
          delete normalized[`header_${h}_key`];
          delete normalized[`header_${h}_value`];
        }
      }
      if (normalized.customHeaders.length === 0) delete normalized.customHeaders;

      // Coerce numeric fields
      if (normalized.frequency !== undefined && normalized.frequency !== '') {
        normalized.frequency = parseInt(normalized.frequency, 10);
      } else {
        delete normalized.frequency;
      }
      if (normalized.expectedStatus !== undefined && normalized.expectedStatus !== '') {
        normalized.expectedStatus = parseInt(normalized.expectedStatus, 10);
      } else {
        delete normalized.expectedStatus;
      }
      if (normalized.timeoutMs !== undefined && normalized.timeoutMs !== '') {
        normalized.timeoutMs = parseInt(normalized.timeoutMs, 10);
      } else {
        delete normalized.timeoutMs;
      }

      // Convert url and notifyEmail to strings
      if (normalized.url !== undefined) normalized.url = String(normalized.url);
      if (normalized.notifyEmail !== undefined) normalized.notifyEmail = String(normalized.notifyEmail);
      if (normalized.name !== undefined) normalized.name = String(normalized.name);
      if (normalized.group !== undefined) normalized.group = String(normalized.group);

      return { rowNum: i + 1, data: normalized, errors: [], isValid: true };
    });

    // Filter out completely empty rows
    const filtered = rows.filter(r => r.data.url || r.data.notifyEmail || r.data.name);

    filtered.forEach(r => this.validateRow(r));

    // Check for duplicates within the batch
    this.checkBatchDuplicates(filtered);

    return filtered;
  },

  checkBatchDuplicates(rows) {
    const urlCount = {};
    const nameCount = {};
    for (const r of rows) {
      if (r.data.url) {
        urlCount[r.data.url] = (urlCount[r.data.url] || 0) + 1;
      }
      const name = r.data.name || '';
      if (name) {
        nameCount[name] = (nameCount[name] || 0) + 1;
      }
    }
    for (const r of rows) {
      if (r.data.url && urlCount[r.data.url] > 1) {
        if (!r.errors.some(e => e.includes('Duplicate URL'))) {
          r.errors.push('Duplicate URL within this upload batch');
          r.isValid = false;
        }
      }
      const name = r.data.name || '';
      if (name && nameCount[name] > 1) {
        if (!r.errors.some(e => e.includes('Duplicate name'))) {
          r.errors.push('Duplicate name within this upload batch');
          r.isValid = false;
        }
      }
    }
  },

  validateRow(row) {
    const ALLOWED_FREQUENCIES = [60, 300, 900, 1800, 3600];
    const FORBIDDEN_HEADERS = ['host', 'content-length', 'transfer-encoding', 'cookie', 'connection'];
    const errors = [];
    const d = row.data;

    // URL
    if (!d.url) {
      errors.push('url is required');
    } else {
      try {
        const parsed = new URL(d.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('url must use http or https');
        const host = parsed.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
            host.startsWith('10.') || host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
          errors.push('url must not point to a private/internal address');
        }
      } catch { errors.push('url is not a valid URL'); }
    }

    // Email
    if (!d.notifyEmail) {
      errors.push('notifyEmail is required');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.notifyEmail)) {
      errors.push('notifyEmail must be a valid email address');
    }

    // Frequency
    if (d.frequency !== undefined) {
      if (isNaN(d.frequency) || !ALLOWED_FREQUENCIES.includes(d.frequency)) {
        errors.push('frequency must be one of: ' + ALLOWED_FREQUENCIES.join(', '));
      }
    }

    // Expected status
    if (d.expectedStatus !== undefined) {
      if (isNaN(d.expectedStatus) || !Number.isInteger(d.expectedStatus) || d.expectedStatus < 100 || d.expectedStatus > 599) {
        errors.push('expectedStatus must be 100-599');
      }
    }

    // Timeout
    if (d.timeoutMs !== undefined) {
      if (isNaN(d.timeoutMs) || !Number.isInteger(d.timeoutMs) || d.timeoutMs < 1000 || d.timeoutMs > 30000) {
        errors.push('timeoutMs must be 1000-30000');
      }
    }

    // Custom headers
    if (d.customHeaders && d.customHeaders.length > 0) {
      if (d.customHeaders.length > 10) errors.push('Maximum 10 custom headers');
      for (let i = 0; i < d.customHeaders.length; i++) {
        const h = d.customHeaders[i];
        if (!/^[\w-]+$/.test(h.key)) errors.push('Header "' + escapeHtml(h.key) + '": invalid key format');
        else if (FORBIDDEN_HEADERS.includes(h.key.toLowerCase())) errors.push('Header "' + escapeHtml(h.key) + '" is forbidden');
        if (typeof h.value === 'string' && h.value.length > 2000) errors.push('Header "' + escapeHtml(h.key) + '" value too long');
      }
    }

    row.errors = errors;
    row.isValid = errors.length === 0;
    return row;
  },

  // ── Step 2: Staging / Review ────────────────────────────────────────

  renderStagingStep(container) {
    this.currentStep = 2;
    const validCount = this.parsedRows.filter(r => r.isValid).length;
    const invalidCount = this.parsedRows.length - validCount;

    container.innerHTML = `
      <div style="max-width:1100px;margin:0 auto;padding:0 1rem">
        ${this.renderSteps(2)}
        <h2 class="form-title" style="margin-bottom:1rem">Review Monitors</h2>
        <div id="staging-errors"></div>

        <div class="staging-summary">
          <div>
            <span class="count-valid">${validCount} valid</span>
            ${invalidCount > 0 ? `, <span class="count-invalid">${invalidCount} with errors</span>` : ''}
            &mdash; ${this.parsedRows.length} total rows
          </div>
          <div style="display:flex;gap:0.5rem">
            ${invalidCount > 0 ? '<button class="btn btn-secondary btn-sm" id="remove-invalid-btn">Remove All Invalid</button>' : ''}
          </div>
        </div>

        <div style="overflow-x:auto">
          <table class="checks-table staging-table" id="staging-table">
            <thead>
              <tr>
                <th style="width:36px">#</th>
                <th style="width:36px"></th>
                <th style="min-width:110px">Group</th>
                <th style="min-width:200px">URL</th>
                <th style="min-width:120px">Name</th>
                <th style="width:130px">Frequency</th>
                <th style="width:90px">Status</th>
                <th style="width:100px">Timeout</th>
                <th style="min-width:170px">Email</th>
                <th style="width:70px">Headers</th>
                <th style="width:50px"></th>
              </tr>
            </thead>
            <tbody id="staging-tbody"></tbody>
          </table>
        </div>

        <div class="form-actions" style="margin-top:1.5rem">
          <button class="btn btn-primary" id="import-btn" ${validCount === 0 ? 'disabled' : ''}>
            Import ${validCount} Valid Monitor${validCount !== 1 ? 's' : ''}
          </button>
          <button class="btn btn-secondary" id="back-btn">Back</button>
        </div>
      </div>
    `;

    this.renderStagingRows();

    document.getElementById('back-btn').addEventListener('click', () => this.renderUploadStep(container));
    document.getElementById('import-btn').addEventListener('click', () => this.submitImport(container));
    const removeInvalidBtn = document.getElementById('remove-invalid-btn');
    if (removeInvalidBtn) {
      removeInvalidBtn.addEventListener('click', () => {
        this.parsedRows = this.parsedRows.filter(r => r.isValid);
        this.renderStagingStep(container);
      });
    }
  },

  renderGroupSelect(rowIdx, currentValue) {
    // Merge available groups with groups from parsed data
    const allGroups = new Set(this.availableGroups);
    for (const r of this.parsedRows) {
      if (r.data.group) allGroups.add(r.data.group);
    }
    const sorted = [...allGroups].sort((a, b) => a.localeCompare(b));
    const options = [`<option value="">--</option>`];
    for (const g of sorted) {
      options.push(`<option value="${escapeAttr(g)}" ${g === currentValue ? 'selected' : ''}>${escapeAttr(g)}</option>`);
    }
    options.push(`<option value="__add_new__">+ Add New...</option>`);
    return `<select class="staging-cell-input staging-group-select" data-row="${rowIdx}" data-field="group">${options.join('')}</select>`;
  },

  renderStagingRows() {
    const tbody = document.getElementById('staging-tbody');
    const FREQS = [60, 300, 900, 1800, 3600];
    const FREQ_LABELS = { 60: '1 min', 300: '5 min', 900: '15 min', 1800: '30 min', 3600: '1 hour' };

    let html = '';
    for (let i = 0; i < this.parsedRows.length; i++) {
      const r = this.parsedRows[i];
      const d = r.data;
      const freqVal = d.frequency || 300;
      const headerCount = d.customHeaders ? d.customHeaders.length : 0;

      html += `<tr class="${r.isValid ? 'staging-row-valid' : 'staging-row-invalid'}">
        <td style="text-align:center;color:var(--color-text-tertiary)">${r.rowNum}</td>
        <td style="text-align:center"><span class="status-dot ${r.isValid ? 'up' : 'down'}" style="display:inline-block"></span></td>
        <td>${this.renderGroupSelect(i, d.group || '')}</td>
        <td><input type="text" class="staging-cell-input ${r.errors.some(e => e.includes('url')) ? 'has-error' : ''}" data-row="${i}" data-field="url" value="${escapeAttr(d.url || '')}"></td>
        <td><input type="text" class="staging-cell-input" data-row="${i}" data-field="name" value="${escapeAttr(d.name || '')}"></td>
        <td>
          <select class="staging-cell-input" data-row="${i}" data-field="frequency">
            ${FREQS.map(f => `<option value="${f}" ${freqVal === f ? 'selected' : ''}>${FREQ_LABELS[f]}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="staging-cell-input ${r.errors.some(e => e.includes('expectedStatus')) ? 'has-error' : ''}" data-row="${i}" data-field="expectedStatus" value="${d.expectedStatus !== undefined ? d.expectedStatus : 200}" min="100" max="599"></td>
        <td><input type="number" class="staging-cell-input ${r.errors.some(e => e.includes('timeoutMs')) ? 'has-error' : ''}" data-row="${i}" data-field="timeoutMs" value="${d.timeoutMs !== undefined ? d.timeoutMs : 10000}" min="1000" max="30000" step="1000"></td>
        <td><input type="text" class="staging-cell-input ${r.errors.some(e => e.includes('notifyEmail') || e.includes('email')) ? 'has-error' : ''}" data-row="${i}" data-field="notifyEmail" value="${escapeAttr(d.notifyEmail || '')}"></td>
        <td style="text-align:center;font-size:0.8rem;color:var(--color-text-tertiary)">${headerCount > 0 ? headerCount : '--'}</td>
        <td style="text-align:center"><button class="btn btn-danger btn-sm staging-remove-btn" data-row="${i}" style="padding:0.2rem 0.45rem;font-size:0.7rem" title="Remove row">X</button></td>
      </tr>`;

      if (!r.isValid) {
        html += `<tr class="staging-row-invalid"><td colspan="11" class="staging-row-errors">${r.errors.map(e => escapeHtml(e)).join(' &bull; ')}</td></tr>`;
      }
    }

    if (this.parsedRows.length === 0) {
      html = '<tr><td colspan="11" style="text-align:center;padding:2rem;color:var(--color-text-tertiary)">No rows to display</td></tr>';
    }

    tbody.innerHTML = html;

    // Attach event listeners
    tbody.querySelectorAll('.staging-cell-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const rowIdx = parseInt(e.target.dataset.row, 10);
        const field = e.target.dataset.field;
        let value = e.target.value;

        // Handle "Add New" group option
        if (field === 'group' && value === '__add_new__') {
          const newGroup = prompt('Enter new group name:');
          if (newGroup && newGroup.trim()) {
            const trimmed = newGroup.trim();
            if (trimmed.length > 100) {
              alert('Group name must be 100 characters or fewer');
              e.target.value = this.parsedRows[rowIdx].data.group || '';
              return;
            }
            if (!this.availableGroups.includes(trimmed)) {
              this.availableGroups.push(trimmed);
            }
            this.parsedRows[rowIdx].data.group = trimmed;
          } else {
            e.target.value = this.parsedRows[rowIdx].data.group || '';
            return;
          }
          this.validateRow(this.parsedRows[rowIdx]);
          this.refreshStaging();
          return;
        }

        if (field === 'frequency') value = parseInt(value, 10);
        else if (field === 'expectedStatus') value = parseInt(value, 10);
        else if (field === 'timeoutMs') value = parseInt(value, 10);
        else value = value.trim();

        this.parsedRows[rowIdx].data[field] = value;
        this.validateRow(this.parsedRows[rowIdx]);
        this.refreshStaging();
      });
    });

    tbody.querySelectorAll('.staging-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const rowIdx = parseInt(e.target.dataset.row, 10);
        this.parsedRows.splice(rowIdx, 1);
        this.refreshStaging();
      });
    });
  },

  refreshStaging() {
    // Re-validate all rows including batch duplicate checks
    this.parsedRows.forEach(r => this.validateRow(r));
    this.checkBatchDuplicates(this.parsedRows);

    const validCount = this.parsedRows.filter(r => r.isValid).length;
    const invalidCount = this.parsedRows.length - validCount;

    // Update summary
    const summary = document.querySelector('.staging-summary > div:first-child');
    if (summary) {
      summary.innerHTML = `<span class="count-valid">${validCount} valid</span>${invalidCount > 0 ? `, <span class="count-invalid">${invalidCount} with errors</span>` : ''} &mdash; ${this.parsedRows.length} total rows`;
    }

    // Update import button
    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
      importBtn.disabled = validCount === 0;
      importBtn.textContent = `Import ${validCount} Valid Monitor${validCount !== 1 ? 's' : ''}`;
    }

    // Update remove invalid button
    const removeInvalidBtn = document.getElementById('remove-invalid-btn');
    if (removeInvalidBtn) {
      removeInvalidBtn.style.display = invalidCount > 0 ? '' : 'none';
    }

    this.renderStagingRows();
  },

  // ── Step 3: Import ──────────────────────────────────────────────────

  async submitImport(container) {
    const importBtn = document.getElementById('import-btn');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.textContent = 'Importing...';
    }

    const validRows = this.parsedRows.filter(r => r.isValid);
    const payload = {
      monitors: validRows.map(r => {
        const d = { ...r.data };
        // Ensure defaults are not sent as undefined
        if (!d.frequency) delete d.frequency;
        if (!d.expectedStatus) delete d.expectedStatus;
        if (!d.timeoutMs) delete d.timeoutMs;
        if (!d.name) delete d.name;
        if (!d.group) delete d.group;
        return d;
      })
    };

    try {
      const result = await API.post('/monitors/bulk', payload);
      this.importResults = result;
      this.renderResultsStep(container);
    } catch (err) {
      const errorsEl = document.getElementById('staging-errors');
      if (errorsEl) {
        errorsEl.innerHTML = `<div class="form-errors"><ul><li>${escapeHtml(err.message || 'Import failed')}</li></ul></div>`;
      }
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.textContent = `Import ${validRows.length} Valid Monitor${validRows.length !== 1 ? 's' : ''}`;
      }
    }
  },

  renderResultsStep(container) {
    this.currentStep = 3;
    const r = this.importResults;

    let failedHtml = '';
    if (r.failed && r.failed.length > 0) {
      failedHtml = `
        <div style="margin-top:1.5rem">
          <h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--color-down)">Failed Rows</h3>
          <table class="checks-table" style="font-size:0.82rem">
            <thead>
              <tr><th>Row</th><th>Errors</th></tr>
            </thead>
            <tbody>
              ${r.failed.map(f => `
                <tr>
                  <td style="width:60px;text-align:center">${f.rowIndex + 1}</td>
                  <td>${f.errors.map(e => escapeHtml(e)).join(', ')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="import-results">
        ${this.renderSteps(3)}
        <h2 class="form-title" style="margin-bottom:1.5rem">Import Complete</h2>

        <div style="display:flex;gap:2rem;justify-content:center;margin-bottom:1.5rem">
          <div style="text-align:center">
            <div class="import-success-count">${r.summary.created}</div>
            <div style="font-size:0.82rem;color:var(--color-text-secondary)">Created</div>
          </div>
          <div style="text-align:center">
            <div class="import-fail-count">${r.summary.failed}</div>
            <div style="font-size:0.82rem;color:var(--color-text-secondary)">Failed</div>
          </div>
        </div>

        ${r.created && r.created.length > 0 ? `
          <div style="margin-bottom:1rem">
            <h3 style="font-size:0.95rem;margin-bottom:0.75rem;color:var(--color-up)">Created Monitors</h3>
            <div style="font-size:0.82rem;color:var(--color-text-secondary)">
              ${r.created.map(c => `<div style="margin-bottom:0.2rem">${escapeHtml(c.name)} <span style="color:var(--color-text-tertiary)">(ID: ${c.monitorId})</span></div>`).join('')}
            </div>
          </div>
        ` : ''}

        ${failedHtml}

        <div class="form-actions" style="margin-top:2rem">
          <a href="#/" class="btn btn-primary">Go to Dashboard</a>
          <button class="btn btn-secondary" id="upload-more-btn">Upload More</button>
        </div>
      </div>
    `;

    document.getElementById('upload-more-btn').addEventListener('click', () => {
      this.render(container);
    });
  },

  // ── Step indicator ──────────────────────────────────────────────────

  renderSteps(active) {
    const steps = [
      { num: 1, label: 'Upload' },
      { num: 2, label: 'Review' },
      { num: 3, label: 'Results' }
    ];
    return `
      <div class="upload-steps">
        ${steps.map(s => {
          const cls = s.num === active ? 'active' : (s.num < active ? 'completed' : '');
          return `<div class="upload-step ${cls}">
            <span class="upload-step-number">${s.num < active ? '&#10003;' : s.num}</span>
            <span>${s.label}</span>
          </div>`;
        }).join('')}
      </div>
    `;
  },
};
