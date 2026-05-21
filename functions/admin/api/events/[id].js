// /admin/api/events/:id
//   PATCH  — update editable fields (status, notes, event_date, venue, fee_cents, etc.)
//   DELETE — remove the event row (contact row is left intact)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const ALLOWED_STATUS = new Set(['inquiry','quoted','tentative','confirmed','performed','declined','canceled']);

const EDITABLE_EVENT_FIELDS = ['program','event_date','venue','audience','notes','fee_cents'];

export async function onRequestPatch({ request, params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  let data;
  try { data = await request.json(); } catch { return json(400, { ok: false, message: 'Invalid JSON.' }); }

  const sets = [];
  const binds = [];

  for (const field of EDITABLE_EVENT_FIELDS) {
    if (field in data) {
      let value = data[field];
      if (field === 'fee_cents') {
        value = (value === null || value === '') ? null
              : Number.isFinite(+value) ? Math.max(0, Math.round(+value)) : null;
      } else if (typeof value === 'string') {
        value = value.trim() || null;
      }
      sets.push(`${field} = ?`);
      binds.push(value);
    }
  }

  if ('status' in data) {
    if (!ALLOWED_STATUS.has(data.status)) {
      return json(400, { ok: false, message: 'Invalid status.' });
    }
    sets.push(`status = ?`);
    binds.push(data.status);
  }

  // Optional contact fields (passthrough). These hit the contacts table.
  const contactUpdates = [];
  const contactBinds = [];
  for (const field of ['contact_name','contact_email','contact_organization','contact_phone','contact_notes']) {
    if (field in data) {
      const col = field.replace(/^contact_/, '');
      let value = data[field];
      if (typeof value === 'string') value = value.trim() || null;
      if (col === 'email' && value) value = value.toLowerCase();
      contactUpdates.push(`${col} = ?`);
      contactBinds.push(value);
    }
  }

  if (!sets.length && !contactUpdates.length) {
    return json(400, { ok: false, message: 'Nothing to update.' });
  }

  try {
    if (sets.length) {
      sets.push(`updated_at = datetime('now')`);
      binds.push(id);
      await env.DB.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
    }

    if (contactUpdates.length) {
      contactUpdates.push(`updated_at = datetime('now')`);
      contactBinds.push(id);
      await env.DB.prepare(
        `UPDATE contacts SET ${contactUpdates.join(', ')}
         WHERE id = (SELECT contact_id FROM events WHERE id = ?)`,
      ).bind(...contactBinds).run();
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('event patch failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}

export async function onRequestDelete({ params, env }) {
  const id = parseInt(params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return json(400, { ok: false, message: 'Bad id.' });

  try {
    await env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
    return json(200, { ok: true });
  } catch (err) {
    console.error('event delete failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
