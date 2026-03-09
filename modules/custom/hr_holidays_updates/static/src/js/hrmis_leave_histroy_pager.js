/** @odoo-module **/

// Leave History client-side pagination (scoped)
// - Works with div-table rows .hrmis-table__row inside .hrmis-leave-history-ui
// - Only hides/shows rows on the page (no server changes)

function _qsa(root, sel) {
  return Array.from((root || document).querySelectorAll(sel));
}
function _qs(root, sel) {
  return (root || document).querySelector(sel);
}
function _setDisabled(btn, disabled) {
  if (!btn) return;
  if (disabled) btn.setAttribute("disabled", "disabled");
  else btn.removeAttribute("disabled");
}

function setupPager(scope) {
  // If this scope was already bound once, just force a re-render.
  // This avoids duplicate listeners and fixes cases where rows are injected
  // or a tab becomes visible after initial DOMContentLoaded.
  if (scope && scope.__hrmisPager && typeof scope.__hrmisPager.render === "function") {
    // Defer a bit to let the UI finish toggling tabs / injecting rows.
    requestAnimationFrame(() => scope.__hrmisPager.render(true));
    setTimeout(() => scope.__hrmisPager.render(true), 60);
    return;
  }

  // Keep existing markup intact; just be tolerant to slight class differences
  const body =
    _qs(scope, ".js-hrmis-pager-body") ||
    _qs(scope, ".hrmis-table__body") ||
    _qs(scope, "tbody");

  const footer = _qs(scope, ".js-hrmis-pager-footer");
  const info = (_qs(scope, ".js-hrmis-pager-info") || (footer ? _qs(footer, ".js-hrmis-pager-info") : null));

  // Support both old/new button class names (so > < work everywhere)
  const prev =
    _qs(scope, ".js-hrmis-pager-prev") ||
    (footer ? _qs(footer, ".js-hrmis-pager-prev") : null) ||
    _qs(scope, ".js-hrmis-prev") ||
    (footer ? _qs(footer, ".js-hrmis-prev") : null);
  const next =
    _qs(scope, ".js-hrmis-pager-next") ||
    (footer ? _qs(footer, ".js-hrmis-pager-next") : null) ||
    _qs(scope, ".js-hrmis-next") ||
    (footer ? _qs(footer, ".js-hrmis-next") : null);

  // Small spacing so arrows don't stick to the border
  const controls =
    _qs(scope, ".js-hrmis-pager-controls") ||
    (footer ? _qs(footer, ".js-hrmis-pager-controls") : null) ||
    _qs(scope, ".hrmis-table-footer__controls") ||
    (footer ? _qs(footer, ".hrmis-table-footer__controls") : null) ||
    (prev ? prev.parentElement : null);
  if (controls) controls.style.padding = "12px";

  if (!body || !footer || !info || !prev || !next) return;

  const pageSize = parseInt(footer.dataset.pageSize || "6", 10) || 6;

  // Keep state on scope so we can re-render after tab switches / DOM updates.
  let page = 1;

  function _getRows() {
    // Re-query each time to support rows being injected after load.
    const divRows = _qsa(body, ".hrmis-table__row");
    return divRows.length ? divRows : _qsa(body, "tr");
  }

  function render(recompute) {
const allRows = recompute ? _getRows() : _getRows();

// Rows hidden by filters must NOT be paginated, and must never be re-shown by the pager.
const visibleRows = allRows.filter((r) => !r.classList.contains("hrmis-filter-hidden"));

const total = visibleRows.length;
const pages = Math.max(1, Math.ceil(total / pageSize));

// Clamp page if total changed.
if (page > pages) page = pages;
if (page < 1) page = 1;

const startIdx = (page - 1) * pageSize;
const endIdx = startIdx + pageSize;

// First hide everything; then show only the current page of VISIBLE rows.
allRows.forEach((row) => {
  // Respect active filters
  if (row.classList.contains("hrmis-filter-hidden")) {
    row.style.display = "none";
  } else {
    row.style.display = "none";
  }
});

visibleRows.forEach((row, idx) => {
  row.style.display = (idx >= startIdx && idx < endIdx) ? "" : "none";
});

const shownFrom = total ? (startIdx + 1) : 0;
const shownTo = total ? Math.min(endIdx, total) : 0;
info.textContent = `Showing ${shownFrom}-${shownTo} of ${total}`;

_setDisabled(prev, page <= 1);
_setDisabled(next, page >= pages);
  }

  prev.addEventListener("click", () => {
    page -= 1;
    render(true);
  });

  next.addEventListener("click", () => {
    page += 1;
    render(true);
  });

  // Persist handle for later re-renders
  scope.__hrmisPager = { render, reset: () => { page = 1; render(true); } };

  // Initial render (deferred) to avoid "first page shows all" on hidden tabs
  requestAnimationFrame(() => render(true));
  setTimeout(() => render(true), 60);
}

function init() {
  // 1) Leave History scopes
  _qsa(document, ".hrmis-leave-history-ui").forEach(setupPager);

  // 2) Any other section that already has pager markup (e.g., Manage Requests tabs)
  _qsa(document, ".js-hrmis-pager-footer").forEach((footer) => {
    const scope = footer.closest(".hrmis-leave-history-ui") || footer.parentElement;
    if (scope) setupPager(scope);
  });

  // Re-apply pagination after tab clicks (Manage Requests tabs swap content)
  document.addEventListener(
    "click",
    (ev) => {
      const tab = ev.target && ev.target.closest && ev.target.closest("a,button");
      if (!tab) return;
      const href = tab.getAttribute && tab.getAttribute("href");
      const isTabLike =
        (href && href.startsWith("#")) ||
        tab.classList.contains("nav-link") ||
        (tab.dataset && (tab.dataset.toggle || tab.dataset.bsToggle));
      if (!isTabLike) return;

      // Defer to allow the tab panel to become visible.
      setTimeout(() => {
        _qsa(document, ".hrmis-leave-history-ui").forEach(setupPager);
        _qsa(document, ".js-hrmis-pager-footer").forEach((footer) => {
          const scope = footer.closest(".hrmis-leave-history-ui") || footer.parentElement;
          if (scope) setupPager(scope);
        });
      }, 80);
    },
    true
  );

  // Also observe DOM changes (some sections are injected after load)
  const mo = new MutationObserver(() => {
    _qsa(document, ".js-hrmis-pager-footer").forEach((footer) => {
      const scope = footer.closest(".hrmis-leave-history-ui") || footer.parentElement;
      if (scope) setupPager(scope);
    });
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
