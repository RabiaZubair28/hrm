/** @odoo-module **/

function _bindPickerAutoOpen() {
  const form = document.getElementById("profile_update_form");
  if (!form) return;

  // Guard against double-binding (BFCache/pageshow)
  if (form.dataset.hrmisPickerAuto === "1") return;
  form.dataset.hrmisPickerAuto = "1";

  const inputs = form.querySelectorAll('input[type="date"], input[type="month"]');

  function safeShowPicker(inp) {
    try {
      if (inp && typeof inp.showPicker === "function") inp.showPicker();
    } catch {
      // ignore
    }
  }

  inputs.forEach((inp) => {
    inp.addEventListener("focus", () => safeShowPicker(inp));
    inp.addEventListener("click", () => safeShowPicker(inp));
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bindPickerAutoOpen);
} else {
  _bindPickerAutoOpen();
}
window.addEventListener("pageshow", _bindPickerAutoOpen);

