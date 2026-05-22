(function () {
  // Mobile nav toggle
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      const open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? 'Close' : 'Menu';
    });
  }

  // Newsletter signup — handles both the home-page band (#signup-form)
  // and the dedicated newsletter page (#newsletter-form).
  function wireSignup(form) {
    if (!form) return;
    const status = form.querySelector('[data-status]');
    const button = form.querySelector('button[type="submit"]');
    const baseStatusClass = status ? status.className.replace(/\s*is-(error|success)\b/g, '').trim() : '';

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (status) { status.className = baseStatusClass; status.textContent = 'Subscribing…'; }
      if (button) button.disabled = true;

      const payload = Object.fromEntries(new FormData(form));
      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          throw new Error(body.message || 'Could not subscribe. Please try again.');
        }
        form.reset();
        if (status) { status.className = baseStatusClass + ' is-success'; status.textContent = body.message || 'Thank you — you are on the list.'; }
      } catch (err) {
        if (status) { status.className = baseStatusClass + ' is-error'; status.textContent = err.message; }
      } finally {
        if (button) button.disabled = false;
      }
    });
  }
  wireSignup(document.getElementById('signup-form'));
  wireSignup(document.getElementById('newsletter-form'));
})();
