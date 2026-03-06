/** @odoo-module **/

function _qs(sel, root = document) {
  return root ? root.querySelector(sel) : null;
}

function _initHrmisPageLoader() {
  const loader = _qs("#hrmis_page_loader");
  if (!loader) return;

  function show() {
    loader.style.display = "flex";
    loader.setAttribute("aria-hidden", "false");
  }

  function hide() {
    loader.style.display = "none";
    loader.setAttribute("aria-hidden", "true");
  }

  // Show immediately (in case something else hid it)
  show();

  // Hide only when FULL page is loaded (images/fonts/etc)
  window.addEventListener("load", hide, { once: true });

  // BFCache restore should not keep loader visible
  window.addEventListener("pageshow", hide);

  // If script loads after the page is already complete
  if (document.readyState === "complete") hide();

  // Show loader on navigation (internal links / form submits)
  document.addEventListener(
    "click",
    (ev) => {
      const a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
      if (!a) return;
      const href = (a.getAttribute("href") || "").trim();
      if (!href || href.startsWith("#")) return; // tabs/in-page anchors
      if (href.startsWith("javascript:")) return;
      const target = (a.getAttribute("target") || "").toLowerCase();
      if (target === "_blank") return;
      show();
    },
    true,
  );

  document.addEventListener(
    "submit",
    (ev) => {
      const form = ev.target;
      if (!form) return;
      // Many HRMIS pages submit via AJAX (preventDefault + fetch).
      // Only show the loader if the submit is not prevented.
      // Also allow opt-out via data attribute.
      if (
        form?.dataset?.hrmisNoLoader === "1" ||
        form?.getAttribute?.("data-hrmis-no-loader") === "1"
      ) {
        return;
      }

      // Defer so other listeners can call preventDefault().
      setTimeout(() => {
        try {
          if (ev.defaultPrevented) return;
        } catch {
          // ignore
        }
        show();
      }, 0);
    },
    true,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initHrmisPageLoader);
} else {
  _initHrmisPageLoader();
}

