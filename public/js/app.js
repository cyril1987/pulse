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

  // Stop auto-refresh timers when navigating away
  if (Dashboard.refreshTimer) {
    clearInterval(Dashboard.refreshTimer);
    Dashboard.refreshTimer = null;
  }
  if (Health.refreshTimer) {
    clearInterval(Health.refreshTimer);
    Health.refreshTimer = null;
  }

  if (hash === '/') {
    Dashboard.render(app);
  } else if (hash === '/health') {
    Health.render(app);
  } else if (hash === '/settings') {
    Settings.render(app);
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
