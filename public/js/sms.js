import { api } from './api.js';
import { $, h, formatTime, humanize, updatedLabel } from './ui.js';

const PAGE_SIZE = 15;

// The SMS Log tab: delivery stats + a filterable, paginated table of every SMS
export function createSmsPage() {
  let page = 1;
  let total = 0;

  const stat = (label, value, className = '') =>
    h(
      'div',
      { className: `card stat ${className}` },
      h('span', { className: 'muted' }, label),
      h('strong', {}, value),
    );

  async function loadStats() {
    const stats = await api('/api/notifications/stats');
    $('#sms-stats').replaceChildren(
      stat('Total SMS', stats.total),
      stat('Sent', stats.byStatus.sent ?? 0, 'sent'),
      stat('Failed', stats.byStatus.failed ?? 0, 'failed'),
      stat('Status changes', stats.byType.status_change ?? 0),
      stat('Critical alerts', stats.byType.critical_event ?? 0),
    );
  }

  function row(n) {
    return h(
      'tr',
      {},
      h('td', {}, formatTime(n.sentAt ?? n.createdAt)),
      h(
        'td',
        {},
        h(
          'span',
          { className: `badge ${n.type === 'critical_event' ? 'alert' : ''}` },
          humanize(n.type),
        ),
      ),
      h('td', {}, n.vehicleRegistration ?? '—'),
      h(
        'td',
        {},
        humanize(n.recipientRole),
        h('br'),
        h('span', { className: 'muted' }, n.recipientPhone),
      ),
      h('td', { className: 'message' }, n.message),
      h(
        'td',
        {},
        h('span', { className: `badge ${n.status}`, title: n.error ?? '' }, n.status),
        n.error ? h('div', { className: 'muted' }, n.error) : null,
      ),
    );
  }

  async function loadList() {
    const result = await api('/api/notifications', {
      query: { page, limit: PAGE_SIZE, status: $('#sms-status').value, type: $('#sms-type').value },
    });
    total = result.total;
    $('#sms-rows').replaceChildren(
      ...(result.data.length
        ? result.data.map(row)
        : [h('tr', {}, h('td', { colspan: 6, className: 'empty' }, 'No SMS yet'))]),
    );
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    $('#sms-page').textContent = `Page ${page} of ${pages} · ${total} SMS`;
    $('#sms-prev').disabled = page <= 1;
    $('#sms-next').disabled = page >= pages;
  }

  async function refresh() {
    await Promise.all([loadStats(), loadList()]);
    updatedLabel('#sms-updated');
  }

  const reload = () => refresh().catch(() => {});
  ['#sms-status', '#sms-type'].forEach((id) =>
    $(id).addEventListener('change', () => {
      page = 1;
      reload();
    }),
  );
  $('#sms-prev').addEventListener('click', () => {
    page -= 1;
    reload();
  });
  $('#sms-next').addEventListener('click', () => {
    page += 1;
    reload();
  });
  $('#sms-refresh').addEventListener('click', reload);

  return { refresh, activate: () => {} };
}
