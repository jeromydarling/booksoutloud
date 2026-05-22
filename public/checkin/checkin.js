// Door check-in client. Mounted on two surfaces:
//   /admin/checkin/<id>            apiBase = /admin/api/checkin
//   /door/<id>/<token>             apiBase = /api/door/<id>/<token>
//
// Reads <body data-event-id="..." data-api-base="...">. Derives roster +
// per-code URLs from apiBase, supports offline operation by caching the
// roster in localStorage and queueing check-ins while the network is gone.

(function () {
  const eventId  = parseInt(document.body.dataset.eventId, 10);
  const apiBase  = document.body.dataset.apiBase;
  if (!Number.isInteger(eventId) || !apiBase) return;

  const apiContainsEvent = apiBase.endsWith(`/${eventId}`);
  const rosterUrl = (full = false) => {
    const base = apiContainsEvent ? apiBase : `${apiBase}/${eventId}`;
    return full ? `${base}?full=1` : base;
  };
  const codeUrl = (code) => apiContainsEvent
    ? `${apiBase}/${encodeURIComponent(code)}`
    : `${apiBase}/${eventId}/${encodeURIComponent(code)}`;

  const ROSTER_KEY  = `door:roster:${eventId}`;
  const PENDING_KEY = `door:pending:${eventId}`;

  const els = {
    form:   document.getElementById('checkin-form'),
    input:  document.getElementById('code'),
    result: document.getElementById('result'),
    recent: document.getElementById('recent'),
    counts: document.querySelectorAll('[data-count]'),
    undo:   document.querySelector('[data-action="undo"]'),
    netPill: document.getElementById('net-pill'),
  };
  let lastCode = null;
  let lastWasTentative = false;

  // ── helpers ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso + (iso.includes('Z') ? '' : 'Z'));
    if (isNaN(d)) return iso;
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function setCount(key, value) {
    document.querySelectorAll(`[data-count="${key}"]`).forEach(el => { el.textContent = value; });
  }
  function normalizeCode(s) {
    const cleaned = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length !== 10) return null;
    return cleaned.slice(0, 4) + '-' + cleaned.slice(4);
  }
  function loadJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { console.warn('[door] localStorage write failed', err); }
  }

  // ── roster cache ───────────────────────────────────────────────────────
  function readRoster() { return loadJSON(ROSTER_KEY, {}); }
  function writeRoster(r) { saveJSON(ROSTER_KEY, r); }
  function rosterFromList(list) {
    const m = {};
    for (const t of list) m[t.code] = t;
    return m;
  }
  function localCheckedInCount() {
    const r = readRoster();
    return Object.values(r).filter(t => t.checked_in_at).length;
  }

  // ── pending queue ──────────────────────────────────────────────────────
  function readPending() { return loadJSON(PENDING_KEY, []); }
  function writePending(q) { saveJSON(PENDING_KEY, q); }

  // ── network status pill ───────────────────────────────────────────────
  function updateNetPill() {
    if (!els.netPill) return;
    const queued = readPending().length;
    els.netPill.classList.toggle('is-offline', !navigator.onLine);
    if (!navigator.onLine) {
      els.netPill.textContent = queued ? `Offline · ${queued} queued` : 'Offline';
    } else if (queued) {
      els.netPill.textContent = `Syncing · ${queued} queued`;
    } else {
      els.netPill.textContent = 'Online';
    }
  }

  // ── roster refresh (online only) ───────────────────────────────────────
  async function refresh() {
    const cachedCheckedIn = localCheckedInCount();
    if (!navigator.onLine) {
      // Offline render from cache.
      const r = readRoster();
      const all = Object.values(r);
      setCount('sold', all.length);
      setCount('checked_in', cachedCheckedIn);
      setCount('remaining', Math.max(0, all.length - cachedCheckedIn));
      renderRecent(all.filter(t => t.checked_in_at)
                      .sort((a, b) => (b.checked_in_at || '').localeCompare(a.checked_in_at || ''))
                      .slice(0, 20));
      updateNetPill();
      return;
    }
    try {
      const res = await fetch(rosterUrl(true), { headers: { 'Accept': 'application/json' } });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setCount('sold', body.sold);
      setCount('checked_in', body.checked_in);
      setCount('remaining', Math.max(0, (body.sold || 0) - (body.checked_in || 0)));
      if (Array.isArray(body.all)) writeRoster(rosterFromList(body.all));
      renderRecent(body.recent || []);
    } catch (err) {
      // Network or server failure — render whatever we have cached.
      const r = readRoster();
      const all = Object.values(r);
      setCount('sold', all.length || '—');
      setCount('checked_in', cachedCheckedIn || '—');
      setCount('remaining', all.length ? Math.max(0, all.length - cachedCheckedIn) : '—');
    } finally {
      updateNetPill();
    }
  }

  function renderRecent(list) {
    if (!list.length) {
      els.recent.innerHTML = `<div class="muted small">No check-ins yet.</div>`;
      return;
    }
    const pendingSet = new Set(readPending().map(p => p.code));
    els.recent.innerHTML = list.map(t => {
      const tentative = pendingSet.has(t.code);
      return `
      <div class="recent-row ${tentative ? 'is-tentative' : ''}">
        <div class="recent-time">${esc(fmtTime(t.checked_in_at))}</div>
        <div class="recent-name">
          ${esc(t.holder_name || t.buyer_name || '—')}
          <div class="muted small">
            ${esc(t.tier_name || '')} &middot;
            <span style="font-family:monospace;">${esc(t.code)}</span>
            ${tentative ? ' &middot; <span class="tentative-tag">tentative</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── result banner ──────────────────────────────────────────────────────
  function setResult(state, headline, detail, opts = {}) {
    els.result.dataset.state = state;
    els.result.querySelector('.result-headline').textContent = headline;
    els.result.querySelector('.result-detail').textContent = detail || '';
    els.undo.hidden = !opts.undo;
    lastWasTentative = !!opts.tentative;
    if (navigator.vibrate) {
      if (state === 'ok') navigator.vibrate(80);
      else if (state === 'already') navigator.vibrate([60, 40, 60]);
      else if (state === 'error')   navigator.vibrate([100, 50, 100, 50, 100]);
    }
  }

  // ── check-in: online path ─────────────────────────────────────────────
  async function submitOnline(code) {
    const res = await fetch(codeUrl(code), { method: 'POST' });
    const body = await res.json();
    if (res.status >= 500) throw new Error(body.message || `HTTP ${res.status}`);
    lastCode = body.ticket?.code || null;
    // Sync the local roster row to the server's truth.
    if (body.ticket?.code) {
      const r = readRoster();
      r[body.ticket.code] = { ...(r[body.ticket.code] || {}), ...body.ticket };
      writeRoster(r);
    }
    switch (body.result) {
      case 'ok': {
        const t = body.ticket;
        const name = t.holder_name || t.buyer_name || 'guest';
        setResult('ok', `Welcome — ${name}`, `${t.tier_name} · ${t.code}`, { undo: true });
        break;
      }
      case 'already': {
        const t = body.ticket;
        setResult('already', `Already checked in${t.checked_in_at ? ' at ' + fmtTime(t.checked_in_at) : ''}.`,
                  `${t.holder_name || t.buyer_name || ''} · ${t.tier_name} · ${t.code}`.trim());
        break;
      }
      case 'wrong_event': setResult('error', 'Wrong event',   body.message); break;
      case 'unpaid':      setResult('error', 'Order not paid', body.message); break;
      case 'not_found':   setResult('error', 'Code not found', body.message); break;
      default:            setResult('error', 'Error', body.message || 'Unknown response');
    }
  }

  // ── check-in: offline path ────────────────────────────────────────────
  function submitOffline(code) {
    const normalized = normalizeCode(code);
    if (!normalized) {
      setResult('error', 'Bad code', 'Codes are 10 letters or digits.');
      return;
    }
    const roster = readRoster();
    const ticket = roster[normalized];
    if (!ticket) {
      setResult('error', 'Not in cached roster', 'No signal — try again when online, or wait for the page to sync.');
      return;
    }
    if (ticket.checked_in_at) {
      setResult('already', `Already checked in at ${fmtTime(ticket.checked_in_at)}.`,
                `${ticket.holder_name || ticket.buyer_name || ''} · ${ticket.tier_name} · ${ticket.code}`.trim());
      return;
    }
    const now = new Date().toISOString();
    roster[normalized] = { ...ticket, checked_in_at: now };
    writeRoster(roster);
    const pending = readPending();
    pending.push({ code: normalized, at: now });
    writePending(pending);
    lastCode = normalized;
    const name = ticket.holder_name || ticket.buyer_name || 'guest';
    setResult('ok', `Tentative — ${name}`, `${ticket.tier_name} · ${ticket.code} · will sync`, { undo: true, tentative: true });
  }

  async function submitCode(raw) {
    const code = (raw || '').trim();
    if (!code) return;
    setResult('working', 'Checking…', code);
    try {
      if (navigator.onLine) {
        await submitOnline(code);
      } else {
        submitOffline(code);
      }
    } catch (err) {
      // Network failed mid-online attempt — fall back to offline behavior.
      console.warn('[door] online submit failed, trying offline path', err);
      submitOffline(code);
    } finally {
      els.input.value = '';
      els.input.focus();
      refresh();
    }
  }

  // ── undo ──────────────────────────────────────────────────────────────
  async function undoLast() {
    if (!lastCode) return;
    if (!confirm('Undo the last check-in?')) return;

    // Always strip from local roster + pending queue first so the UI is honest.
    const r = readRoster();
    if (r[lastCode]) { r[lastCode] = { ...r[lastCode], checked_in_at: null }; writeRoster(r); }
    writePending(readPending().filter(p => p.code !== lastCode));

    if (navigator.onLine && !lastWasTentative) {
      try {
        const res = await fetch(codeUrl(lastCode), { method: 'DELETE' });
        const body = await res.json();
        if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
      } catch (err) {
        setResult('error', 'Undo failed online', err.message);
        return;
      }
    }
    setResult('idle', 'Check-in undone.', lastCode);
    lastCode = null;
    lastWasTentative = false;
    els.undo.hidden = true;
    refresh();
  }

  // ── queue drain ───────────────────────────────────────────────────────
  let draining = false;
  async function drainQueue() {
    if (draining || !navigator.onLine) return;
    draining = true;
    try {
      let pending = readPending();
      while (pending.length) {
        const item = pending[0];
        try {
          const res = await fetch(codeUrl(item.code), { method: 'POST' });
          const body = await res.json();
          if (res.status >= 500) throw new Error('5xx');
          // Server may say ok / already / not_found / wrong_event. In any of
          // those cases we've made our local intent visible; drop from queue.
          // For server-side `already` collisions, the roster will reconcile
          // on the next refresh.
          if (body.ticket?.code) {
            const r = readRoster();
            r[body.ticket.code] = { ...(r[body.ticket.code] || {}), ...body.ticket };
            writeRoster(r);
          }
        } catch (err) {
          console.warn('[door] queue drain stopped on error', err);
          break; // try again on next online event
        }
        pending = readPending().filter(p => p.code !== item.code);
        writePending(pending);
        updateNetPill();
      }
    } finally {
      draining = false;
      updateNetPill();
      refresh();
    }
  }

  // ── wiring ────────────────────────────────────────────────────────────
  els.form.addEventListener('submit', e => { e.preventDefault(); submitCode(els.input.value); });
  els.undo.addEventListener('click', undoLast);
  els.input.addEventListener('input', () => {
    const cleaned = els.input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length === 10) submitCode(els.input.value);
  });

  window.addEventListener('online',  () => { updateNetPill(); drainQueue(); });
  window.addEventListener('offline', () => { updateNetPill(); });

  // Initial render. Soft-poll every 30 s when online.
  updateNetPill();
  refresh();
  setInterval(() => { if (navigator.onLine) refresh(); else updateNetPill(); }, 30000);
  els.input.focus();

  // Register the service worker after first paint so a SW bug can't block load.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const scope = location.pathname.startsWith('/admin/checkin/') ? '/admin/checkin/' : '/door/';
      navigator.serviceWorker.register('/checkin/sw.js', { scope }).catch(err => {
        console.warn('[door] sw registration failed', err);
      });
    });
  }

  // Drain on startup if there's anything queued.
  if (navigator.onLine && readPending().length) drainQueue();
})();
