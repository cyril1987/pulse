let currentUser = null;

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
  } else if (hash === '/tasks/all') {
    Tasks.render(app, 'all');
  } else if (hash === '/tasks/unassigned') {
    Tasks.render(app, 'unassigned');
  } else if (hash === '/tasks/new' || hash.startsWith('/tasks/new?')) {
    const params = new URLSearchParams(hash.split('?')[1] || '');
    Tasks.renderForm(app, null, params.get('parent'));
  } else if (hash === '/tasks') {
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
  if (authed) route();
});
