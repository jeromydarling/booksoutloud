(function () {
  const params = new URLSearchParams(location.search);
  const program = params.get('program');
  if (program) {
    const sel = document.querySelector('#field-program');
    if (sel && [...sel.options].some(o => o.value === program)) {
      sel.value = program;
    }
  }

  const form = document.getElementById('booking-form');
  if (!form) return;
  const status = document.getElementById('form-status');
  const submit = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = '';
    submit.disabled = true;
    submit.textContent = 'Sending…';

    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.ok) {
        status.className = 'form-status is-success';
        status.textContent = body.message || 'Thank you — your inquiry has been sent. You will hear back shortly.';
        form.reset();
      } else {
        status.className = 'form-status is-error';
        status.textContent = body.message || 'Sorry, something went wrong. Please try again, or email directly.';
      }
    } catch (err) {
      status.className = 'form-status is-error';
      status.textContent = 'Network error. Please try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Send inquiry';
    }
  });
})();
