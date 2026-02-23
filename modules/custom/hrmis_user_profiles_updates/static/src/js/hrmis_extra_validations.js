/** @odoo-module **/

// Extra frontend validations:
// - PMDC No. format: 5 digits + '-' + 1 letter (auto-inserts '-')
// - PMDC Issue Date: not in future
// - PMDC Expiry Date: >= Issue Date, can be future; disabled until Issue Date set
// - Email: basic email format
// - Postal Code: 5 digits
// - Previous Posting History: start/end are month inputs
//   - Start disabled until Joining Date set (shows red warning + translucent)
//   - Start cannot be in future (max current month)
//   - End disabled until Start set (shows warning), End >= Start, End <= current month

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function _todayMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function _isEmpty(v) {
  return v == null || String(v).trim() === "";
}

function _visualTarget(el) {
  // If hrmis_profile_validation enhanced a select into combobox, it stores the input here.
  if (el && el.tagName === "SELECT" && el._hrmisComboboxInput)
    return el._hrmisComboboxInput;
  return el;
}

function _showError(el, message) {
  if (!el) return;
  const target = _visualTarget(el);
  let err = target.parentElement?.querySelector?.(".hrmis-error");
  if (!err) {
    err = document.createElement("div");
    err.className = "hrmis-error";
    target.parentElement?.appendChild(err);
  }
  err.textContent = message || "Invalid value";
  target.classList.add("has-error");
  target.style.borderColor = "#dc3545";
}

function _clearError(el) {
  if (!el) return;
  const target = _visualTarget(el);
  const err = target.parentElement?.querySelector?.(".hrmis-error");
  if (err) err.remove();
  target.classList.remove("has-error");
  target.style.borderColor = "";
}

function _setTranslucent(el, on) {
  if (!el) return;
  el.style.background = on ? "#f3f4f6" : "";
  el.style.opacity = on ? "0.75" : "";
  el.style.cursor = on ? "not-allowed" : "";
}

// -----------------------
// PMDC
// -----------------------
function _normalizePmdc(raw) {
  const s = String(raw || "").toUpperCase();
  const digits = (s.match(/\d/g) || []).join("").slice(0, 5);
  const letters = (s.match(/[A-Z]/g) || []).join("");
  const letter = letters.slice(0, 1);

  if (digits.length < 5) return digits;
  // 5 digits reached: show hyphen even before letter
  if (!letter) return `${digits}-`;
  return `${digits}-${letter}`;
}

function _validatePmdc(el, { strict = false } = {}) {
  if (!el) return true;

  const v = String(el.value || "").trim().toUpperCase();
  _clearError(el);
  el.setCustomValidity("");

  if (_isEmpty(v)) return true;

  const fullOk = /^\d{5}-[A-Z]$/.test(v);
  const partialOk = /^\d{0,5}(-)?([A-Z])?$/.test(v) || /^\d{5}-$/.test(v);

  if (strict ? !fullOk : !partialOk) {
    const msg = "PMDC No. must be like 72465-S";
    _showError(el, msg);
    el.setCustomValidity(msg);
    return false;
  }

  if (strict && !fullOk) {
    const msg = "PMDC No. must be like 72465-S";
    _showError(el, msg);
    el.setCustomValidity(msg);
    return false;
  }

  return true;
}

function _syncPmdcDates(form) {
  const issue = _qs(form, 'input[name="hrmis_pmdc_issue_date"]');
  const expiry = _qs(form, 'input[name="hrmis_pmdc_expiry_date"]');
  if (!issue || !expiry) return;

  const today = _todayYmd();
  issue.setAttribute("max", today);

  // Issue validation
  _clearError(issue);
  issue.setCustomValidity("");
  if (!_isEmpty(issue.value) && issue.value > today) {
    const msg = "PMDC Issue Date cannot be in the future.";
    _showError(issue, msg);
    issue.setCustomValidity(msg);
  }

  // Expiry depends on issue
  if (_isEmpty(issue.value)) {
    expiry.value = "";
    expiry.disabled = true;
    expiry.removeAttribute("min");
    _setTranslucent(expiry, true);
    _showError(expiry, "Select PMDC Issue Date first.");
    expiry.setCustomValidity("Select PMDC Issue Date first.");
    return;
  }

  expiry.disabled = false;
  _setTranslucent(expiry, false);
  _clearError(expiry);
  expiry.setCustomValidity("");
  expiry.setAttribute("min", issue.value);

  if (!_isEmpty(expiry.value) && expiry.value < issue.value) {
    const msg = "PMDC Expiry Date must be after Issue Date.";
    _showError(expiry, msg);
    expiry.setCustomValidity(msg);
  }
}

// -----------------------
// Email + Postal
// -----------------------
function _validateEmail(el) {
  if (!el) return true;
  const v = String(el.value || "").trim();
  _clearError(el);
  el.setCustomValidity("");
  if (_isEmpty(v)) return true;

  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  if (!ok) {
    const msg = "Please enter a valid email address.";
    _showError(el, msg);
    el.setCustomValidity(msg);
    return false;
  }
  return true;
}

function _validatePostal(el) {
  if (!el) return true;
  const raw = String(el.value || "");
  const digits = raw.replace(/\D/g, "").slice(0, 5);
  if (digits !== raw) el.value = digits;

  _clearError(el);
  el.setCustomValidity("");
  if (_isEmpty(digits)) return true;

  const ok = /^\d{5}$/.test(digits);
  if (!ok) {
    const msg = "Postal Code must be 5 digits.";
    _showError(el, msg);
    el.setCustomValidity(msg);
    return false;
  }
  return true;
}

// -----------------------
// Previous Posting History (month inputs)
// -----------------------
function _joiningMonth(form) {
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  const v = (joining?.value || "").trim(); // YYYY-MM-DD
  return v ? v.slice(0, 7) : "";
}

function _syncPrevPostingRow(form, row) {
  const start = _qs(row, 'input[name="posting_start[]"]');
  const end = _qs(row, 'input[name="posting_end[]"]');
  if (!start || !end) return;

  const jm = _joiningMonth(form);
  const tm = _todayMonth();

  // Start disabled until joining date set
  _clearError(start);
  start.setCustomValidity("");
  start.setAttribute("max", tm);

  if (_isEmpty(jm)) {
    start.value = "";
    start.disabled = true;
    _setTranslucent(start, true);
    const msg = "Select Joining Date first to enable Start (Month/Year).";
    _showError(start, msg);
    start.setCustomValidity(msg);
  } else {
    start.disabled = false;
    _setTranslucent(start, false);
    start.setAttribute("min", jm);

    if (!_isEmpty(start.value)) {
      if (start.value > tm) {
        const msg = "Start (Month/Year) cannot be in the future.";
        _showError(start, msg);
        start.setCustomValidity(msg);
      } else if (start.value < jm) {
        const msg = "Start (Month/Year) cannot be before Joining Month.";
        _showError(start, msg);
        start.setCustomValidity(msg);
      }
    }
  }

  // End depends on start
  _clearError(end);
  end.setCustomValidity("");
  end.setAttribute("max", tm);

  if (_isEmpty(jm)) {
    end.value = "";
    end.disabled = true;
    _setTranslucent(end, true);
    const msg = "Select Joining Date first to enable End (Month/Year).";
    _showError(end, msg);
    end.setCustomValidity(msg);
    return;
  }

  if (_isEmpty(start.value) || start.disabled) {
    end.value = "";
    end.disabled = true;
    _setTranslucent(end, true);
    const msg = "Select Start (Month/Year) first to enable End (Month/Year).";
    _showError(end, msg);
    end.setCustomValidity(msg);
    return;
  }

  end.disabled = false;
  _setTranslucent(end, false);
  end.setAttribute("min", start.value);

  if (!_isEmpty(end.value)) {
    if (end.value < start.value) {
      const msg = "End (Month/Year) must be after Start (Month/Year).";
      _showError(end, msg);
      end.setCustomValidity(msg);
    } else if (end.value > tm) {
      const msg = "End (Month/Year) cannot be in the future.";
      _showError(end, msg);
      end.setCustomValidity(msg);
    }
  }
}

function _syncAllPrevPosting(form) {
  _qsa(form, "#prev_post_rows .hrmis-repeat-row").forEach((row) =>
    _syncPrevPostingRow(form, row),
  );
}

function _initExtraValidations() {
  const form = _qs(document, "#profile_update_form") || _qs(document, ".hrmis-form");
  if (!form) return;

  // guard
  if (form.dataset.hrmisExtraValidations === "1") return;
  form.dataset.hrmisExtraValidations = "1";

  const pmdc = _qs(form, 'input[name="hrmis_pmdc_no"]');
  const email = _qs(form, 'input[name="hrmis_email"]');
  const postal = _qs(form, 'input[name="hrmis_postal_code"]');

  if (pmdc) {
    pmdc.addEventListener("input", () => {
      const next = _normalizePmdc(pmdc.value);
      if (next !== pmdc.value) pmdc.value = next;
      _validatePmdc(pmdc, { strict: false });
    });
    pmdc.addEventListener("blur", () => _validatePmdc(pmdc, { strict: true }));
  }

  if (email) {
    email.addEventListener("input", () => _validateEmail(email));
    email.addEventListener("blur", () => _validateEmail(email));
  }

  if (postal) {
    postal.setAttribute("inputmode", "numeric");
    postal.setAttribute("maxlength", "5");
    postal.addEventListener("input", () => _validatePostal(postal));
    postal.addEventListener("blur", () => _validatePostal(postal));
  }

  // PMDC dates + prev posting depend on joining date
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  if (joining) {
    joining.addEventListener("change", () => {
      _syncPmdcDates(form);
      _syncAllPrevPosting(form);
    });
  }

  // PMDC date events
  const issue = _qs(form, 'input[name="hrmis_pmdc_issue_date"]');
  const expiry = _qs(form, 'input[name="hrmis_pmdc_expiry_date"]');
  if (issue) issue.addEventListener("change", () => _syncPmdcDates(form));
  if (expiry) expiry.addEventListener("change", () => _syncPmdcDates(form));

  // Prev posting events (delegated, works for dynamically added rows)
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.matches('input[name="posting_start[]"], input[name="posting_end[]"]')) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) _syncPrevPostingRow(form, row);
    }
  });
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.matches('input[name="posting_start[]"], input[name="posting_end[]"]')) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) _syncPrevPostingRow(form, row);
    }
  });

  // Initial sync
  _syncPmdcDates(form);
  _syncAllPrevPosting(form);

  // Observe added rows
  const obs = new MutationObserver(() => _syncAllPrevPosting(form));
  obs.observe(form, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initExtraValidations);
} else {
  _initExtraValidations();
}

window.addEventListener("pageshow", _initExtraValidations);

