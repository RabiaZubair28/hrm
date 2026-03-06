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
  const COLLAPSED_CLASS = "is-sidebar-collapsed";
  const STORAGE_KEY = "hrmis_sidebar_collapsed";
  const DESKTOP_MIN = 1201;

  function isDesktop() {
    return window.innerWidth >= DESKTOP_MIN;
  }

  function isDrawerOpen() {
    return app.classList.contains(OPEN_CLASS);
  }

  function setDrawerOpen(open) {
    app.classList.toggle(OPEN_CLASS, !!open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    // Prevent background scroll on mobile drawer
    try {
      document.body.classList.toggle("hrmis-drawer-open", !!open);
    } catch {
      // ignore
    }
  }

  function getStoredCollapsed() {
    try {
      return (
        window.localStorage && window.localStorage.getItem(STORAGE_KEY) === "1"
      );
    } catch {
      return false;
    }
  }

  function storeCollapsed(collapsed) {
    try {
      if (!window.localStorage) return;
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }

  function isCollapsed() {
    return app.classList.contains(COLLAPSED_CLASS);
  }

  function setCollapsed(collapsed) {
    app.classList.toggle(COLLAPSED_CLASS, !!collapsed);
    btn.setAttribute("aria-pressed", collapsed ? "true" : "false");
    storeCollapsed(!!collapsed);
    // On desktop, the button is a collapse toggle, not a drawer.
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (isDesktop()) {
      setDrawerOpen(false);
      setCollapsed(!isCollapsed());
      return;
    }
    setCollapsed(false);
    setDrawerOpen(!isDrawerOpen());
  });

  backdrop.addEventListener("click", (e) => {
    e.preventDefault();
    setDrawerOpen(false);
  });

  // Close drawer when a nav item is clicked (mobile/tablet UX).
  sidebar.addEventListener("click", (e) => {
    const item = e.target.closest(".hrmis-nav__item");
    if (!item) return;
    if (!isDesktop()) setDrawerOpen(false);
  });

  // ESC closes drawer
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setDrawerOpen(false);
  });

  // Init: restore desktop collapsed state.
  if (isDesktop()) {
    setCollapsed(getStoredCollapsed());
    setDrawerOpen(false);
  } else {
    setCollapsed(false);
    setDrawerOpen(false);
  }

  // If resized, ensure drawer is closed, and apply collapsed state on desktop only.
  window.addEventListener("resize", () => {
    setDrawerOpen(false);
    if (isDesktop()) {
      setCollapsed(getStoredCollapsed());
    } else {
      setCollapsed(false);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => _initNavDrawer(document));
} else {
  _initNavDrawer(document);
}
