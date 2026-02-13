/** @odoo-module **/

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}
function _qsa(root, sel) {
  return root ? root.querySelectorAll(sel) : [];
}

function _isResetPasswordPage() {
  const hasForm = !!_qs(document, "#passwordForm");
  const pathOk = (window.location.pathname || "") === "/force_password_reset";
  console.log("[ForcePassword] page check:", {
    hasForm,
    path: window.location.pathname,
    pathOk,
  });
  return hasForm || pathOk;
}

function _setMsg(el, text, okState) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("text-success", "text-danger", "text-muted");
  if (okState === true) el.classList.add("text-success");
  else if (okState === false) el.classList.add("text-danger");
  else el.classList.add("text-muted");
}

function _initPasswordMatch() {
  console.log("[ForcePasswordMatch] init start");

  const form = _qs(document, "#passwordForm");
  if (!form) {
    console.log("[ForcePasswordMatch] #passwordForm not found; skipping");
    return;
  }

  const newPw = _qs(form, "#new_password");
  const confirmPw = _qs(form, "#confirm_password");
  const msg = _qs(document, "#passwordMatchMsg");

  console.log("[ForcePasswordMatch] elements:", {
    form: !!form,
    new_password: !!newPw,
    confirm_password: !!confirmPw,
    msg: !!msg,
  });

  if (!newPw || !confirmPw || !msg) {
    console.warn("[ForcePasswordMatch] missing required DOM elements");
    return;
  }

  function check() {
    const a = (newPw.value || "").trim();
    const b = (confirmPw.value || "").trim();

    if (!a && !b) {
      _setMsg(msg, "", null);
      return true;
    }
    if (!a || !b) {
      _setMsg(msg, "Type both passwords to compare.", null);
      return false;
    }
    if (a === b) {
      _setMsg(msg, "Passwords match.", true);
      return true;
    }
    _setMsg(msg, "Passwords do not match.", false);
    return false;
  }

  if (form.dataset.pwMatchBound === "1") {
    console.log("[ForcePasswordMatch] already bound; skipping rebind");
    check();
    return;
  }
  form.dataset.pwMatchBound = "1";

  newPw.addEventListener("input", () => {
    console.log("[ForcePasswordMatch] new_password input");
    check();
  });
  confirmPw.addEventListener("input", () => {
    console.log("[ForcePasswordMatch] confirm_password input");
    check();
  });

  // Block submit if mismatch
  form.addEventListener("submit", (ev) => {
    console.log("[ForcePasswordMatch] form submit");
    const ok = check();
    if (!ok) {
      console.warn("[ForcePasswordMatch] submit blocked (passwords mismatch / incomplete)");
      ev.preventDefault();
      confirmPw.focus();
    }
  });

  console.log("[ForcePasswordMatch] init complete");
  check();
}

function _bindEyeButtons() {
  console.log("[ForcePasswordEye] init start");

  if (!_isResetPasswordPage()) {
    console.log("[ForcePasswordEye] not reset page -> skip");
    return;
  }

  const root = _qs(document, "#passwordForm") || document;
  const buttons = _qsa(root, ".toggle-password");
  console.log("[ForcePasswordEye] buttons found:", buttons.length);

  if (!buttons.length) {
    console.warn("[ForcePasswordEye] No .toggle-password found. Check template classes.");
    return;
  }

  buttons.forEach((btn, idx) => {
    if (btn.dataset.eyeBound === "1") {
      console.log(`[ForcePasswordEye] (#${idx}) already bound -> skip`);
      return;
    }
    btn.dataset.eyeBound = "1";

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();

      const group = btn.closest(".input-group") || btn.parentElement;
      const input = group ? _qs(group, ".password-field") : null;
      const icon = _qs(btn, "i");

      console.log(`[ForcePasswordEye] (#${idx}) click`, {
        hasGroup: !!group,
        hasInput: !!input,
        hasIcon: !!icon,
      });

      if (!input) {
        console.warn(`[ForcePasswordEye] (#${idx}) .password-field not found near this button`);
        return;
      }

      const wasHidden = input.type === "password";
      input.type = wasHidden ? "text" : "password";

      // FontAwesome toggle:
      if (icon) {
        icon.classList.toggle("fa-eye", wasHidden);
        icon.classList.toggle("fa-eye-slash", !wasHidden);

        if (!icon.classList.contains("fa") && !icon.classList.contains("fas")) {
          icon.classList.add("fa");
        }
      }

      console.log(
        `[ForcePasswordEye] (#${idx}) toggled`,
        input.name || input.id || "(no-name)",
        "=>",
        input.type
      );
    });
  });

  console.log("[ForcePasswordEye] init complete");
}

function _initAll() {
  console.log("[ForcePassword] initAll()");
  _bindEyeButtons();
  _initPasswordMatch();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initAll);
} else {
  _initAll();
}

window.addEventListener("pageshow", _initAll);
