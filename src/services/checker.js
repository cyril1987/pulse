const db = require('../db');

const insertCheck = db.prepare(`
  INSERT INTO checks (monitor_id, status_code, response_time_ms, is_success, error_message)
  VALUES (?, ?, ?, ?, ?)
`);

const updateLastChecked = db.prepare(
  "UPDATE monitors SET last_checked_at = datetime('now') WHERE id = ?"
);

async function checkMonitor(monitor) {
  const startTime = Date.now();
  let statusCode = null;
  let responseTimeMs = null;
  let isSuccess = false;
  let errorMessage = null;

  try {
    // Build headers: start with default User-Agent, then merge custom headers
    const headers = { 'User-Agent': 'URLMonitor/1.0' };
    if (monitor.custom_headers) {
      try {
        const custom = JSON.parse(monitor.custom_headers);
        for (const h of custom) {
          if (h.key && h.value) headers[h.key] = h.value;
        }
      } catch {
        // Invalid JSON — skip custom headers
      }
    }

    const response = await fetch(monitor.url, {
      method: 'GET',
      signal: AbortSignal.timeout(monitor.timeout_ms),
      redirect: 'follow',
      headers,
    });

    statusCode = response.status;
    responseTimeMs = Date.now() - startTime;

    // Consume a small amount of body to ensure the connection is fully established
    const body = await response.text();
    void body;

    isSuccess = statusCode === monitor.expected_status;
    if (!isSuccess) {
      errorMessage = `Unexpected status code: ${statusCode} (expected ${monitor.expected_status})`;
    }
  } catch (err) {
    responseTimeMs = Date.now() - startTime;
    errorMessage = classifyError(err);
  }

  insertCheck.run(monitor.id, statusCode, responseTimeMs, isSuccess ? 1 : 0, errorMessage);
  updateLastChecked.run(monitor.id);

  return { statusCode, responseTimeMs, isSuccess, errorMessage };
}

function classifyError(err) {
  const code = err.cause?.code || err.code;
  switch (code) {
    case 'ENOTFOUND':
      return 'DNS resolution failed';
    case 'ECONNREFUSED':
      return 'Connection refused';
    case 'ECONNRESET':
      return 'Connection reset';
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return 'Connection timed out';
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'TLS/SSL certificate error';
    default:
      break;
  }

  if (err.name === 'TimeoutError' || err.name === 'AbortError') {
    return 'Request timed out';
  }

  return err.message || 'Unknown error';
}

module.exports = { checkMonitor };
