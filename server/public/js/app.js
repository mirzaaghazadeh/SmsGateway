import { h, s, clear, icon, api, setUnauthorizedHandler, poll, busy } from './ui.js';
import overview from './pages/overview.js';
import messages from './pages/messages.js';
import calls from './pages/calls.js';
import signal from './pages/signal.js';
import analytics from './pages/analytics.js';
import device from './pages/device.js';
import settings from './pages/settings.js';

const ROUTES = [
  { path: '/', title: 'Overview', icon: 'overview', page: overview },
  { path: '/messages', title: 'Messages', icon: 'messages', page: messages },
  { path: '/calls', title: 'Missed calls', icon: 'calls', page: calls },
  { path: '/signal', title: 'Signal', icon: 'signal', page: signal },
  { path: '/analytics', title: 'Analytics', icon: 'analytics', page: analytics },
  { path: '/device', title: 'Device', icon: 'device', page: device },
  { path: '/settings', title: 'Settings', icon: 'settings', page: settings },
];

const root = document.getElementById('app');
let cleanup = null;
let stopRail = null;
let main, nav, railStatus;

export function brandMark() {
  return s('svg', { class: 'brand-mark', viewBox: '0 0 26 32', 'aria-hidden': 'true' },
    s('path', { d: 'M3 1.5h14l7.5 7.5v20a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 29V3A1.5 1.5 0 0 1 3 1.5z', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }),
    s('path', { d: 'M7 24v-3M11 24v-6M15 24v-9M19 24v-12', stroke: '#3fcf9f', 'stroke-width': 2.2, 'stroke-linecap': 'round' })
  );
}

function navigate(path) {
  if (location.pathname + location.search !== path) history.pushState({}, '', path);
  route();
}

function route() {
  if (!main) return;
  const r = ROUTES.find((x) => x.path === location.pathname) || ROUTES[0];
  for (const a of nav.querySelectorAll('a')) {
    if (a.getAttribute('href') === r.path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${r.title} · SMS Gateway`;
  cleanup?.();
  const page = h('div', { class: 'page' });
  clear(main, page);
  cleanup = r.page(page, { navigate, params: new URLSearchParams(location.search) }) || null;
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function shell() {
  nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
    ROUTES.map((r) => h('a', { href: r.path }, icon(r.icon), r.title))
  );
  railStatus = h('div', { class: 'rail-status' }, h('span', { class: 'dot' }), 'Checking gateway…');
  main = h('main', { class: 'main', tabindex: '-1' });
  clear(root,
    h('div', { class: 'shell' },
      h('aside', { class: 'rail' },
        h('a', { class: 'brand', href: '/' }, brandMark(), h('div', {}, h('b', {}, 'SMS Gateway'), h('span', {}, 'Control panel'))),
        nav,
        h('div', { class: 'rail-foot' },
          railStatus,
          h('button', { type: 'button', onclick: logout }, icon('logout'), 'Log out')
        )
      ),
      main
    )
  );
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  stopRail?.();
  stopRail = poll(async () => {
    const devices = await api('/api/devices');
    const on = devices.filter((d) => d.online).length;
    const ready = devices.flatMap((d) => (d.online ? d.sims : [])).filter((x) => x.ready).length;
    clear(railStatus,
      h('span', { class: `dot ${on ? 'ok' : devices.length ? 'bad' : ''}` }),
      !devices.length ? 'No gateway yet' : on ? `Online · ${ready} SIM${ready === 1 ? '' : 's'} ready` : 'Gateway offline'
    );
  }, 10_000);
  route();
}

function login(message) {
  stopRail?.();
  cleanup?.();
  main = null;
  const pw = h('input', { class: 'input', type: 'password', id: 'pw', autocomplete: 'current-password', required: true, autofocus: true });
  const err = h('p', { class: 'error-text', role: 'alert' }, message || '');
  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Log in');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      await busy(btn, async () => {
        try {
          await api('/api/auth/login', { method: 'POST', body: { password: pw.value } });
          shell();
        } catch (ex) {
          err.textContent = ex.message;
          pw.select();
        }
      });
    },
  },
    h('div', { class: 'brand' }, brandMark(), h('div', {}, h('b', {}, 'SMS Gateway'), h('span', {}, 'Control panel'))),
    h('div', { class: 'field' }, h('label', { for: 'pw' }, 'Password'), pw,
      h('p', { class: 'hint' }, 'The ADMIN_PASSWORD you set on the server.')),
    err,
    btn
  );
  clear(root, h('div', { class: 'login' }, form));
  pw.focus();
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  login();
}

setUnauthorizedHandler(() => {
  if (main) login('Your session ended. Please log in again.');
});
window.addEventListener('popstate', route);

(async () => {
  try {
    const me = await api('/api/auth/me');
    me.loggedIn ? shell() : login();
  } catch (e) {
    clear(root, h('div', { class: 'login' }, h('p', { style: { color: '#fff' } }, e.message)));
  }
})();
