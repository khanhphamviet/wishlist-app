(function () {
  const root = document.getElementById('wishlist-root');
  const grid = document.getElementById('wishlist-grid');
  const emptyEl = document.getElementById('wishlist-empty');
  const emptyText = document.getElementById('wishlist-empty-text');
  const loadingEl = document.getElementById('wishlist-loading');

  const locale     = root.dataset.locale     || 'en';
  const currency   = root.dataset.currency   || 'USD';
  const localeRoot = root.dataset.localeRoot || '/';

  const i18n = {
    loginText:   root.dataset.loginText,
    errorText:   root.dataset.errorText,
    removeLabel: root.dataset.removeLabel,
  };

  function localizeUrl(path) {
    const base = localeRoot === '/' ? '' : localeRoot.replace(/\/$/, '');
    return base + path;
  }

  function formatPrice(amount) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(amount);
  }

  function renderProducts(products) {
    grid.innerHTML = products
      .map(
        (p) => `
        <div class="wishlist-card" data-product-id="${p.id}">
          <a href="${localizeUrl(p.url)}" class="wishlist-card__image-link">
            ${
              p.image
                ? `<img src="${p.image}" alt="${p.title}" class="wishlist-card__image" loading="lazy">`
                : `<div class="wishlist-card__image-placeholder"></div>`
            }
          </a>
          <div class="wishlist-card__info">
            <a href="${localizeUrl(p.url)}" class="wishlist-card__title">${p.title}</a>
            <p class="wishlist-card__price">${formatPrice(p.price)}</p>
          </div>
          <button class="wishlist-card__remove" data-product-id="${p.id}" aria-label="${i18n.removeLabel}">
            &times;
          </button>
        </div>
      `
      )
      .join('');

    grid.querySelectorAll('.wishlist-card__remove').forEach((btn) => {
      btn.addEventListener('click', handleRemove);
    });
  }

  async function handleRemove(e) {
    const productId = e.currentTarget.dataset.productId;
    const card = grid.querySelector(`.wishlist-card[data-product-id="${productId}"]`);

    try {
      const res = await fetch('/apps/wishlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      });

      if (!res.ok) throw new Error('Failed to remove');

      card.remove();

      if (grid.children.length === 0) emptyEl.style.display = 'flex';
    } catch {
      alert('Could not remove product. Please try again.');
    }
  }

  async function loadWishlist() {
    try {
      const res = await fetch('/apps/wishlist/list');

      if (res.status === 401) {
        loadingEl.style.display = 'none';
        emptyEl.style.display = 'flex';
        emptyText.textContent = i18n.loginText;
        return;
      }

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      loadingEl.style.display = 'none';

      if (!data.products || data.products.length === 0) {
        emptyEl.style.display = 'flex';
        return;
      }

      renderProducts(data.products);
    } catch (err) {
      loadingEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      emptyText.textContent = i18n.errorText;
      console.error('[Wishlist]', err);
    }
  }

  loadWishlist();
})();
