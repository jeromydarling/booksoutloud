(function () {
  const form = document.getElementById('checkout-form');
  if (!form) return;
  const slug = form.dataset.slug;
  const subtotalEl = form.querySelector('[data-subtotal]');
  const statusEl = form.querySelector('[data-status]');
  const submit = form.querySelector('button[type="submit"]');

  const currency = (document.querySelector('[data-subtotal]')?.textContent || '').replace(/[\d.,\s]/g, '') || '$';

  function money(cents) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
  }

  function recompute() {
    let total = 0;
    form.querySelectorAll('.ticket-tier').forEach(tier => {
      const price = parseInt(tier.dataset.priceCents, 10) || 0;
      const qty = parseInt(tier.querySelector('input[type="number"]').value, 10) || 0;
      total += price * qty;
    });
    if (subtotalEl) subtotalEl.textContent = money(total);
    submit.disabled = total <= 0;
  }

  form.querySelectorAll('.ticket-tier').forEach(tier => {
    const input = tier.querySelector('input[type="number"]');
    tier.querySelector('[data-action="dec"]').addEventListener('click', () => {
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
      recompute();
    });
    tier.querySelector('[data-action="inc"]').addEventListener('click', () => {
      input.value = Math.min(20, (parseInt(input.value, 10) || 0) + 1);
      recompute();
    });
    input.addEventListener('input', recompute);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const items = [];
    form.querySelectorAll('.ticket-tier').forEach(tier => {
      const tier_id = parseInt(tier.dataset.tierId, 10);
      const qty = parseInt(tier.querySelector('input[type="number"]').value, 10) || 0;
      if (qty > 0) items.push({ tier_id, qty });
    });
    if (!items.length) {
      statusEl.textContent = 'Pick at least one ticket.';
      statusEl.className = 'form-status is-error';
      return;
    }
    statusEl.textContent = 'Opening checkout…';
    statusEl.className = 'form-status';
    submit.disabled = true;
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, items }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.message || 'Could not start checkout.');
      window.location = body.url;
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = 'form-status is-error';
      submit.disabled = false;
    }
  });

  recompute();
})();
