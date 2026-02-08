const ALLOWED_FREQUENCIES = [60, 300, 900, 1800, 3600];
const FORBIDDEN_HEADERS = ['host', 'content-length', 'transfer-encoding', 'cookie', 'connection'];

// Pure validation function — returns array of error strings
function validateMonitorData(data) {
  const errors = [];
  const { url, name, frequency, expectedStatus, timeoutMs, notifyEmail, customHeaders } = data;

  // URL validation
  if (!url || typeof url !== 'string') {
    errors.push('url is required');
  } else {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('url must use http or https protocol');
      }
      if (!parsed.hostname) {
        errors.push('url must have a valid hostname');
      }
      // Block private/internal IPs
      const host = parsed.hostname;
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      ) {
        errors.push('url must not point to a private/internal address');
      }
    } catch {
      errors.push('url is not a valid URL');
    }
  }

  // Frequency validation
  if (frequency !== undefined) {
    const freq = Number(frequency);
    if (!ALLOWED_FREQUENCIES.includes(freq)) {
      errors.push(`frequency must be one of: ${ALLOWED_FREQUENCIES.join(', ')} (seconds)`);
    }
  }

  // Expected status validation
  if (expectedStatus !== undefined) {
    const status = Number(expectedStatus);
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      errors.push('expectedStatus must be a valid HTTP status code (100-599)');
    }
  }

  // Timeout validation
  if (timeoutMs !== undefined) {
    const timeout = Number(timeoutMs);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) {
      errors.push('timeoutMs must be between 1000 and 30000');
    }
  }

  // Email validation
  if (!notifyEmail || typeof notifyEmail !== 'string') {
    errors.push('notifyEmail is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notifyEmail)) {
    errors.push('notifyEmail must be a valid email address');
  }

  // Group name validation
  if (data.group !== undefined && data.group !== null && data.group !== '') {
    if (typeof data.group !== 'string') {
      errors.push('group must be a string');
    } else if (data.group.length > 100) {
      errors.push('group must be 100 characters or fewer');
    }
  }

  // Custom headers validation
  if (customHeaders !== undefined && customHeaders !== null) {
    if (!Array.isArray(customHeaders)) {
      errors.push('customHeaders must be an array');
    } else if (customHeaders.length > 10) {
      errors.push('customHeaders cannot have more than 10 entries');
    } else {
      for (let i = 0; i < customHeaders.length; i++) {
        const h = customHeaders[i];
        if (!h || typeof h !== 'object') {
          errors.push(`customHeaders[${i}] must be an object with key and value`);
          continue;
        }
        if (!h.key || typeof h.key !== 'string' || !/^[\w-]+$/.test(h.key)) {
          errors.push(`customHeaders[${i}].key must contain only letters, numbers, hyphens, and underscores`);
        } else if (FORBIDDEN_HEADERS.includes(h.key.toLowerCase())) {
          errors.push(`customHeaders[${i}].key "${h.key}" is not allowed`);
        }
        if (typeof h.value !== 'string') {
          errors.push(`customHeaders[${i}].value must be a string`);
        } else if (h.value.length > 2000) {
          errors.push(`customHeaders[${i}].value exceeds maximum length of 2000 characters`);
        }
      }
    }
  }

  return errors;
}

// Express middleware wrapper
function validateMonitor(req, res, next) {
  const errors = validateMonitorData(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  next();
}

module.exports = { validateMonitor, validateMonitorData, ALLOWED_FREQUENCIES };
