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

const state = {
  bucket: 'inquiries',
  search: '',
  events: [],
};

const els = {
  list: document.getElementById('event-list'),
  tabs: document.querySelectorAll('.admin-tab'),
  search: document.getElementById('search'),
  newBtn: document.getElementById('new-event-btn'),
  dialog: document.getElementById('new-event-dialog'),
  form: document.getElementById('new-event-form'),
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
  // ISO YYYY-MM-DD → "Mar 13, 2026"
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`);
    if (!isNaN(d)) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return s;
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

async function loadStats() {
  try {
    const stats = await api('/admin/api/stats');
    for (const [k, v] of Object.entries({ inquiries: stats.inquiries, upcoming: stats.upcoming, history: stats.history })) {
      const el = document.querySelector(`.count[data-count="${k}"]`);
      if (el) el.textContent = v || 0;
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadEvents() {
  els.list.innerHTML = `<div class="event-empty muted">Loading&hellip;</div>`;
  const params = new URLSearchParams({ bucket: state.bucket });
  if (state.search) params.set('q', state.search);
  try {
    const { events } = await api(`/admin/api/events?${params}`);
    state.events = events;
    render();
  } catch (err) {
    els.list.innerHTML = `<div class="event-empty muted">${esc(err.message)}</div>`;
  }
}

function render() {
  if (!state.events.length) {
    els.list.innerHTML = `<div class="event-empty muted">No events in this view yet.</div>`;
    return;
  }
  els.list.innerHTML = state.events.map(renderRow).join('');
  // Wire status dropdowns + form actions
  els.list.querySelectorAll('details.event-row').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    row.querySelector('.status-select').addEventListener('change', e => updateField(id, 'status', e.target.value, row));
    row.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('blur', () => {
        const field = input.dataset.field;
        let value = input.value;
        if (field === 'fee_dollars') {
          value = value === '' ? '' : Math.round(parseFloat(value) * 100);
          return updateField(id, 'fee_cents', value, row);
        }
        updateField(id, field, value, row);
      });
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEvent(id, row));
  });
}

function renderRow(e) {
  const dateMain = fmtDate(e.event_date) || '<span class="muted">No date</span>';
  const created = new Date(e.created_at + 'Z');
  const createdStr = isNaN(created) ? e.created_at : created.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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

async function updateField(id, field, value, row) {
  const stateEl = row.querySelector('[data-state]');
  const original = stateEl.textContent;
  stateEl.textContent = 'Saving…';
  try {
    const payload = { [field]: value === '' ? null : value };
    await api(`/admin/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    stateEl.textContent = 'Saved.';
    if (field === 'status') {
      loadStats();
      // If the new status no longer belongs in this bucket, reload the list.
      const bucketStatuses = {
        inquiries: ['inquiry','quoted','tentative'],
        upcoming: ['confirmed'],
        history: ['performed','declined','canceled'],
      }[state.bucket];
      if (!bucketStatuses.includes(value)) {
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

// Tab + search wiring
els.tabs.forEach(t => {
  t.addEventListener('click', () => {
    els.tabs.forEach(x => x.classList.remove('is-active'));
    t.classList.add('is-active');
    state.bucket = t.dataset.bucket;
    loadEvents();
  });
});
let searchTimer;
els.search.addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    loadEvents();
  }, 220);
});

// New event dialog
els.newBtn.addEventListener('click', () => els.dialog.showModal());
els.dialog.querySelector('[data-close]').addEventListener('click', () => els.dialog.close());
els.form.addEventListener('submit', async e => {
  if (e.submitter && e.submitter.hasAttribute('data-close')) return;
  e.preventDefault();
  const fd = new FormData(els.form);
  const payload = Object.fromEntries(fd);
  const feeDollars = parseFloat(payload.fee_dollars);
  if (Number.isFinite(feeDollars)) payload.fee_cents = Math.round(feeDollars * 100);
  delete payload.fee_dollars;
  try {
    await api('/admin/api/events', { method: 'POST', body: JSON.stringify(payload) });
    els.dialog.close();
    els.form.reset();
    showToast('Event saved.');
    loadStats();
    loadEvents();
  } catch (err) {
    showToast(err.message, { error: true });
  }
});

// Surface the signed-in email if Access provided it as a cookie / header echo.
// (Cloudflare sets the JWT cookie; the email itself isn't exposed to the
// browser, so we just leave this area blank if we can't detect it.)
fetch('/cdn-cgi/access/get-identity')
  .then(r => r.ok ? r.json() : null)
  .then(j => { if (j?.email) els.email.textContent = j.email; })
  .catch(() => {});

loadStats();
loadEvents();
