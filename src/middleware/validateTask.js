const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];
const VALID_SOURCES = ['manual', 'ismart', 'recurring', 'jira', 'sanity_check'];
const VALID_RECURRENCE_TYPES = ['daily', 'weekly', 'monthly', 'yearly'];

function validateTaskData(data) {
  const errors = [];

  // title: required, 1-255 chars
  if (!data.title || typeof data.title !== 'string' || data.title.trim().length === 0) {
    errors.push('Title is required');
  } else if (data.title.trim().length > 255) {
    errors.push('Title must be 255 characters or fewer');
  }

  // description: optional, max 5000 chars
  if (data.description !== undefined && data.description !== null && data.description !== '') {
    if (typeof data.description !== 'string') {
      errors.push('Description must be a string');
    } else if (data.description.length > 5000) {
      errors.push('Description must be 5000 characters or fewer');
    }
  }

  // priority
  if (data.priority !== undefined && !VALID_PRIORITIES.includes(data.priority)) {
    errors.push(`Priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  // status
  if (data.status !== undefined && !VALID_STATUSES.includes(data.status)) {
    errors.push(`Status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // source
  if (data.source !== undefined && !VALID_SOURCES.includes(data.source)) {
    errors.push(`Source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  // source_ref: optional, max 255 chars
  if (data.sourceRef !== undefined && data.sourceRef !== null && data.sourceRef !== '') {
    if (typeof data.sourceRef !== 'string') {
      errors.push('Source reference must be a string');
    } else if (data.sourceRef.length > 255) {
      errors.push('Source reference must be 255 characters or fewer');
    }
  }

  // due_date: optional, YYYY-MM-DD
  if (data.dueDate !== undefined && data.dueDate !== null && data.dueDate !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.dueDate)) {
      errors.push('Due date must be in YYYY-MM-DD format');
    } else {
      const d = new Date(data.dueDate);
      if (isNaN(d.getTime())) {
        errors.push('Due date is not a valid date');
      }
    }
  }

  // assigned_to: optional integer
  if (data.assignedTo !== undefined && data.assignedTo !== null && data.assignedTo !== '') {
    const id = parseInt(data.assignedTo, 10);
    if (isNaN(id) || id < 1) {
      errors.push('Assigned to must be a valid user ID');
    }
  }

  // category_id: optional integer
  if (data.categoryId !== undefined && data.categoryId !== null && data.categoryId !== '') {
    const id = parseInt(data.categoryId, 10);
    if (isNaN(id) || id < 1) {
      errors.push('Category must be a valid category ID');
    }
  }

  // parent_task_id: optional integer
  if (data.parentTaskId !== undefined && data.parentTaskId !== null && data.parentTaskId !== '') {
    const id = parseInt(data.parentTaskId, 10);
    if (isNaN(id) || id < 1) {
      errors.push('Parent task must be a valid task ID');
    }
  }

  // recurrence_pattern: optional JSON object
  if (data.recurrencePattern !== undefined && data.recurrencePattern !== null) {
    const p = data.recurrencePattern;
    if (typeof p !== 'object') {
      errors.push('Recurrence pattern must be an object');
    } else {
      if (!p.type || !VALID_RECURRENCE_TYPES.includes(p.type)) {
        errors.push(`Recurrence type must be one of: ${VALID_RECURRENCE_TYPES.join(', ')}`);
      }
      if (p.interval !== undefined) {
        const interval = parseInt(p.interval, 10);
        if (isNaN(interval) || interval < 1) {
          errors.push('Recurrence interval must be a positive integer');
        }
      }
      if (p.dayOfMonth !== undefined) {
        const day = parseInt(p.dayOfMonth, 10);
        if (isNaN(day) || day < 1 || day > 31) {
          errors.push('Day of month must be between 1 and 31');
        }
      }
      if (p.dayOfWeek !== undefined && p.dayOfWeek !== null) {
        if (typeof p.dayOfWeek === 'number' || typeof p.dayOfWeek === 'string') {
          const day = parseInt(p.dayOfWeek, 10);
          if (isNaN(day) || day < 0 || day > 6) {
            errors.push('Day of week must be between 0 (Sunday) and 6 (Saturday)');
          }
        } else if (Array.isArray(p.dayOfWeek)) {
          // Allow array of days for weekly recurrence on specific days
          for (const d of p.dayOfWeek) {
            const day = parseInt(d, 10);
            if (isNaN(day) || day < 0 || day > 6) {
              errors.push('Each day of week must be between 0 (Sunday) and 6 (Saturday)');
              break;
            }
          }
          if (p.dayOfWeek.length === 0) {
            errors.push('At least one day of week must be selected');
          }
        }
      }

      // daysOfWeek: array of days (for daily recurrence on specific days)
      if (p.daysOfWeek !== undefined && p.daysOfWeek !== null) {
        if (!Array.isArray(p.daysOfWeek)) {
          errors.push('Days of week must be an array');
        } else {
          for (const d of p.daysOfWeek) {
            const day = parseInt(d, 10);
            if (isNaN(day) || day < 0 || day > 6) {
              errors.push('Each day of week must be between 0 (Sunday) and 6 (Saturday)');
              break;
            }
          }
          if (p.daysOfWeek.length === 0) {
            errors.push('At least one day of week must be selected');
          }
        }
      }

      // nthWeekday: for monthly "Nth weekday" option (e.g., 2nd Tuesday)
      if (p.nthWeekday !== undefined && p.nthWeekday !== null) {
        if (typeof p.nthWeekday !== 'object') {
          errors.push('nthWeekday must be an object');
        } else {
          const n = parseInt(p.nthWeekday.n, 10);
          const day = parseInt(p.nthWeekday.day, 10);
          if (isNaN(n) || n < -1 || n > 5 || n === 0) {
            errors.push('nthWeekday.n must be 1-5 or -1 (last)');
          }
          if (isNaN(day) || day < 0 || day > 6) {
            errors.push('nthWeekday.day must be between 0 (Sunday) and 6 (Saturday)');
          }
        }
      }

      // monthOption: 'dayOfMonth', 'nthWeekday', 'lastDay'
      if (p.monthOption !== undefined && !['dayOfMonth', 'nthWeekday', 'lastDay'].includes(p.monthOption)) {
        errors.push('Month option must be one of: dayOfMonth, nthWeekday, lastDay');
      }
      if (p.month !== undefined) {
        const month = parseInt(p.month, 10);
        if (isNaN(month) || month < 1 || month > 12) {
          errors.push('Month must be between 1 and 12');
        }
      }
    }
  }

  // recurrence_end_at: optional, YYYY-MM-DD
  if (data.recurrenceEndAt !== undefined && data.recurrenceEndAt !== null && data.recurrenceEndAt !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.recurrenceEndAt)) {
      errors.push('Recurrence end date must be in YYYY-MM-DD format');
    }
  }

  // jiraKey: optional, must be a valid Jira issue key format
  if (data.jiraKey !== undefined && data.jiraKey !== null && data.jiraKey !== '') {
    if (typeof data.jiraKey !== 'string') {
      errors.push('Jira key must be a string');
    } else if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(data.jiraKey.toUpperCase())) {
      errors.push('Jira key must be in the format PROJECT-123');
    }
  }

  return errors;
}

function validateTask(req, res, next) {
  const errors = validateTaskData(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }
  next();
}

module.exports = { validateTask, validateTaskData };
