// /admin/api/stats — counts for the tab badges

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const eventStats = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status IN ('inquiry','quoted','tentative') THEN 1 ELSE 0 END) AS inquiries,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN status IN ('performed','declined','canceled') THEN 1 ELSE 0 END) AS history,
         COUNT(*) AS total
       FROM events`,
    ).first();

    const subStats = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS subscribers,
         SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed
       FROM subscribers`,
    ).first();

    return json(200, {
      ok: true,
      inquiries:    eventStats?.inquiries    || 0,
      upcoming:     eventStats?.upcoming     || 0,
      history:      eventStats?.history      || 0,
      total:        eventStats?.total        || 0,
      subscribers:  subStats?.subscribers    || 0,
      unsubscribed: subStats?.unsubscribed   || 0,
    });
  } catch (err) {
    console.error('stats failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
