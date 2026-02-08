const Settings = {
  async render(container) {
    container.innerHTML = '<div class="loading">Loading settings...</div>';

    try {
      const smtp = await API.get('/settings/smtp');
      Settings.renderContent(container, smtp);
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><h2>Error</h2><p>${err.message}</p></div>`;
    }
  },

  renderContent(container, smtp) {
    const statusColor = smtp.configured ? 'var(--color-up)' : 'var(--color-down)';
    const statusText = smtp.configured ? 'Configured' : 'Not Configured';

    container.innerHTML = `
      <div class="form-container" style="max-width:640px">
        <h2 class="form-title">Settings</h2>

        <div style="margin-bottom:2rem">
          <h3 style="font-size:0.95rem;font-weight:600;margin-bottom:1rem;color:var(--color-text-secondary)">SMTP Configuration</h3>
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
};
