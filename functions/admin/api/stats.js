// /admin/api/stats — tab badge counts

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN status IN ('inquiry','quoted','tentative') THEN 1 ELSE 0 END) AS inquiries,
         SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS upcoming,
         SUM(CASE WHEN status IN ('performed','declined','canceled') THEN 1 ELSE 0 END) AS history,
         COUNT(*) AS total
       FROM events`,
    ).all();
    const row = results?.[0] || { inquiries: 0, upcoming: 0, history: 0, total: 0 };
    return json(200, { ok: true, ...row });
  } catch (err) {
    console.error('stats failed', err);
    return json(500, { ok: false, message: 'Database error.' });
  }
}
