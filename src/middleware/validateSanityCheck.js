const VALID_CHECK_TYPES = ['count_zero', 'count_positive', 'count_range', 'custom_threshold'];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

function validateSanityCheckData(data) {
  const errors = [];

  if (!data.code || typeof data.code !== 'string' || data.code.trim().length === 0) {
    errors.push('Code is required');
  } else if (data.code.trim().length > 100) {
    errors.push('Code must be 100 characters or fewer');
  } else if (!/^[A-Za-z0-9_-]+$/.test(data.code.trim())) {
    errors.push('Code must contain only letters, numbers, underscores, and hyphens');
  }

  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('Name is required');
  } else if (data.name.trim().length > 255) {
    errors.push('Name must be 255 characters or fewer');
  }

  if (!data.clientUrl || typeof data.clientUrl !== 'string' || data.clientUrl.trim().length === 0) {
    errors.push('Client URL is required');
  } else {
    try {
      new URL(data.clientUrl);
    } catch {
      errors.push('Client URL must be a valid URL');
    }
  }

  if (data.checkType !== undefined && !VALID_CHECK_TYPES.includes(data.checkType)) {
    errors.push(`Check type must be one of: ${VALID_CHECK_TYPES.join(', ')}`);
  }

  if (data.severity !== undefined && !VALID_SEVERITIES.includes(data.severity)) {
    errors.push(`Severity must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  if (data.frequencySeconds !== undefined) {
    const freq = parseInt(data.frequencySeconds, 10);
    if (isNaN(freq) || freq < 30) {
      errors.push('Frequency must be at least 30 seconds');
    }
  }

  const checkType = data.checkType || 'count_zero';
  if (checkType === 'count_range' || checkType === 'custom_threshold') {
    if (data.expectedMin === undefined && data.expectedMax === undefined) {
      errors.push('Expected min and/or max is required for this check type');
    }
  }

  return errors;
}

function validateSanityCheck(req, res, next) {
  const errors = validateSanityCheckData(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  next();
}

module.exports = { validateSanityCheck, validateSanityCheckData };
