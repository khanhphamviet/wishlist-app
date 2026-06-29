(function () {
  // Event delegation — handles clicks on any matching button, even if duplicated in DOM
  document.addEventListener('click', function (e) {
    const wishlistBtn = e.target.closest('.wishlist-btn[data-product-id]');
    if (wishlistBtn) { handleToggle(wishlistBtn); return; }

    const shareBtn = e.target.closest('.share-btn--overlay');
    if (shareBtn) { handleShare(shareBtn); }
  });

  // Check initial wishlist state on load
  const btn = document.querySelector('.wishlist-btn[data-product-id]');
  if (btn) checkInitialState(btn.dataset.productId);

  function setActive(isActive) {
    document.querySelectorAll('.wishlist-btn[data-product-id]').forEach((b) => {
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', String(isActive));
    });
  }

  function setLoading(isLoading) {
    document.querySelectorAll('.wishlist-btn[data-product-id]').forEach((b) => {
      b.classList.toggle('is-loading', isLoading);
    });
  }

  async function checkInitialState(productId) {
    try {
      const res = await fetch(`/apps/wishlist/check?product_id=${productId}`);
      if (!res.ok) return;
      const data = await res.json();
      setActive(data.is_wishlisted);
    } catch {
      // silently ignore — button stays in default state
    }
  }

  async function handleToggle(btn) {
    const productId = btn.dataset.productId;
    setLoading(true);
    try {
      const res = await fetch('/apps/wishlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      });

      if (res.status === 401) {
        window.location.href =
          '/account/login?return_url=' + encodeURIComponent(window.location.pathname);
        return;
      }

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setActive(data.is_wishlisted);
    } catch {
      alert('Could not update wishlist. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleShare(btn) {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 2000);
  }
})();
