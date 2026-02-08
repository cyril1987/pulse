function route() {
  const hash = location.hash.slice(1) || '/';
  const app = document.getElementById('app');

  // Stop dashboard refresh when navigating away
  if (Dashboard.refreshTimer) {
    clearInterval(Dashboard.refreshTimer);
    Dashboard.refreshTimer = null;
  }

  if (hash === '/') {
    Dashboard.render(app);
  } else if (hash === '/settings') {
    Settings.render(app);
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
window.addEventListener('DOMContentLoaded', route);
