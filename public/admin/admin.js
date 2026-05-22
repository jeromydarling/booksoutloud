// BooksOutLoud admin — vanilla JS, no build step.

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

// ── View switching ───────────────────────────────────────────────────────
function setActiveView(view) {
  state.view = view;
  els.tabs.forEach(t => t.classList.toggle('is-active', t.dataset.view === view));
  const showSubs = view === 'subscribers';
  els.subView.hidden = !showSubs;
  els.list.hidden = showSubs;
  els.newEventBtn.hidden = showSubs;
  if (showSubs) {
    loadSubscribers();
  } else {
    loadEvents();
  }
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

// Signed-in email (Cloudflare Access)
fetch('/cdn-cgi/access/get-identity')
  .then(r => r.ok ? r.json() : null)
  .then(j => { if (j?.email) els.email.textContent = j.email; })
  .catch(() => {});

loadStats();
setActiveView('inquiries');
