// Gate every /admin/* request behind Cloudflare Access.
//
// Cloudflare Access adds the `Cf-Access-Authenticated-User-Email` header to
// requests that have completed the Access login flow, and a JWT in
// `Cf-Access-Jwt-Assertion`. We only allow the address listed in env.ADMIN_EMAIL.
//
// If Access is not yet configured for this route the header will be missing and
// every request will fail closed (401). Configure the Access application in the
// Cloudflare dashboard: Zero Trust → Access → Applications → Self-hosted, with
// path /admin* and a policy that allows env.ADMIN_EMAIL.

function unauthorized(message) {
  return new Response(
    JSON.stringify({ ok: false, message }),
    { status: 401, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const accessEmail = (request.headers.get('Cf-Access-Authenticated-User-Email') || '').toLowerCase();
  const allowed = (env.ADMIN_EMAIL || '').toLowerCase();

  if (!allowed) {
    return unauthorized('Admin is not configured. Set ADMIN_EMAIL in wrangler.toml.');
  }
  if (!accessEmail) {
    return unauthorized('Cloudflare Access is not in front of this route. See setup notes in wrangler.toml.');
  }
  if (accessEmail !== allowed) {
    return unauthorized('Not authorized.');
  }

  const response = await next();
  // Belt-and-suspenders: do not allow admin pages to be indexed.
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
