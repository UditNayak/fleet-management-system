import { session, events } from './api.js';
import { initLogin, showLogin } from './auth.js';
import { createMapPage } from './map.js';
import { createSmsPage } from './sms.js';
import { createAlertsPage } from './alerts.js';
import { $, banner, toast, humanize } from './ui.js';

const REFRESH_MS = 15000;
const MANAGERS = ['admin', 'fleet_manager'];

let pages = {};
let currentTab = 'map';
let timer = null;

// ---------- polling (only while the tab is visible) ----------
async function refreshCurrent() {
  try {
    await pages[currentTab]?.refresh();
    banner(null);
  } catch (err) {
    if (err.status === 429) {
      banner(`Rate limit reached for this API key. Retry in ${err.retryAfter ?? '?'} s.`);
    } else if (err.status !== 401) {
      toast(err.message, 'error');
    }
  }
}

function startPolling() {
  stopPolling();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshCurrent();
  }, REFRESH_MS);
}

function stopPolling() {
  clearInterval(timer);
  timer = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timer) refreshCurrent();
});

// ---------- tabs ----------
function showTab(name) {
  currentTab = name;
  document
    .querySelectorAll('#tabs button')
    .forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((section) => {
    section.hidden = section.id !== `tab-${name}`;
  });
  pages[name].activate();
  refreshCurrent();
}

// ---------- session ----------
function startApp() {
  const { user } = session.get();
  const canManage = MANAGERS.includes(user.role);

  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-name').textContent = user.name;
  $('#user-role').textContent = humanize(user.role);

  // Hide tabs this role can't use
  document.querySelectorAll('#tabs button').forEach((button) => {
    const roles = button.dataset.roles?.split(' ');
    button.hidden = Boolean(roles && !roles.includes(user.role));
  });

  pages = {
    map: createMapPage({ canManage }),
    ...(canManage && {
      sms: createSmsPage(),
      alerts: createAlertsPage({
        showOnMap: (location) => {
          showTab('map');
          pages.map.focus(location);
        },
      }),
    }),
  };

  showTab('map');
  startPolling();
}

function logout(message) {
  stopPolling();
  session.clear();
  // Reload for a clean state
  try {
    if (message) sessionStorage.setItem('fleet-logout-message', message);
  } catch {
    // storage blocked: the message is simply not shown
  }
  window.location.reload();
}

events.onUnauthorized = () => logout('Your session expired, please sign in again.');
events.onRateLimit = ({ remaining, limit }) => {
  $('#rate-limit').textContent = `API: ${remaining}${limit ? ` / ${limit}` : ''} left`;
};

document
  .querySelectorAll('#tabs button')
  .forEach((button) => button.addEventListener('click', () => showTab(button.dataset.tab)));
$('#logout').addEventListener('click', () => logout());

initLogin(startApp);

if (session.get()?.token) {
  startApp();
} else {
  let message = null;
  try {
    message = sessionStorage.getItem('fleet-logout-message');
    sessionStorage.removeItem('fleet-logout-message');
  } catch {
    // storage blocked
  }
  showLogin(message);
}
