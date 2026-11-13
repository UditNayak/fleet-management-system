// Small DOM helpers. Text is always set with textContent, never innerHTML,
// so data from the API (names, addresses, messages) can't inject HTML.

export const $ = (selector) => document.querySelector(selector);

/**
 * Creates an element: h('td', { className: 'x', onclick }, 'text', childElement)
 * Attributes starting with "on" become event listeners; null/false children are skipped.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'className') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function toast(message, kind = 'info', ms = 5000) {
  const el = h('div', { className: `card toast ${kind}`, role: 'status' }, message);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export function banner(message) {
  const el = $('#banner');
  el.textContent = message ?? '';
  el.hidden = !message;
}

export const formatTime = (iso) =>
  iso ? new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) : '—';

export function timeAgo(iso) {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.max(seconds, 0)} s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return formatTime(iso);
}

export const humanize = (text) => String(text ?? '').replace(/_/g, ' ');

export const formatLatLng = (loc) => (loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : '—');

export function updatedLabel(selector) {
  $(selector).textContent = `Updated ${new Date().toLocaleTimeString()}`;
}
