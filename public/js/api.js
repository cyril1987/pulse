/* ── Custom Modal (replaces native alert/confirm with X close button) ── */
const Modal = {
  _overlay: null,

  _getOverlay() {
    if (!this._overlay) {
      this._overlay = document.createElement('div');
      this._overlay.className = 'modal-overlay';
      document.body.appendChild(this._overlay);
    }
    return this._overlay;
  },

  /**
   * Show an alert dialog with an X close button.
   * @param {string} message
   * @param {string} [title='Notice']
   * @returns {Promise<void>}
   */
  alert(message, title = 'Notice') {
    return new Promise((resolve) => {
      const overlay = this._getOverlay();
      overlay.innerHTML = `
        <div class="modal-dialog">
          <button class="modal-close" id="modal-close-x">&times;</button>
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-body">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn btn-primary btn-sm" id="modal-ok">OK</button>
          </div>
        </div>
      `;
      overlay.style.display = 'flex';

      const close = () => { overlay.style.display = 'none'; resolve(); };
      document.getElementById('modal-ok').addEventListener('click', close);
      document.getElementById('modal-close-x').addEventListener('click', close);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      document.getElementById('modal-ok').focus();
    });
  },

  /**
   * Show a confirm dialog with an X close button.
   * @param {string} message
   * @param {string} [title='Confirm']
   * @returns {Promise<boolean>}
   */
  confirm(message, title = 'Confirm') {
    return new Promise((resolve) => {
      const overlay = this._getOverlay();
      overlay.innerHTML = `
        <div class="modal-dialog">
          <button class="modal-close" id="modal-close-x">&times;</button>
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-body">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" id="modal-cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" id="modal-confirm">Confirm</button>
          </div>
        </div>
      `;
      overlay.style.display = 'flex';

      const yes = () => { overlay.style.display = 'none'; resolve(true); };
      const no = () => { overlay.style.display = 'none'; resolve(false); };
      document.getElementById('modal-confirm').addEventListener('click', yes);
      document.getElementById('modal-cancel').addEventListener('click', no);
      document.getElementById('modal-close-x').addEventListener('click', no);
      overlay.addEventListener('click', (e) => { if (e.target === overlay) no(); });
      document.getElementById('modal-confirm').focus();
    });
  },
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const API = {
  _handleUnauthorized(res) {
    if (res.status === 401) {
      window.location.href = '/login.html';
      // Throw to prevent callers from processing the undefined return
      throw new Error('Session expired');
    }
  },

  async get(path) {
    const res = await fetch(`/api${path}`);
    this._handleUnauthorized(res);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || body.errors?.join(', ') || res.statusText);
    }
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    this._handleUnauthorized(res);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      const err = new Error(data.error || data.errors?.join(', ') || res.statusText);
      err.data = data;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  },

  async put(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    this._handleUnauthorized(res);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      const err = new Error(data.error || data.errors?.join(', ') || res.statusText);
      err.data = data;
      throw err;
    }
    return res.json();
  },

  async delete(path) {
    const res = await fetch(`/api${path}`, { method: 'DELETE' });
    this._handleUnauthorized(res);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(data.error || res.statusText);
    }
    return null;
  },
};
