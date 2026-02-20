let currentUser = null;
let avatarMap = {};

/**
 * Get avatar HTML for any user by ID.
 * Returns <img> if avatar exists in the map, otherwise an initials placeholder.
 * @param {number} userId
 * @param {string} [name] - user's display name (for initials fallback)
 * @param {string} [extraClass] - additional CSS class(es) for the element
 */
function getAvatarHtml(userId, name, extraClass) {
  const url = avatarMap[userId];
  const cls = extraClass ? `task-avatar ${extraClass}` : 'task-avatar';
  const plCls = extraClass ? `task-avatar-placeholder ${extraClass}` : 'task-avatar-placeholder';
  if (url) {
    return `<img class="${cls}" src="${escapeHtml(url)}" alt="" referrerpolicy="no-referrer">`;
  }
  const initial = (name || '?').charAt(0).toUpperCase();
  return `<span class="${plCls}">${escapeHtml(initial)}</span>`;
}

async function initAuth() {
  try {
    const res = await fetch('/auth/me');
    if (res.status === 401) {
      window.location.href = '/login.html';
      return false;
    }
    if (!res.ok) {
      window.location.href = '/login.html';
      return false;
    }
    currentUser = await res.json();

    // Populate user menu in navbar
    const navUser = document.getElementById('nav-user');
    const navAvatar = document.getElementById('nav-avatar');
    const navUserName = document.getElementById('nav-user-name');
    if (navUser) {
      navUser.style.display = 'flex';
      if (navAvatar && currentUser.avatarUrl) {
        navAvatar.src = currentUser.avatarUrl;
        navAvatar.alt = currentUser.name;
      } else if (navAvatar) {
        navAvatar.style.display = 'none';
      }
      if (navUserName) {
        navUserName.textContent = currentUser.name || currentUser.email;
      }
    }

    // Wire up logout button
    const logoutBtn = document.getElementById('nav-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });
    }

    return true;
  } catch {
    window.location.href = '/login.html';
    return false;
  }
}

function renderTasksTabs(activeTab, actionsHtml) {
  return `
    <div class="tasks-page-tabs">
      <div class="tasks-page-tabs-left">
        <a href="#/tasks" class="tasks-page-tab ${activeTab === 'dashboard' ? 'active' : ''}">My Dashboard</a>
        <a href="#/tasks/manage" class="tasks-page-tab ${activeTab === 'manage' ? 'active' : ''}">Manage Tasks</a>
      </div>
      ${actionsHtml ? `<div class="tasks-page-tabs-actions">${actionsHtml}</div>` : ''}
    </div>
  `;
}

function route() {
  const hash = location.hash.slice(1) || '/';
  const app = document.getElementById('app');

  // Stop dashboard refresh when navigating away
  if (Dashboard.refreshTimer) {
    clearInterval(Dashboard.refreshTimer);
    Dashboard.refreshTimer = null;
  }
  if (Tasks.refreshTimer) {
    clearInterval(Tasks.refreshTimer);
    Tasks.refreshTimer = null;
  }
  if (typeof SanityChecks !== 'undefined' && SanityChecks.refreshTimer) {
    clearInterval(SanityChecks.refreshTimer);
    SanityChecks.refreshTimer = null;
  }
  if (typeof Health !== 'undefined' && Health.refreshTimer) {
    clearInterval(Health.refreshTimer);
    Health.refreshTimer = null;
  }
  if (typeof MonitorDetail !== 'undefined' && MonitorDetail._countdownTimer) {
    clearInterval(MonitorDetail._countdownTimer);
    MonitorDetail._countdownTimer = null;
  }
  if (typeof TaskDashboard !== 'undefined' && TaskDashboard.refreshTimer) {
    clearInterval(TaskDashboard.refreshTimer);
    TaskDashboard.refreshTimer = null;
  }
  if (hash === '/sanity-checks') {
    SanityChecks.render(app);
  } else if (hash === '/sanity-checks/add') {
    SanityCheckForm.render(app);
  } else if (hash.match(/^\/sanity-checks\/\d+\/edit$/)) {
    const id = hash.split('/')[2];
    SanityCheckForm.render(app, id);
  } else if (hash.match(/^\/sanity-checks\/\d+$/)) {
    const id = hash.split('/')[2];
    SanityCheckDetail.render(app, id);
  } else if (hash === '/') {
    Dashboard.render(app);
  } else if (hash === '/tasks' || hash === '/tasks/dashboard') {
    TaskDashboard.render(app, 'personal');
  } else if (hash === '/tasks/standup') {
    TaskDashboard.render(app, 'standup');
  } else if (hash === '/tasks/manage/all') {
    Tasks.render(app, 'all');
  } else if (hash === '/tasks/manage/unassigned') {
    Tasks.render(app, 'unassigned');
  } else if (hash === '/tasks/new' || hash.startsWith('/tasks/new?')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    Tasks.renderForm(app, null, params.get('parent'));
  } else if (hash === '/tasks/manage') {
    Tasks.render(app);
  } else if (hash.match(/^\/tasks\/\d+\/edit$/)) {
    const id = hash.split('/')[2];
    Tasks.renderForm(app, id);
  } else if (hash.match(/^\/tasks\/\d+$/)) {
    const id = hash.split('/')[2];
    TaskDetail.render(app, id);
  } else if (hash === '/settings' || hash === '/health') {
    Settings.render(app);
  } else if (hash === '/tasks/ismart-upload') {
    IsmartUpload.render(app);
  } else if (hash === '/upload') {
    BulkUpload.render(app);
  } else if (hash === '/add') {
    MonitorForm.render(app);
  } else if (hash.startsWith('/edit/')) {
    const id = hash.split('/')[2];
    MonitorForm.render(app, id);
  } else {
    const id = hash.slice(1);
    if (/^\d+$/.test(id)) {
      MonitorDetail.render(app, id);
    } else {
      Dashboard.render(app);
    }
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  const authed = await initAuth();
  if (authed) {
    // Load avatar map once for the entire session
    try {
      avatarMap = await API.get('/tasks/users/avatars');
    } catch (e) {
      console.warn('Failed to load avatar map:', e.message);
      avatarMap = {};
    }
    route();
  }
});
