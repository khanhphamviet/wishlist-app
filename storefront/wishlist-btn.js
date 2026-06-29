(function () {
  const btn = document.querySelector(".wishlist-btn[data-product-id]");
  if (!btn) return;

  const productId = btn.dataset.productId;

  function setActive(isActive) {
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  }

  function setLoading(isLoading) {
    btn.classList.toggle("is-loading", isLoading);
  }

  async function checkInitialState() {
    try {
      const res = await fetch(`/apps/wishlist/check?product_id=${productId}`);
      if (!res.ok) return;
      const data = await res.json();
      setActive(data.is_wishlisted);
    } catch {
      // silently ignore — button stays in default state
    }
  }

  async function handleToggle() {
    setLoading(true);
    try {
      const res = await fetch("/apps/wishlist/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId }),
      });

      if (res.status === 401) {
        window.location.href =
          "/account/login?return_url=" +
          encodeURIComponent(window.location.pathname);
        return;
      }

      if (!res.ok) throw new Error(`Error ${res.status}`);

      const data = await res.json();
      setActive(data.is_wishlisted);
    } catch {
      alert("Could not update wishlist. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  btn.addEventListener("click", handleToggle);

  checkInitialState();
})();
