/** @odoo-module **/

/**
 * HRMIS Profile Request Tabs Guard
 *
 * Purpose:
 * - When sections are displayed as Bootstrap tabs, required fields inside hidden tabs
 *   can fail validation without the user seeing where the invalid field is.
 * - We do NOT modify the existing confirmation modal JS.
 *
 * Behavior:
 * - On "Submit Request" click (#btn_open_confirm_modal), if the form is invalid:
 *   - activate the tab containing the first invalid field
 *   - call reportValidity() so the browser shows the message
 *   - stop event so the confirm modal does not open
 */

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _activateTabForElement(el) {
  if (!(el instanceof HTMLElement)) return false;

  const pane = el.closest(".tab-pane");
  if (!pane || !pane.id) return false;

  const tab =
    document.querySelector(`.hrmis-tabs--profile .hrmis-tab[href="#${pane.id}"]`) ||
    document.querySelector(`.hrmis-tabs--profile .hrmis-tab[data-bs-target="#${pane.id}"]`);
  if (!(tab instanceof HTMLElement)) return false;

  // Prefer Bootstrap Tab API if available
  try {
    if (window.bootstrap && window.bootstrap.Tab) {
      window.bootstrap.Tab.getOrCreateInstance(tab).show();
      return true;
    }
  } catch {
    // ignore and fall back
  }

  // Manual fallback (no Bootstrap JS)
  document.querySelectorAll(".hrmis-tabs--profile .hrmis-tab").forEach((t) => {
    t.classList.remove("active");
    t.classList.remove("is-active");
    t.setAttribute("aria-selected", "false");
  });
  tab.classList.add("active");
  tab.classList.add("is-active");
  tab.setAttribute("aria-selected", "true");

  document.querySelectorAll(".tab-content > .tab-pane").forEach((p) => {
    p.classList.remove("active");
    p.classList.remove("show");
  });
  pane.classList.add("active");
  pane.classList.add("show");
  return true;
}

function _bind() {
  const form = _qs(document, "#profile_update_form");
  const openBtn = _qs(document, "#btn_open_confirm_modal");
  if (!form || !openBtn) return;

  // Prevent double-binding on pageshow/BFCache restores
  if (openBtn.dataset.hrmisTabsGuardBound === "1") return;
  openBtn.dataset.hrmisTabsGuardBound = "1";

  // Capture phase so we can stop the modal handler if invalid.
  openBtn.addEventListener(
    "click",
    (ev) => {
      // If valid, do nothing and allow the existing modal handler.
      if (form.checkValidity()) return;

      const firstInvalid = form.querySelector(":invalid");
      if (firstInvalid) _activateTabForElement(firstInvalid);

      // Trigger native validation UI now that the right tab is visible.
      form.reportValidity();

      // Block modal opening.
      ev.preventDefault();
      ev.stopImmediatePropagation();

      // Ensure the invalid field is visible to the user.
      if (firstInvalid && firstInvalid.scrollIntoView) {
        try {
          firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          // ignore
        }
      }
    },
    true,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bind);
} else {
  _bind();
}

window.addEventListener("pageshow", _bind);

