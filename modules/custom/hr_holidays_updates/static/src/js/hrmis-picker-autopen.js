/** @odoo-module **/

function _bindPickerAutoOpen() {
  const form = document.getElementById("profile_update_form");
  if (!form) return;

  // Guard against double-binding (BFCache/pageshow)
  if (form.dataset.hrmisPickerAuto === "1") return;
  form.dataset.hrmisPickerAuto = "1";

  function safeShowPicker(inp) {
    try {
      if (inp && typeof inp.showPicker === "function") inp.showPicker();
    } catch {
      // ignore
    }
  }

  // Use event delegation so dynamically-added inputs (month proxies, repeatable rows)
  // also get the behavior without re-binding.
  function isPickerInput(el) {
    return (
      el &&
      el.tagName === "INPUT" &&
      (el.type === "date" || el.type === "month")
    );
  }

  // Pointer/click should open picker without needing the icon.
  form.addEventListener(
    "click",
    (ev) => {
      const t = ev.target;
      if (isPickerInput(t)) safeShowPicker(t);
    },
    true,
  );

  // Keyboard/tab focus should also open (where supported).
  form.addEventListener(
    "focusin",
    (ev) => {
      const t = ev.target;
      if (isPickerInput(t)) safeShowPicker(t);
    },
    true,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bindPickerAutoOpen);
} else {
  _bindPickerAutoOpen();
}
window.addEventListener("pageshow", _bindPickerAutoOpen);
