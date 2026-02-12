/** @odoo-module **/

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _initNavDrawer(root = document) {
  const app = _qs(root, ".hrmis-app");
  const btn = _qs(root, ".js-hrmis-nav-toggle");
  const backdrop = _qs(root, ".js-hrmis-drawer-backdrop");
  const sidebar = _qs(root, ".hrmis-sidebar");
  if (!app || !btn || !backdrop || !sidebar) return;

  const OPEN_CLASS = "is-nav-open";

  function isOpen() {
    return app.classList.contains(OPEN_CLASS);
  }

  function setOpen(open) {
    app.classList.toggle(OPEN_CLASS, !!open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    setOpen(!isOpen());
  });

  backdrop.addEventListener("click", (e) => {
    e.preventDefault();
    setOpen(false);
  });

  // Close drawer when a nav item is clicked (mobile/tablet UX).
  sidebar.addEventListener("click", (e) => {
    const item = e.target.closest(".hrmis-nav__item");
    if (!item) return;
    setOpen(false);
  });

  // ESC closes drawer
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });

  // If resized to desktop, ensure drawer state is closed.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1200) setOpen(false);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => _initNavDrawer(document));
} else {
  _initNavDrawer(document);
}
