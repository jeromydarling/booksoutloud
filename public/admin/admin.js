// BooksOutLoud admin — vanilla JS module (loaded with type="module").

import { Editor } from './editor.js';

const PROGRAM_LABELS = {
  'screwtape': 'The Screwtape Letters',
  'father-brown': 'Father Brown',
  'seven-last-words': 'The Seven Last Words',
  'chesterton': 'Chesterton: Paradox and Wonder',
  'flannery': "Flannery O'Connor",
  'conversion': 'Conversion: Augustine',
};

const STATUSES = ['inquiry','quoted','tentative','confirmed','performed','declined','canceled'];
const STATUS_LABELS = {
  inquiry: 'Inquiry', quoted: 'Quoted', tentative: 'Tentative',
  confirmed: 'Confirmed', performed: 'Performed',
  declined: 'Declined', canceled: 'Canceled',
};

const EVENT_VIEWS = new Set(['inquiries','upcoming','history']);

const state = {
  view: 'inquiries',
  search: '',
  events: [],
  subscribers: [],
  subFilter: 'active',
  broadcasts: [],
  activeBroadcastPoll: null,
  recipientCount: 0,
  venues: [],
  ticketedEvents: [],
};

const els = {
  // events
  list: document.getElementById('event-list'),
  newEventBtn: document.getElementById('new-event-btn'),
  newEventDialog: document.getElementById('new-event-dialog'),
  newEventForm: document.getElementById('new-event-form'),
  // subscribers
  subView: document.getElementById('subscribers-view'),
  subList: document.getElementById('subscriber-list'),
  subFilter: document.getElementById('sub-filter'),
  subExport: document.getElementById('sub-export'),
  newSubBtn: document.getElementById('new-sub-btn'),
  newSubDialog: document.getElementById('new-sub-dialog'),
  newSubForm: document.getElementById('new-sub-form'),
  // broadcasts
  broadcastsView: document.getElementById('broadcasts-view'),
  broadcastList: document.getElementById('broadcast-list'),
  newBroadcastBtn: document.getElementById('new-broadcast-btn'),
  composeDialog: document.getElementById('compose-dialog'),
  composeForm: document.getElementById('compose-form'),
  broadcastDetailDialog: document.getElementById('broadcast-detail-dialog'),
  editorHost: document.getElementById('compose-editor-host'),
  // venues
  venuesView: document.getElementById('venues-view'),
  venueList: document.getElementById('venue-list'),
  newVenueBtn: document.getElementById('new-venue-btn'),
  newVenueDialog: document.getElementById('new-venue-dialog'),
  newVenueForm: document.getElementById('new-venue-form'),
  // ticketed events
  ticketsView: document.getElementById('tickets-view'),
  ticketedEventList: document.getElementById('ticketed-event-list'),
  newTicketedEventBtn: document.getElementById('new-ticketed-event-btn'),
  newTicketedEventDialog: document.getElementById('new-ticketed-event-dialog'),
  newTicketedEventForm: document.getElementById('new-ticketed-event-form'),
  doorLinkDialog: document.getElementById('door-link-dialog'),
  // shared
  tabs: document.querySelectorAll('.admin-tab'),
  search: document.getElementById('search'),
  toast: document.getElementById('toast'),
  email: document.getElementById('admin-email'),
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtDate(s) {
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    if (!isNaN(d)) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return s;
}

function fmtTimestamp(s) {
  if (!s) return '';
  const d = new Date(s.includes('T') ? s : s + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function programLabel(key) {
  if (!key) return '';
  return PROGRAM_LABELS[key] || key;
}

function showToast(msg, opts = {}) {
  els.toast.textContent = msg;
  els.toast.classList.toggle('is-error', !!opts.error);
  els.toast.classList.add('is-visible');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.remove('is-visible'), 2400);
}

async function api(path, init) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok || (body && body.ok === false)) {
    throw new Error(body?.message || `Request failed (${res.status})`);
  }
  return body;
}

// ── Stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const stats = await api('/admin/api/stats');
    for (const k of ['inquiries','upcoming','history','subscribers']) {
      const el = document.querySelector(`.count[data-count="${k}"]`);
      if (el) el.textContent = stats[k] || 0;
    }
  } catch (err) {
    console.error(err);
  }
}

// ── Events ───────────────────────────────────────────────────────────────
async function loadEvents() {
  els.list.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  const params = new URLSearchParams({ bucket: state.view });
  if (state.search) params.set('q', state.search);
  try {
    const { events } = await api(`/admin/api/events?${params}`);
    state.events = events;
    renderEvents();
  } catch (err) {
    els.list.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
}

function renderEvents() {
  if (!state.events.length) {
    els.list.innerHTML = `<div class="event-empty muted">No events in this view yet.</div>`;
    return;
  }
  els.list.innerHTML = state.events.map(renderEventRow).join('');
  els.list.querySelectorAll('details.event-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('.status-select').addEventListener('change', e => updateEventField(id, 'status', e.target.value, row));
    row.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('blur', () => {
        const field = input.dataset.field;
        let value = input.value;
        if (field === 'fee_dollars') {
          value = value === '' ? '' : Math.round(parseFloat(value) * 100);
          return updateEventField(id, 'fee_cents', value, row);
        }
        updateEventField(id, field, value, row);
      });
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEvent(id, row));
  });
}

function renderEventRow(e) {
  const dateMain = fmtDate(e.event_date) || '<span class="muted">No date</span>';
  const createdStr = fmtTimestamp(e.created_at).replace(/, \d{4}$/, '');
  const feeDollars = e.fee_cents != null ? (e.fee_cents / 100).toFixed(0) : '';
  const message = e.message ? `<div class="full"><label>Original message</label><div class="message-block">${esc(e.message)}</div></div>` : '';
  return `
    <details class="event-row" data-id="${e.id}">
      <summary>
        <div class="col-date">
          ${dateMain}
          <div class="muted">Logged ${esc(createdStr)}</div>
        </div>
        <div class="col-who">
          <strong>${esc(e.contact_name)}</strong>
          <div class="muted">${esc(e.contact_email)}${e.contact_organization ? ' &middot; ' + esc(e.contact_organization) : ''}</div>
        </div>
        <div class="col-program">${esc(programLabel(e.program)) || '<span class="muted">&mdash;</span>'}</div>
        <div class="col-venue">${esc(e.venue || '')}</div>
        <div>
          <select class="status-select" aria-label="Status">
            ${STATUSES.map(s => `<option value="${s}"${s === e.status ? ' selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </div>
        <div class="chev">&rsaquo;</div>
      </summary>
      <div class="event-detail">
        <label>Date<input data-field="event_date" value="${esc(e.event_date || '')}" /></label>
        <label>Venue<input data-field="venue" value="${esc(e.venue || '')}" /></label>
        <label>Program
          <select data-field="program">
            <option value=""${!e.program ? ' selected' : ''}>&mdash;</option>
            ${Object.entries(PROGRAM_LABELS).map(([k, v]) =>
              `<option value="${k}"${k === e.program ? ' selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>Audience<input data-field="audience" value="${esc(e.audience || '')}" /></label>
        <label>Fee (USD)<input data-field="fee_dollars" type="number" min="0" step="1" value="${feeDollars}" /></label>
        <label>Contact phone<input data-field="contact_phone" value="${esc(e.contact_phone || '')}" /></label>
        <label class="full">Private notes<textarea data-field="notes" rows="3">${esc(e.notes || '')}</textarea></label>
        ${message}
        <div class="row-foot">
          <span class="save-state" data-state>Edits save when you tab out.</span>
          <button type="button" class="btn ghost small" data-action="delete">Delete event</button>
        </div>
      </div>
    </details>
  `;
}

async function updateEventField(id, field, value, row) {
  const stateEl = row.querySelector('[data-state]');
  const original = stateEl.textContent;
  stateEl.textContent = 'Saving…';
  try {
    const payload = { [field]: value === '' ? null : value };
    await api(`/admin/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    stateEl.textContent = 'Saved.';
    if (field === 'status') {
      loadStats();
      const viewStatuses = {
        inquiries: ['inquiry','quoted','tentative'],
        upcoming: ['confirmed'],
        history: ['performed','declined','canceled'],
      }[state.view];
      if (viewStatuses && !viewStatuses.includes(value)) {
        showToast(`Moved to ${STATUS_LABELS[value]}.`);
        return loadEvents();
      }
    }
    setTimeout(() => { if (stateEl.textContent === 'Saved.') stateEl.textContent = original; }, 1800);
  } catch (err) {
    stateEl.textContent = err.message;
    showToast(err.message, { error: true });
  }
}

async function deleteEvent(id, row) {
  if (!confirm('Delete this event? The contact record will be kept.')) return;
  try {
    await api(`/admin/api/events/${id}`, { method: 'DELETE' });
    row.remove();
    showToast('Event deleted.');
    loadStats();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// ── Subscribers ──────────────────────────────────────────────────────────
async function loadSubscribers() {
  els.subList.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  const params = new URLSearchParams({ status: state.subFilter });
  if (state.search) params.set('q', state.search);
  try {
    const { subscribers } = await api(`/admin/api/subscribers?${params}`);
    state.subscribers = subscribers;
    renderSubscribers();
  } catch (err) {
    els.subList.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
  // Keep the CSV export link in sync with the current filter.
  if (els.subExport) {
    const qs = new URLSearchParams({ status: state.subFilter, format: 'csv' });
    els.subExport.href = `/admin/api/subscribers?${qs}`;
  }
}

function renderSubscribers() {
  if (!state.subscribers.length) {
    els.subList.innerHTML = `<div class="event-empty muted">No subscribers in this view yet.</div>`;
    return;
  }
  els.subList.innerHTML = state.subscribers.map(renderSubRow).join('');
  els.subList.querySelectorAll('.sub-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-action="toggle"]').addEventListener('click', () => toggleSubscriber(id, row));
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSubscriber(id, row));
  });
}

function renderSubRow(s) {
  const active = s.status === 'active';
  const toggleLabel = active ? 'Unsubscribe' : 'Reactivate';
  return `
    <div class="sub-row" data-id="${s.id}" data-status="${s.status}">
      <div class="sub-main">
        <strong>${esc(s.email)}</strong>
        <div class="muted">${esc(s.name || '')}${s.name ? ' &middot; ' : ''}joined ${esc(fmtTimestamp(s.created_at))} &middot; source: ${esc(s.source)}</div>
      </div>
      <div class="sub-status">
        <span class="badge ${esc(s.status)}">${esc(s.status)}</span>
      </div>
      <div class="sub-actions">
        <button type="button" class="btn ghost small" data-action="toggle">${toggleLabel}</button>
        <button type="button" class="btn ghost small" data-action="delete" title="Delete row">&times;</button>
      </div>
    </div>
  `;
}

async function toggleSubscriber(id, row) {
  const newStatus = row.dataset.status === 'active' ? 'unsubscribed' : 'active';
  try {
    await api(`/admin/api/subscribers/${id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) });
    showToast(newStatus === 'active' ? 'Reactivated.' : 'Unsubscribed.');
    loadStats();
    loadSubscribers();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function deleteSubscriber(id, row) {
  if (!confirm('Delete this subscriber row? This removes the email from the database entirely.')) return;
  try {
    await api(`/admin/api/subscribers/${id}`, { method: 'DELETE' });
    row.remove();
    showToast('Subscriber deleted.');
    loadStats();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// ── Broadcasts ───────────────────────────────────────────────────────────
async function loadBroadcasts() {
  els.broadcastList.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  try {
    const { broadcasts } = await api('/admin/api/broadcasts');
    state.broadcasts = broadcasts;
    renderBroadcasts();
    // If any are still sending, start polling.
    const sending = broadcasts.find(b => b.status === 'sending' || b.status === 'pending');
    if (sending) startPollingBroadcast(sending.id);
  } catch (err) {
    els.broadcastList.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
}

function renderBroadcasts() {
  if (!state.broadcasts.length) {
    els.broadcastList.innerHTML = `<div class="event-empty muted">No broadcasts sent yet. Click <strong>Compose</strong> to send your first dispatch.</div>`;
    return;
  }
  els.broadcastList.innerHTML = state.broadcasts.map(renderBroadcastRow).join('');
  els.broadcastList.querySelectorAll('.broadcast-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    row.addEventListener('click', e => {
      if (e.target.closest('[data-action="delete"]')) return;
      openBroadcastDetail(id);
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      deleteBroadcast(id, row);
    });
  });
}

function renderBroadcastRow(b) {
  const created = fmtTimestamp(b.created_at);
  const progress = b.total_recipients
    ? `${b.sent_count}/${b.total_recipients}${b.failed_count ? ` (${b.failed_count} failed)` : ''}`
    : '';
  return `
    <div class="broadcast-row" data-id="${b.id}" data-status="${esc(b.status)}">
      <div class="broadcast-main">
        <strong>${esc(b.subject)}</strong>
        <div class="muted">${esc(created)} &middot; ${esc(b.created_by || 'unknown')}${progress ? ' &middot; ' + esc(progress) : ''}</div>
      </div>
      <div class="broadcast-status">
        <span class="badge ${esc(b.status)}">${esc(b.status)}</span>
      </div>
      <div class="broadcast-actions">
        <button type="button" class="btn ghost small" data-action="delete" title="Delete row">&times;</button>
      </div>
    </div>
  `;
}

function startPollingBroadcast(id) {
  stopPollingBroadcast();
  state.activeBroadcastPoll = setInterval(async () => {
    try {
      const { broadcast } = await api(`/admin/api/broadcasts/${id}`);
      // Update the matching row in state.
      const idx = state.broadcasts.findIndex(b => b.id === id);
      if (idx !== -1) {
        state.broadcasts[idx] = {
          ...state.broadcasts[idx],
          status: broadcast.status,
          sent_count: broadcast.sent_count,
          failed_count: broadcast.failed_count,
          total_recipients: broadcast.total_recipients,
          completed_at: broadcast.completed_at,
        };
        renderBroadcasts();
      }
      if (broadcast.status === 'sent' || broadcast.status === 'failed') {
        stopPollingBroadcast();
        showToast(`Broadcast ${broadcast.status} — ${broadcast.sent_count}/${broadcast.total_recipients} delivered.`);
      }
    } catch (err) {
      console.error('poll failed', err);
    }
  }, 2500);
}

function stopPollingBroadcast() {
  if (state.activeBroadcastPoll) {
    clearInterval(state.activeBroadcastPoll);
    state.activeBroadcastPoll = null;
  }
}

async function deleteBroadcast(id, row) {
  if (!confirm('Delete this broadcast record? Emails already sent cannot be recalled.')) return;
  try {
    await api(`/admin/api/broadcasts/${id}`, { method: 'DELETE' });
    row.remove();
    showToast('Broadcast row deleted.');
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function openBroadcastDetail(id) {
  try {
    const { broadcast } = await api(`/admin/api/broadcasts/${id}`);
    const d = els.broadcastDetailDialog;
    d.querySelector('[data-detail-status]').textContent = `Broadcast · ${broadcast.status}`;
    d.querySelector('[data-detail-subject]').textContent = broadcast.subject;
    const meta = [
      `Created ${fmtTimestamp(broadcast.created_at)}`,
      broadcast.completed_at ? `Completed ${fmtTimestamp(broadcast.completed_at)}` : '',
      `${broadcast.sent_count}/${broadcast.total_recipients} delivered`,
      broadcast.failed_count ? `${broadcast.failed_count} failed` : '',
    ].filter(Boolean).join(' · ');
    d.querySelector('[data-detail-meta]').textContent = meta;
    d.querySelector('[data-detail-body]').innerHTML = broadcast.body_html || '';
    const failEl = d.querySelector('[data-detail-failures]');
    if (Array.isArray(broadcast.failures) && broadcast.failures.length) {
      failEl.hidden = false;
      failEl.innerHTML = `<strong>Failures:</strong><br>${broadcast.failures.map(f => `${esc(f.email)} — ${esc(f.error)}`).join('<br>')}`;
    } else {
      failEl.hidden = true;
    }
    d.showModal();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// ── Composer ─────────────────────────────────────────────────────────────
async function refreshRecipientCount() {
  try {
    const stats = await api('/admin/api/stats');
    state.recipientCount = stats.subscribers || 0;
    const el = els.composeDialog.querySelector('[data-recipient-count]');
    if (el) el.textContent = state.recipientCount
      ? `Sending to ${state.recipientCount} active subscriber${state.recipientCount === 1 ? '' : 's'}.`
      : 'No active subscribers yet — only the test send is available.';
  } catch {/* swallow */}
}

let composeEditor = null;
function ensureEditor() {
  if (composeEditor) return composeEditor;
  composeEditor = new Editor(els.editorHost, {
    placeholder: 'Write your dispatch. Highlight text to add a link (Ctrl/Cmd+K).',
    onChange: () => {
      const html = composeEditor.getHTML();
      const char = els.composeForm.querySelector('[data-char]');
      if (char) char.textContent = `${html.replace(/<[^>]+>/g, '').length.toLocaleString()} chars`;
      // Show the editor's own HTML in the preview immediately, then fetch the
      // server-styled version after a short debounce.
      const preview = els.composeForm.querySelector('[data-preview]');
      if (preview) preview.innerHTML = html;
      const src = els.composeForm.querySelector('[data-preview-source]');
      if (src) src.textContent = 'local';
    },
  });
  return composeEditor;
}

async function fetchServerPreview() {
  if (!composeEditor) return;
  try {
    const body_html = composeEditor.getHTML();
    const { html } = await api('/admin/api/broadcasts/preview', {
      method: 'POST', body: JSON.stringify({ body_html }),
    });
    els.composeForm.querySelector('[data-preview]').innerHTML = html;
    const src = els.composeForm.querySelector('[data-preview-source]');
    if (src) src.textContent = 'verified';
  } catch {/* keep local */}
}

async function submitBroadcast(mode) {
  const fd = new FormData(els.composeForm);
  const subject = (fd.get('subject') || '').toString().trim();
  const body_html = composeEditor ? composeEditor.getHTML() : '';
  const payload = { subject, body_html, mode };

  if (!subject) { showToast('Subject is required.', { error: true }); return; }
  if (composeEditor && composeEditor.isEmpty()) { showToast('Body is required.', { error: true }); return; }

  if (mode === 'broadcast') {
    if (!confirm(`Send to ${state.recipientCount} subscriber${state.recipientCount === 1 ? '' : 's'}? This cannot be undone.`)) return;
  }

  const buttons = els.composeForm.querySelectorAll('button');
  buttons.forEach(b => b.disabled = true);
  try {
    const res = await api('/admin/api/broadcasts', { method: 'POST', body: JSON.stringify(payload) });
    if (mode === 'test') {
      showToast(res.message || 'Test sent.');
    } else {
      els.composeDialog.close();
      els.composeForm.reset();
      if (composeEditor) composeEditor.reset();
      const preview = els.composeForm.querySelector('[data-preview]');
      if (preview) preview.innerHTML = '';
      showToast(`Sending to ${res.total} subscribers…`);
      await loadBroadcasts();
      startPollingBroadcast(res.broadcastId);
    }
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    buttons.forEach(b => b.disabled = false);
  }
}

// ── Venues ───────────────────────────────────────────────────────────────
function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

async function loadVenues() {
  els.venueList.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  try {
    const { venues } = await api(`/admin/api/venues?${params}`);
    state.venues = venues;
    renderVenues();
  } catch (err) {
    els.venueList.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
}

function venueStatusBadge(v) {
  const label = v.stripe_status;
  return `<span class="badge venue-${esc(label)}">${esc(label)}</span>`;
}

function renderVenues() {
  if (!state.venues?.length) {
    els.venueList.innerHTML = `<div class="event-empty muted">No venues yet. Click <strong>Add venue</strong> to get started.</div>`;
    return;
  }
  els.venueList.innerHTML = state.venues.map(v => `
    <div class="broadcast-row" data-id="${v.id}">
      <div class="broadcast-main">
        <strong>${esc(v.name)}</strong>
        <div class="muted">${esc(v.email)}${v.contact_name ? ' · ' + esc(v.contact_name) : ''} · split ${esc(v.default_split_pct)}% · ${esc(v.event_count || 0)} event${v.event_count === 1 ? '' : 's'}</div>
        ${v.stripe_account_id ? `<div class="muted small" style="font-family:monospace;">${esc(v.stripe_account_id)}</div>` : ''}
      </div>
      <div class="broadcast-status">${venueStatusBadge(v)}</div>
      <div class="broadcast-actions" style="display:flex; gap:6px;">
        <button type="button" class="btn ghost small" data-action="onboard">${v.stripe_account_id ? 'Resend link' : 'Onboard'}</button>
        ${v.stripe_account_id ? `<button type="button" class="btn ghost small" data-action="refresh">Refresh</button>` : ''}
      </div>
    </div>
  `).join('');
  els.venueList.querySelectorAll('.broadcast-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('[data-action="onboard"]').addEventListener('click', () => onboardVenue(id));
    const refresh = row.querySelector('[data-action="refresh"]');
    if (refresh) refresh.addEventListener('click', () => refreshVenue(id));
  });
}

async function onboardVenue(id) {
  try {
    const res = await api(`/admin/api/venues/${id}/onboard`, { method: 'POST' });
    if (!res.url) throw new Error('No onboarding URL returned.');
    if (confirm(`Open the Stripe onboarding flow now?\n\nYou can also send this link to the venue:\n${res.url}`)) {
      window.open(res.url, '_blank', 'noopener');
    }
    await navigator.clipboard?.writeText(res.url).catch(() => {});
    showToast('Onboarding link copied to clipboard.');
    loadVenues();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

async function refreshVenue(id) {
  try {
    const res = await api(`/admin/api/venues/${id}/refresh`, { method: 'POST' });
    showToast(`Stripe says: ${res.status}.`);
    loadVenues();
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// ── Ticketed events ──────────────────────────────────────────────────────
async function loadTicketedEvents() {
  els.ticketedEventList.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  try {
    const { events } = await api('/admin/api/ticketed-events');
    state.ticketedEvents = events;
    renderTicketedEvents();
  } catch (err) {
    els.ticketedEventList.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
}

function renderTicketedEvents() {
  if (!state.ticketedEvents?.length) {
    els.ticketedEventList.innerHTML = `<div class="event-empty muted">No ticketed events yet. Add a venue first, then create one here.</div>`;
    return;
  }
  els.ticketedEventList.innerHTML = state.ticketedEvents.map(e => {
    const when = fmtTimestamp(e.starts_at);
    const sold = e.tickets_sold || 0;
    const gross = money(e.gross_cents || 0, e.currency);
    return `
      <div class="broadcast-row" data-id="${e.id}">
        <div class="broadcast-main">
          <strong>${esc(e.title)}</strong>
          <div class="muted">${esc(when)} · ${esc(e.venue_name)} · ${esc(sold)} ticket${sold === 1 ? '' : 's'} sold · ${esc(gross)}</div>
        </div>
        <div class="broadcast-status"><span class="badge ${esc(e.status)}">${esc(e.status)}</span></div>
        <div class="broadcast-actions" style="display:flex; gap:6px; flex-wrap:wrap;">
          <a class="btn ghost small" href="/tickets/${esc(e.slug)}" target="_blank" rel="noopener">Public page</a>
          <a class="btn ghost small" href="/admin/checkin/${esc(e.id)}">Door</a>
          <button type="button" class="btn ghost small" data-action="door-link">Volunteer link</button>
        </div>
      </div>
    `;
  }).join('');
  els.ticketedEventList.querySelectorAll('[data-action="door-link"]').forEach(btn => {
    const row = btn.closest('.broadcast-row');
    const id = parseInt(row.dataset.id, 10);
    btn.addEventListener('click', () => openDoorLinkDialog(id));
  });
}

async function openDoorLinkDialog(id) {
  const dlg = els.doorLinkDialog;
  if (!dlg) return;
  const urlEl    = dlg.querySelector('[data-door-url]');
  const emptyEl  = dlg.querySelector('[data-door-empty]');
  const rotateBtn = dlg.querySelector('[data-action="rotate"]');
  const revokeBtn = dlg.querySelector('[data-action="revoke"]');
  const copyBtn   = dlg.querySelector('[data-action="copy"]');

  async function refresh() {
    try {
      const res = await api(`/admin/api/ticketed-events/${id}/door-token`);
      if (res.url) {
        urlEl.textContent = res.url;
        urlEl.dataset.url = res.url;
        urlEl.hidden = false;
        emptyEl.hidden = true;
        copyBtn.disabled = false;
        revokeBtn.disabled = false;
        rotateBtn.textContent = 'Regenerate';
      } else {
        urlEl.textContent = '';
        delete urlEl.dataset.url;
        urlEl.hidden = true;
        emptyEl.hidden = false;
        copyBtn.disabled = true;
        revokeBtn.disabled = true;
        rotateBtn.textContent = 'Mint link';
      }
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  rotateBtn.onclick = async () => {
    try {
      const res = await api(`/admin/api/ticketed-events/${id}/door-token`, { method: 'POST' });
      showToast('Volunteer link minted.');
      urlEl.textContent = res.url;
      urlEl.dataset.url = res.url;
      urlEl.hidden = false;
      emptyEl.hidden = true;
      copyBtn.disabled = false;
      revokeBtn.disabled = false;
      rotateBtn.textContent = 'Regenerate';
      await copyToClipboard(res.url);
    } catch (err) {
      showToast(err.message, { error: true });
    }
  };

  revokeBtn.onclick = async () => {
    if (!confirm('Revoke this link? Volunteers using it will lose access immediately.')) return;
    try {
      await api(`/admin/api/ticketed-events/${id}/door-token`, { method: 'DELETE' });
      showToast('Link revoked.');
      refresh();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  };

  copyBtn.onclick = async () => {
    const url = urlEl.dataset.url;
    if (!url) return;
    await copyToClipboard(url);
  };

  await refresh();
  dlg.showModal();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard.');
  } catch {
    showToast('Copy unsupported — select the URL manually.', { error: true });
  }
}

// ── View switching ───────────────────────────────────────────────────────
function setActiveView(view) {
  state.view = view;
  els.tabs.forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
  const isSubs       = view === 'subscribers';
  const isBroadcasts = view === 'broadcasts';
  const isVenues     = view === 'venues';
  const isTickets    = view === 'tickets';
  const isEvents     = !isSubs && !isBroadcasts && !isVenues && !isTickets;
  els.subView.hidden        = !isSubs;
  els.broadcastsView.hidden = !isBroadcasts;
  if (els.venuesView)  els.venuesView.hidden  = !isVenues;
  if (els.ticketsView) els.ticketsView.hidden = !isTickets;
  els.list.hidden           = !isEvents;
  els.newEventBtn.hidden    = !isEvents;
  if (isSubs)            loadSubscribers();
  else if (isBroadcasts) loadBroadcasts();
  else if (isVenues)     loadVenues();
  else if (isTickets)    loadTicketedEvents();
  else                   loadEvents();
}

// ── Wiring ───────────────────────────────────────────────────────────────
els.tabs.forEach(t => {
  t.addEventListener('click', () => setActiveView(t.dataset.view));
});

let searchTimer;
els.search.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    if (state.view === 'subscribers') loadSubscribers();
    else if (state.view === 'venues') loadVenues();
    else if (state.view === 'broadcasts' || state.view === 'tickets') {/* search no-op for these */}
    else loadEvents();
  }, 220);
});

if (els.subFilter) {
  els.subFilter.addEventListener('change', () => {
    state.subFilter = els.subFilter.value;
    loadSubscribers();
  });
}

// New event dialog
els.newEventBtn.addEventListener('click', () => els.newEventDialog.showModal());
els.newEventDialog.querySelector('[data-close]').addEventListener('click', () => els.newEventDialog.close());
els.newEventForm.addEventListener('submit', async e => {
  if (e.submitter && e.submitter.hasAttribute('data-close')) return;
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(els.newEventForm));
  const feeDollars = parseFloat(payload.fee_dollars);
  if (Number.isFinite(feeDollars)) payload.fee_cents = Math.round(feeDollars * 100);
  delete payload.fee_dollars;
  try {
    await api('/admin/api/events', { method: 'POST', body: JSON.stringify(payload) });
    els.newEventDialog.close();
    els.newEventForm.reset();
    showToast('Event saved.');
    loadStats();
    loadEvents();
  } catch (err) {
    showToast(err.message, { error: true });
  }
});

// New subscriber dialog
if (els.newSubBtn && els.newSubDialog && els.newSubForm) {
  els.newSubBtn.addEventListener('click', () => els.newSubDialog.showModal());
  els.newSubDialog.querySelector('[data-close]').addEventListener('click', () => els.newSubDialog.close());
  els.newSubForm.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.hasAttribute('data-close')) return;
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(els.newSubForm));
    try {
      await api('/admin/api/subscribers', { method: 'POST', body: JSON.stringify(payload) });
      els.newSubDialog.close();
      els.newSubForm.reset();
      showToast('Subscriber added.');
      loadStats();
      loadSubscribers();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// Broadcast composer
if (els.newBroadcastBtn && els.composeDialog && els.composeForm && els.editorHost) {
  const subjectInput = els.composeForm.elements.subject;
  let previewTimer;

  els.newBroadcastBtn.addEventListener('click', () => {
    refreshRecipientCount();
    ensureEditor();
    els.composeDialog.showModal();
    subjectInput.focus();
  });
  els.composeDialog.querySelector('[data-close]').addEventListener('click', () => els.composeDialog.close());

  // Debounce a server-side preview after every editor change.
  els.editorHost.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(fetchServerPreview, 500);
  });

  els.composeForm.querySelector('[data-action="send-test"]').addEventListener('click', () => submitBroadcast('test'));
  els.composeForm.querySelector('[data-action="send-all"]').addEventListener('click', () => submitBroadcast('broadcast'));

  els.composeForm.addEventListener('submit', e => e.preventDefault());
}

// Broadcast detail dialog close
if (els.broadcastDetailDialog) {
  els.broadcastDetailDialog.querySelector('[data-close]').addEventListener('click', () => els.broadcastDetailDialog.close());
}

// New venue dialog
if (els.newVenueBtn && els.newVenueDialog && els.newVenueForm) {
  els.newVenueBtn.addEventListener('click', () => els.newVenueDialog.showModal());
  els.newVenueDialog.querySelector('[data-close]').addEventListener('click', () => els.newVenueDialog.close());
  els.newVenueForm.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.hasAttribute('data-close')) return;
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(els.newVenueForm));
    try {
      await api('/admin/api/venues', { method: 'POST', body: JSON.stringify(payload) });
      els.newVenueDialog.close();
      els.newVenueForm.reset();
      showToast('Venue added. Click "Onboard" to send the Stripe link.');
      loadVenues();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// New ticketed event dialog
if (els.newTicketedEventBtn && els.newTicketedEventDialog && els.newTicketedEventForm) {
  const form = els.newTicketedEventForm;
  const tierRows = form.querySelector('[data-tier-rows]');

  function addTierRow(initial = {}) {
    const row = document.createElement('div');
    row.className = 'tier-row';
    row.innerHTML = `
      <input data-tier-name placeholder="Tier name (e.g. General)" value="${esc(initial.name || '')}" />
      <input data-tier-price type="number" min="0" step="0.01" placeholder="Price USD" value="${initial.price ?? ''}" />
      <input data-tier-cap type="number" min="0" placeholder="Cap (opt)" value="${initial.capacity || ''}" />
      <button type="button" data-remove>&times;</button>
    `;
    row.querySelector('[data-remove]').addEventListener('click', () => row.remove());
    tierRows.appendChild(row);
  }

  els.newTicketedEventBtn.addEventListener('click', async () => {
    // Populate venue dropdown with enabled venues.
    try {
      const { venues } = await api('/admin/api/venues');
      const select = form.querySelector('[data-venue-select]');
      select.innerHTML = `<option value="">— Choose —</option>` + (venues || []).map(v =>
        `<option value="${v.id}"${v.stripe_status !== 'enabled' ? ' disabled' : ''}>${esc(v.name)}${v.stripe_status !== 'enabled' ? ` (${v.stripe_status})` : ''}</option>`
      ).join('');
    } catch {/* ignore */}
    tierRows.innerHTML = '';
    addTierRow({ name: 'General admission', price: 20 });
    els.newTicketedEventDialog.showModal();
  });

  form.querySelector('[data-action="add-tier"]').addEventListener('click', () => addTierRow());
  els.newTicketedEventDialog.querySelector('[data-close]').addEventListener('click', () => els.newTicketedEventDialog.close());

  form.addEventListener('submit', async e => {
    if (e.submitter && e.submitter.hasAttribute('data-close')) return;
    e.preventDefault();
    const fd = new FormData(form);
    const payload = Object.fromEntries(fd);
    payload.tiers = [...tierRows.querySelectorAll('.tier-row')].map(r => ({
      name: r.querySelector('[data-tier-name]').value.trim(),
      price_cents: Math.round((parseFloat(r.querySelector('[data-tier-price]').value) || 0) * 100),
      capacity: parseInt(r.querySelector('[data-tier-cap]').value, 10) || null,
    })).filter(t => t.name);
    try {
      const res = await api('/admin/api/ticketed-events', { method: 'POST', body: JSON.stringify(payload) });
      els.newTicketedEventDialog.close();
      form.reset();
      showToast(`Created. Public URL: /tickets/${res.slug}`);
      loadTicketedEvents();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

// Signed-in email (Cloudflare Access)
fetch('/cdn-cgi/access/get-identity')
  .then(r => r.ok ? r.json() : null)
  .then(j => { if (j?.email) els.email.textContent = j.email; })
  .catch(() => {});

loadStats();
setActiveView('inquiries');
