// GET /admin/api/setup/config
//
// Returns suggested defaults for the setup wizard so the form can pre-fill
// the obvious values (project name + webhook URL). The CF token isn't
// supplied — that has to be pasted by the user since the Function has no
// way to know it.

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = env.SITE_URL || `${url.protocol}//${url.host}`;
  return json(200, {
    ok: true,
    suggested: {
      project:     env.CF_PAGES_PROJECT_NAME || 'booksoutloud',
      webhook_url: `${origin}/api/webhooks/stripe`,
    },
  });
}
