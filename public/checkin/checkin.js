// Door check-in client. Mounted on two surfaces:
//   /admin/checkin/<id>            apiBase = /admin/api/checkin
//   /door/<id>/<token>             apiBase = /api/door/<id>/<token>
//
// The page provides <body data-event-id="..." data-api-base="...">.
// All HTTP routes are derived from apiBase + eventId. For /admin/api/checkin
// the per-event roster URL is /admin/api/checkin/<id>; for the door variant
// the eventId is already in the path, so the roster URL IS apiBase.

(function () {
  const eventId  = parseInt(document.body.dataset.eventId, 10);
  const apiBase  = document.body.dataset.apiBase;
  if (!Number.isInteger(eventId) || !apiBase) return;

  const apiContainsEvent = apiBase.endsWith(`/${eventId}`);
  const rosterUrl = apiContainsEvent ? apiBase : `${apiBase}/${eventId}`;
  const codeUrl = (code) => apiContainsEvent
    ? `${apiBase}/${encodeURIComponent(code)}`
    : `${apiBase}/${eventId}/${encodeURIComponent(code)}`;

  const els = {
    form:   document.getElementById('checkin-form'),
    input:  document.getElementById('code'),
    result: document.getElementById('result'),
    recent: document.getElementById('recent'),
    counts: document.querySelectorAll('[data-count]'),
    undo:   document.querySelector('[data-action="undo"]'),
  };
  let lastCode = null;

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

  async function refresh() {
    try {
      const res = await fetch(rosterUrl, { headers: { 'Accept': 'application/json' } });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setCount('sold', body.sold);
      setCount('checked_in', body.checked_in);
      setCount('remaining', Math.max(0, (body.sold || 0) - (body.checked_in || 0)));
      renderRecent(body.recent || []);
    } catch (err) {
      els.recent.innerHTML = `<div class="muted small">Couldn&rsquo;t load roster: ${esc(err.message)}</div>`;
    }
  }

  function renderRecent(list) {
    if (!list.length) {
      els.recent.innerHTML = `<div class="muted small">No check-ins yet.</div>`;
      return;
    }
    els.recent.innerHTML = list.map(t => `
      <div class="recent-row">
        <div class="recent-time">${esc(fmtTime(t.checked_in_at))}</div>
        <div class="recent-name">
          ${esc(t.holder_name || t.buyer_name || '—')}
          <div class="muted small">${esc(t.tier_name)} &middot; <span style="font-family:monospace;">${esc(t.code)}</span></div>
        </div>
      </div>`).join('');
  }

  function setResult(state, headline, detail, showUndo = false) {
    els.result.dataset.state = state;
    els.result.querySelector('.result-headline').textContent = headline;
    els.result.querySelector('.result-detail').textContent = detail || '';
    els.undo.hidden = !showUndo;
    if (navigator.vibrate) {
      if (state === 'ok') navigator.vibrate(80);
      else if (state === 'already') navigator.vibrate([60, 40, 60]);
      else if (state === 'error')   navigator.vibrate([100, 50, 100, 50, 100]);
    }
  }

  async function submitCode(raw) {
    const code = (raw || '').trim();
    if (!code) return;
    setResult('working', 'Checking…', code);
    try {
      const res = await fetch(codeUrl(code), { method: 'POST' });
      const body = await res.json();
      if (res.status >= 500) throw new Error(body.message || `HTTP ${res.status}`);
      lastCode = body.ticket?.code || null;
      switch (body.result) {
        case 'ok': {
          const t = body.ticket;
          const name = t.holder_name || t.buyer_name || 'guest';
          setResult('ok', `Welcome — ${name}`, `${t.tier_name} · ${t.code}`, true);
          break;
        }
        case 'already': {
          const t = body.ticket;
          setResult('already', `Already checked in${t.checked_in_at ? ' at ' + fmtTime(t.checked_in_at) : ''}.`, `${t.holder_name || t.buyer_name || ''} · ${t.tier_name} · ${t.code}`.trim());
          break;
        }
        case 'wrong_event':
          setResult('error', 'Wrong event', body.message); break;
        case 'unpaid':
          setResult('error', 'Order not paid', body.message); break;
        case 'not_found':
          setResult('error', 'Code not found', body.message); break;
        default:
          setResult('error', 'Error', body.message || 'Unknown response');
      }
      els.input.value = '';
      els.input.focus();
      refresh();
    } catch (err) {
      setResult('error', 'Network error', err.message);
    }
  }

  async function undoLast() {
    if (!lastCode) return;
    if (!confirm('Undo the last check-in?')) return;
    try {
      const res = await fetch(codeUrl(lastCode), { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.message || `HTTP ${res.status}`);
      setResult('idle', 'Check-in undone.', lastCode);
      lastCode = null;
      els.undo.hidden = true;
      refresh();
    } catch (err) {
      setResult('error', 'Undo failed', err.message);
    }
  }

  els.form.addEventListener('submit', e => {
    e.preventDefault();
    submitCode(els.input.value);
  });
  els.undo.addEventListener('click', undoLast);

  els.input.addEventListener('input', () => {
    const cleaned = els.input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length === 10) submitCode(els.input.value);
  });

  refresh();
  setInterval(refresh, 30000);
  els.input.focus();
})();
