(function () {
  const form   = document.getElementById('setup-form');
  const status = document.getElementById('status');
  const modeEl = form.querySelector('[data-mode] strong');

  function setStatus(state, message, log) {
    status.className = `setup-status is-${state}`;
    let html = String(message)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (Array.isArray(log) && log.length) {
      html += '<span class="log">' + log.map(l =>
        l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      ).join('\n') + '</span>';
    }
    status.innerHTML = html;
  }

  // Pre-fill suggested defaults from the server.
  fetch('/admin/api/setup/config').then(r => r.json()).then(body => {
    if (body && body.suggested) {
      if (body.suggested.project)     form.elements.project.value = body.suggested.project;
      if (body.suggested.webhook_url) form.elements.webhook_url.value = body.suggested.webhook_url;
    }
  }).catch(() => {
    // Fall back to the page's own origin for the webhook URL if config fetch fails.
    if (!form.elements.webhook_url.value) {
      form.elements.webhook_url.value = `${location.origin}/api/webhooks/stripe`;
    }
  });

  // Reflect Stripe mode (live/test) as the user types.
  form.elements.stripe_secret_key.addEventListener('input', () => {
    const v = form.elements.stripe_secret_key.value.trim();
    if (v.startsWith('sk_live_'))      modeEl.textContent = 'LIVE';
    else if (v.startsWith('sk_test_')) modeEl.textContent = 'TEST';
    else                               modeEl.textContent = '—';
    modeEl.style.color = v.startsWith('sk_live_') ? '#7a2c2c' : '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.replace = !!data.replace;

    if (data.stripe_secret_key.startsWith('sk_live_')) {
      if (!confirm('LIVE Stripe key detected. This will create a real webhook on your live account and store the keys for production charges. Proceed?')) {
        return;
      }
    }
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setStatus('working', 'Working… creating the Stripe webhook, writing Cloudflare secrets, queuing a redeploy.');

    try {
      const res = await fetch('/admin/api/setup/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message || `HTTP ${res.status}`);
      }
      setStatus('success', body.message || 'Stripe is wired.', body.log);
      // Clear the secret fields so they don't linger in the DOM.
      form.elements.stripe_secret_key.value = '';
      form.elements.cloudflare_api_token.value = '';
    } catch (err) {
      setStatus('error', err.message || 'Setup failed.', null);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
