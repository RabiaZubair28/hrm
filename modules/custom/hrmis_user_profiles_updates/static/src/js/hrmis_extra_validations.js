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
// - Current Status boxes (Suspended / On Leave / EOL):
//   - Start date: not in future, not before Posting Start (current_posting_start or joining date)
//   - End date: disabled until start picked, min=start, can be future
// - Substantive dates:
//   - Start disabled until Joining Date set (warning)  [NOW WORKS for your QWeb month input current_posting_start]
//   - Start cannot be in future; Start >= Joining Date/Joining Month
//   - End disabled until Start valid (warning); End >= Start; End can be future
// - Allowed to work dates:
//   - Same rules as Substantive  [NOW WORKS for your QWeb month input allowed_start_month]
// IMPORTANT NEW REQUIREMENT (Urdu):
// - Jab tak joining date na add karun, tab tak:
//   - Substantive starting date (current_posting_start month input)
//   - Allowed to work starting date (allowed_start_month month input)
//   - Suspension date (frontend_suspension_date date input)
//   should show warning "Please select the Joining Date first." BY DEFAULT ON LOAD.

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _firstExisting(root, selectors) {
  for (const sel of selectors) {
    const el = _qs(root, sel);
    if (el) return el;
  }
  return null;
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

function _isValidMonth(v) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || "").trim());
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
  err.style.display = "";
  target.classList.add("has-error");
  target.style.borderColor = "#dc3545";
}

// IMPORTANT: do not remove error nodes (MutationObserver loop risk). Hide instead.
function _clearError(el) {
  if (!el) return;
  const target = _visualTarget(el);
  const err = target.parentElement?.querySelector?.(".hrmis-error");
  if (err) {
    err.textContent = "";
    err.style.display = "none";
  }
  target.classList.remove("has-error");
  target.style.borderColor = "";
}

function _setTranslucent(el, on) {
  if (!el) return;
  el.style.background = on ? "#f3f4f6" : "";
  el.style.opacity = on ? "0.75" : "";
  el.style.cursor = on ? "not-allowed" : "";
}

function _monthToYmdFirst(ym) {
  const v = String(ym || "").trim();
  return _isValidMonth(v) ? `${v}-01` : "";
}

function _requireJoiningOrWarn(form, el) {
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  const hasJoining = joining && !_isEmpty(joining.value);

  _clearError(el);
  el.setCustomValidity("");

  if (!hasJoining) {
    const msg = "Please select the Joining Date first.";
    _showError(el, msg);
    el.setCustomValidity(msg);
    return false;
  }
  return true;
}

function _joiningBaselineYmd(form) {
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  const jv = (joining?.value || "").trim(); // YYYY-MM-DD
  return jv || "";
}

function _postingBaselineYmd(form) {
  // Joining date MUST exist (user requirement)
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  const jv = (joining?.value || "").trim(); // YYYY-MM-DD
  if (!jv) return "";

  // Prefer posting start (month) if present (current_posting_start -> YYYY-MM)
  const cps = _qs(form, 'input[name="current_posting_start"]');
  const cpsV = _monthToYmdFirst(cps?.value);
  if (cpsV) return cpsV;

  // Otherwise baseline is joining date itself
  return jv;
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

function _validatePmdc(el, { strict = false, showHint = false } = {}) {
  if (!el) return true;

  const v = String(el.value || "")
    .trim()
    .toUpperCase();
  const touched = el.dataset.touched === "1";

  // Don't show anything by default until touched (unless explicitly asked)
  if (!touched && !showHint) {
    _clearError(el);
    el.setCustomValidity("");
    return true;
  }

  // Always clear first
  _clearError(el);
  el.setCustomValidity("");

  // If empty: show hint only when user focused/clicked
  if (_isEmpty(v)) {
    if (touched && showHint) {
      _showError(el, "PMDC format is 00000-X (e.g., 72465-S)");
    }
    return true; // optional field: don't block
  }

  const fullOk = /^\d{5}-[A-Z]$/.test(v);
  const partialOk = /^\d{0,5}(-)?([A-Z])?$/.test(v) || /^\d{5}-$/.test(v);

  // While typing: show persistent hint/error until complete
  if (!fullOk) {
    _showError(el, "PMDC format is 00000-X (e.g., 72465-S)");
  }

  // Only block submission when strict OR when user leaves field with invalid value
  if (strict && !fullOk) {
    const msg = "PMDC No. must be like 72465-S";
    el.setCustomValidity(msg);
    return false;
  }

  // If not strict: allow partial typing
  if (!strict && !partialOk) {
    const msg = "PMDC format is 00000-X (e.g., 72465-S)";
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

  // ---- Issue: not in future ----
  _clearError(issue);
  issue.setCustomValidity("");
  if (!_isEmpty(issue.value) && issue.value > today) {
    const msg = "PMDC Issue Date cannot be in the future.";
    _showError(issue, msg);
    issue.setCustomValidity(msg);
  }

  // ---- Expiry depends on Issue ----
  const issueEmpty = _isEmpty(issue.value);

  if (issueEmpty) {
    // Always disable when Issue missing
    expiry.disabled = true;
    _setTranslucent(expiry, true);
    expiry.removeAttribute("min");

    // IMPORTANT: do NOT show warning on initial load
    _clearError(expiry);
    expiry.setCustomValidity("");

    // Show only if user tried to interact OR already typed something
    const touched = expiry.dataset.touched === "1";
    const hasVal = !_isEmpty(expiry.value);
    if (touched || hasVal) {
      const msg = "Select PMDC Issue Date first.";
      _showError(expiry, msg);
      expiry.setCustomValidity(msg);
    }

    // Optional: if issue is cleared later, also clear expiry value
    expiry.value = "";
    return;
  }

  // Issue exists => enable expiry
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
  const digitsOnly = raw.replace(/\D/g, "");
  const clipped = digitsOnly.slice(0, 5);

  // If user attempted non-digits, show warning (but keep digits-only value)
  const triedNonDigits = /\D/.test(raw);

  if (raw !== clipped) el.value = clipped;

  _clearError(el);
  el.setCustomValidity("");

  // Only show warnings after user interacted
  const touched = el.dataset.touched === "1";

  if (touched && triedNonDigits) {
    const msg = "Postal Code can only contain digits.";
    _showError(el, msg);
    // Not blocking if it's empty; only block if they leave non-5-digit value later
  }

  if (_isEmpty(clipped)) return true;

  const ok = /^\d{5}$/.test(clipped);
  if (!ok) {
    const msg = "Postal Code must be exactly 5 digits.";
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

// -----------------------
// Date validation helpers
// -----------------------
function _setDateInvalid(el, msg) {
  if (!el) return;
  _showError(el, msg);
  el.setCustomValidity(msg);
}

function _clearDateInvalid(el) {
  if (!el) return;
  _clearError(el);
  el.setCustomValidity("");
}

// -----------------------
// Current Status boxes (date inputs)
// -----------------------
function _wrapVisible(el) {
  if (!el) return false;
  const wrap = el.closest("[id$='_wrap'], .hrmis-field, .js-status-box") || el;
  // if explicitly hidden via display:none on any ancestor, treat as hidden
  let cur = wrap;
  for (let i = 0; i < 6 && cur; i++) {
    if (cur.style && cur.style.display === "none") return false;
    cur = cur.parentElement;
  }
  return true;
}

function _syncStatusDatePair(form, startEl, endEl, labels) {
  if (!startEl) return;

  const today = _todayYmd();
  const baseline = _postingBaselineYmd(form); // "" if joining missing

  // helper: show join warning in red immediately (no touch required)
  function _forceJoiningWarn(el) {
    if (!el) return;
    _setTranslucent(el, true);
    el.disabled = true;
    el.removeAttribute("min");
    el.removeAttribute("max");
    _setDateInvalid(el, "Please select the Joining Date first.");
    if (!_isEmpty(el.value)) el.value = "";
  }

  // ---------------- JOINING GATE ----------------
  // IMPORTANT CHANGE: even if the status box is hidden, you asked Suspension Date to show warning by default.
  // So we ALWAYS apply the joining warning if joining is missing.
  if (!baseline) {
    _forceJoiningWarn(startEl);
    if (endEl) _forceJoiningWarn(endEl);
    return;
  }

  // joining exists => enable start
  startEl.disabled = false;
  _setTranslucent(startEl, false);

  // ---------------- START RULES ----------------
  startEl.setAttribute("min", baseline); // not before posting baseline
  startEl.setAttribute("max", today); // not in future

  _clearDateInvalid(startEl);

  const sv = (startEl.value || "").trim();
  let startOk = false;

  if (!_isEmpty(sv)) {
    if (sv > today) {
      _setDateInvalid(startEl, `${labels.start} cannot be in the future.`);
    } else if (sv < baseline) {
      _setDateInvalid(
        startEl,
        `${labels.start} cannot be before Posting Date.`,
      );
    } else {
      startOk = true;
    }
  }

  // If no end field, stop.
  if (!endEl) return;

  // If end is hidden, ignore it.
  if (!_wrapVisible(endEl)) {
    _clearDateInvalid(endEl);
    return;
  }

  // ---------------- END RULES ----------------
  endEl.removeAttribute("max"); // future allowed always

  if (!startOk) {
    // Disable end until start selected and valid
    endEl.disabled = true;
    _setTranslucent(endEl, true);
    endEl.removeAttribute("min");

    // Show warning immediately
    _setDateInvalid(endEl, `Please select the ${labels.start} first.`);
    if (!_isEmpty(endEl.value)) endEl.value = "";
    return;
  }

  // Enable end
  endEl.disabled = false;
  _setTranslucent(endEl, false);
  endEl.setAttribute("min", sv); // only >= start selectable
  _clearDateInvalid(endEl);

  const ev = (endEl.value || "").trim();
  if (!_isEmpty(ev) && ev < sv) {
    _setDateInvalid(endEl, `${labels.end} must be after ${labels.start}.`);
  }
}

function _syncStatusDates(form) {
  // Suspended
  _syncStatusDatePair(
    form,
    _qs(form, 'input[name="frontend_suspension_date"]'),
    null,
    { start: "Suspension Date", end: "End Date" },
  );

  // On Leave
  _syncStatusDatePair(
    form,
    _qs(form, 'input[name="frontend_onleave_start"]'),
    _qs(form, 'input[name="frontend_onleave_end"]'),
    { start: "On Leave Start Date", end: "On Leave End Date" },
  );

  // EOL (PGship)
  const eolStart = _qs(form, 'input[name="frontend_eol_start"]');
  const eolEnd = _qs(form, 'input[name="frontend_eol_end"]');
  _syncStatusDatePair(form, eolStart, eolEnd, {
    start: "EOL Start Date",
    end: "EOL End Date",
  });
}

// -----------------------
// Substantive + Allowed to work
// IMPORTANT CHANGE: Your QWeb uses MONTH inputs:
//   - Substantive start is current_posting_start (type=month)
//   - Allowed-to-work start is allowed_start_month (type=month)
// The previous selectors (substantive_start_date etc.) won't match your template.
// Below we support BOTH:
//   (A) date-input pairs (if present anywhere else)
//   (B) month-input starts/ends from your current template
// -----------------------
function _syncJoiningBasedDatePair(form, startEl, endEl, labels) {
  // (kept exactly as you had, for date inputs in other screens/versions)
  if (!startEl) return;

  const today = _todayYmd();
  const joinYmd = _joiningBaselineYmd(form); // "" if joining missing

  // ---- JOINING GATE ----
  if (!joinYmd) {
    startEl.disabled = true;
    _setTranslucent(startEl, true);
    startEl.removeAttribute("min");
    startEl.removeAttribute("max");
    _setDateInvalid(startEl, "Please select the Joining Date first.");

    if (endEl) {
      endEl.disabled = true;
      _setTranslucent(endEl, true);
      endEl.removeAttribute("min");
      endEl.removeAttribute("max");
      _setDateInvalid(endEl, "Please select the Joining Date first.");
    }
    return;
  }

  // ---- START RULES ----
  startEl.disabled = false;
  _setTranslucent(startEl, false);

  startEl.setAttribute("min", joinYmd);
  startEl.setAttribute("max", today); // cannot be in future
  _clearDateInvalid(startEl);

  const sv = (startEl.value || "").trim();
  let startOk = false;

  if (!_isEmpty(sv)) {
    if (sv > today) {
      _setDateInvalid(startEl, `${labels.start} cannot be in the future.`);
    } else if (sv < joinYmd) {
      _setDateInvalid(
        startEl,
        `${labels.start} cannot be before Joining Date.`,
      );
    } else {
      startOk = true;
    }
  }

  if (!endEl) return;

  // ---- END RULES (future allowed) ----
  endEl.removeAttribute("max");
  _clearDateInvalid(endEl);

  if (!startOk) {
    endEl.disabled = true;
    _setTranslucent(endEl, true);
    endEl.removeAttribute("min");
    _setDateInvalid(endEl, `Please select the ${labels.start} first.`);
    if (!_isEmpty(endEl.value)) endEl.value = "";
    return;
  }

  endEl.disabled = false;
  _setTranslucent(endEl, false);
  endEl.setAttribute("min", sv);

  const ev = (endEl.value || "").trim();
  if (!_isEmpty(ev) && ev < sv) {
    _setDateInvalid(endEl, `${labels.end} must be after ${labels.start}.`);
  }
}

// Month helpers for your QWeb month fields
function _setMonthInvalid(el, msg) {
  if (!el) return;
  _showError(el, msg);
  el.setCustomValidity(msg);
}

function _clearMonthInvalid(el) {
  if (!el) return;
  _clearError(el);
  el.setCustomValidity("");
}

function _syncJoiningBasedMonthPair(
  form,
  startEl,
  endEl,
  labels,
  { allowEndFuture = true } = {},
) {
  if (!startEl) return;

  const jm = _joiningMonth(form); // YYYY-MM
  const tm = _todayMonth(); // YYYY-MM

  // ---- JOINING GATE (SHOW WARNING BY DEFAULT ON LOAD) ----
  if (_isEmpty(jm)) {
    startEl.disabled = true;
    _setTranslucent(startEl, true);
    startEl.removeAttribute("min");
    startEl.removeAttribute("max");
    _setMonthInvalid(startEl, "Please select the Joining Date first.");
    if (!_isEmpty(startEl.value)) startEl.value = "";

    if (endEl) {
      endEl.disabled = true;
      _setTranslucent(endEl, true);
      endEl.removeAttribute("min");
      endEl.removeAttribute("max");
      _setMonthInvalid(endEl, "Please select the Joining Date first.");
      if (!_isEmpty(endEl.value)) endEl.value = "";
    }
    return;
  }

  // ---- START RULES ----
  startEl.disabled = false;
  _setTranslucent(startEl, false);
  startEl.setAttribute("min", jm);
  startEl.setAttribute("max", tm); // cannot be in future
  _clearMonthInvalid(startEl);

  const sv = (startEl.value || "").trim();
  let startOk = false;

  if (!_isEmpty(sv)) {
    if (!_isValidMonth(sv)) {
      _setMonthInvalid(startEl, `${labels.start} is invalid.`);
    } else if (sv > tm) {
      _setMonthInvalid(startEl, `${labels.start} cannot be in the future.`);
    } else if (sv < jm) {
      _setMonthInvalid(
        startEl,
        `${labels.start} cannot be before Joining Month.`,
      );
    } else {
      startOk = true;
    }
  }

  if (!endEl) return;

  // ---- END RULES ----
  if (!startOk) {
    endEl.disabled = true;
    _setTranslucent(endEl, true);
    endEl.removeAttribute("min");
    endEl.removeAttribute("max");
    _setMonthInvalid(endEl, `Please select the ${labels.start} first.`);
    if (!_isEmpty(endEl.value)) endEl.value = "";
    return;
  }

  endEl.disabled = false;
  _setTranslucent(endEl, false);
  endEl.setAttribute("min", sv);

  if (allowEndFuture) endEl.removeAttribute("max");
  else endEl.setAttribute("max", tm);

  _clearMonthInvalid(endEl);

  const ev = (endEl.value || "").trim();
  if (!_isEmpty(ev)) {
    if (!_isValidMonth(ev)) {
      _setMonthInvalid(endEl, `${labels.end} is invalid.`);
    } else if (ev < sv) {
      _setMonthInvalid(endEl, `${labels.end} must be after ${labels.start}.`);
    } else if (!allowEndFuture && ev > tm) {
      _setMonthInvalid(endEl, `${labels.end} cannot be in the future.`);
    }
  }
}

function _syncSubstantiveAndAllowedDates(form) {
  // ---------------------------
  // A) Legacy date-input pairs (keep for other screens / field names)
  // ---------------------------
  const subStartDate = _firstExisting(form, [
    'input[name="substantive_start_date"]',
    'input[name="hrmis_substantive_start_date"]',
    'input[name="frontend_substantive_start"]',
    'input[name="frontend_substantive_start_date"]',
  ]);
  const subEndDate = _firstExisting(form, [
    'input[name="substantive_end_date"]',
    'input[name="hrmis_substantive_end_date"]',
    'input[name="frontend_substantive_end"]',
    'input[name="frontend_substantive_end_date"]',
  ]);

  _syncJoiningBasedDatePair(form, subStartDate, subEndDate, {
    start: "Substantive Start Date",
    end: "Substantive End Date",
  });

  const atwStartDate = _firstExisting(form, [
    'input[name="allowed_to_work_start_date"]',
    'input[name="hrmis_allowed_to_work_start_date"]',
    'input[name="frontend_allowed_to_work_start"]',
    'input[name="frontend_allowed_to_work_start_date"]',
  ]);
  const atwEndDate = _firstExisting(form, [
    'input[name="allowed_to_work_end_date"]',
    'input[name="hrmis_allowed_to_work_end_date"]',
    'input[name="frontend_allowed_to_work_end"]',
    'input[name="frontend_allowed_to_work_end_date"]',
  ]);

  _syncJoiningBasedDatePair(form, atwStartDate, atwEndDate, {
    start: "Allowed to Work Start Date",
    end: "Allowed to Work End Date",
  });

  // ---------------------------
  // B) Your current QWeb MONTH inputs
  // ---------------------------

  // Substantive start (Month/Year) = current_posting_start
  // NOTE: It appears TWICE in your template, so we must validate all occurrences.
  const substantiveStarts = _qsa(
    form,
    'input[type="month"][name="current_posting_start"]',
  );
  substantiveStarts.forEach((el) => {
    _syncJoiningBasedMonthPair(
      form,
      el,
      null,
      {
        start: "Substantive Start (Month/Year)",
        end: "Substantive End (Month/Year)",
      },
      { allowEndFuture: true },
    );
  });

  // Allowed-to-work start (Month/Year) = allowed_start_month
  const allowedStart = _qs(
    form,
    'input[type="month"][name="allowed_start_month"]',
  );

  // If in future you add an end month field, we'll support these common names:
  const allowedEnd =
    _qs(form, 'input[type="month"][name="allowed_end_month"]') ||
    _qs(form, 'input[type="month"][name="allowed_end_month[]"]') ||
    _qs(form, 'input[type="month"][name="allowed_to_work_end_month"]') ||
    _qs(form, 'input[type="month"][name="allowed_to_work_end_month[]"]');

  _syncJoiningBasedMonthPair(
    form,
    allowedStart,
    allowedEnd,
    {
      start: "Allowed to Work Start (Month/Year)",
      end: "Allowed to Work End (Month/Year)",
    },
    { allowEndFuture: true },
  );
}

// -----------------------
// Init
// -----------------------
function _initExtraValidations() {
  const form =
    _qs(document, "#profile_update_form") || _qs(document, ".hrmis-form");
  if (!form) return;

  // guard
  if (form.dataset.hrmisExtraValidations === "1") return;
  form.dataset.hrmisExtraValidations = "1";

  const pmdc = _qs(form, 'input[name="hrmis_pmdc_no"]');
  const email = _qs(form, 'input[name="hrmis_email"]');
  const postal = _qs(form, 'input[name="hrmis_postal_code"]');

  // Debounced sync to avoid repeated heavy work (especially from MutationObserver)
  let _syncPending = false;
  function _scheduleHeavySync() {
    if (_syncPending) return;
    _syncPending = true;
    requestAnimationFrame(() => {
      _syncPending = false;
      _syncAllPrevPosting(form);
      _syncStatusDates(form);
      _syncSubstantiveAndAllowedDates(form);
    });
  }

  if (pmdc) {
    // show hint only after first focus
    pmdc.addEventListener("focus", () => {
      pmdc.dataset.touched = "1";
      // If empty, show format hint but don't block submit (optional field)
      if (_isEmpty(pmdc.value)) {
        _clearError(pmdc);
        pmdc.setCustomValidity("");
        _showError(pmdc, "PMDC format is 00000-X (e.g., 72465-S)");
      } else {
        _validatePmdc(pmdc, { strict: false, showHint: true });
      }
    });

    pmdc.addEventListener("input", () => {
      const next = _normalizePmdc(pmdc.value);
      if (next !== pmdc.value) pmdc.value = next;

      // only show messages after user has interacted
      if (pmdc.dataset.touched === "1") {
        _validatePmdc(pmdc, { strict: false, showHint: true });
      } else {
        // no default warnings before touch
        _clearError(pmdc);
        pmdc.setCustomValidity("");
      }
    });

    pmdc.addEventListener("blur", () => {
      // On blur: if user typed something, enforce full format
      if (!_isEmpty(pmdc.value)) {
        _validatePmdc(pmdc, { strict: true, showHint: true });
      } else {
        // if empty, clear error (optional field)
        _clearError(pmdc);
        pmdc.setCustomValidity("");
      }
    });
  }

  if (email) {
    email.addEventListener("input", () => _validateEmail(email));
    email.addEventListener("blur", () => _validateEmail(email));
  }

  if (postal) {
    postal.setAttribute("inputmode", "numeric");
    postal.setAttribute("maxlength", "5");

    postal.addEventListener("focus", () => {
      postal.dataset.touched = "1";
    });

    postal.addEventListener("input", () => _validatePostal(postal));
    postal.addEventListener("blur", () => _validatePostal(postal));
  }

  // PMDC dates + prev posting + status/substantive/allowed depend on joining date
  const joining = _qs(form, 'input[name="hrmis_joining_date"]');
  if (joining) {
    joining.addEventListener("change", () => {
      _syncPmdcDates(form);
      _scheduleHeavySync();
    });
  }

  const postingStartMonth = _qs(form, 'input[name="current_posting_start"]');
  if (postingStartMonth) {
    postingStartMonth.addEventListener("change", () => _syncStatusDates(form));
    postingStartMonth.addEventListener("input", () => _syncStatusDates(form));
  }

  // PMDC date events
  const issue = _qs(form, 'input[name="hrmis_pmdc_issue_date"]');
  const expiry = _qs(form, 'input[name="hrmis_pmdc_expiry_date"]');
  if (issue) issue.addEventListener("change", () => _syncPmdcDates(form));

  if (expiry) {
    expiry.addEventListener("focus", () => {
      expiry.dataset.touched = "1";
      _syncPmdcDates(form);
    });
    expiry.addEventListener("change", () => _syncPmdcDates(form));
  }

  function _markTouchedAndSync(form, el, fnSync) {
    if (!el) return;
    el.addEventListener("focus", () => {
      el.dataset.touched = "1";
      fnSync(form);
    });
    el.addEventListener("mousedown", () => {
      // helps when clicking a disabled input (some browsers)
      el.dataset.touched = "1";
      fnSync(form);
    });
    el.addEventListener("change", () => {
      el.dataset.touched = "1";
      fnSync(form);
    });
    el.addEventListener("input", () => {
      el.dataset.touched = "1";
      fnSync(form);
    });
  }

  // Mark touched + sync for status date fields
  const statusSelectors = [
    'input[name="frontend_suspension_date"]',
    'input[name="frontend_onleave_start"]',
    'input[name="frontend_onleave_end"]',
    'input[name="frontend_eol_start"]',
    'input[name="frontend_eol_end"]',
  ];
  statusSelectors.forEach((sel) => {
    _markTouchedAndSync(form, _qs(form, sel), _syncStatusDates);
  });

  // Mark touched + sync for substantive/allowed fields (multiple possible names)
  // IMPORTANT: also attach to month inputs in your QWeb
  const subAllowedSelectors = [
    // Legacy date-based names
    'input[name="substantive_start_date"]',
    'input[name="substantive_end_date"]',
    'input[name="hrmis_substantive_start_date"]',
    'input[name="hrmis_substantive_end_date"]',
    'input[name="frontend_substantive_start"]',
    'input[name="frontend_substantive_end"]',
    'input[name="frontend_substantive_start_date"]',
    'input[name="frontend_substantive_end_date"]',
    'input[name="allowed_to_work_start_date"]',
    'input[name="allowed_to_work_end_date"]',
    'input[name="hrmis_allowed_to_work_start_date"]',
    'input[name="hrmis_allowed_to_work_end_date"]',
    'input[name="frontend_allowed_to_work_start"]',
    'input[name="frontend_allowed_to_work_end"]',
    'input[name="frontend_allowed_to_work_start_date"]',
    'input[name="frontend_allowed_to_work_end_date"]',

    // Your QWeb month inputs
    'input[type="month"][name="current_posting_start"]',
    'input[type="month"][name="allowed_start_month"]',
    'input[type="month"][name="allowed_end_month"]',
    'input[type="month"][name="allowed_end_month[]"]',
  ];
  subAllowedSelectors.forEach((sel) => {
    _qsa(form, sel).forEach((el) => {
      _markTouchedAndSync(form, el, _syncSubstantiveAndAllowedDates);
    });
  });

  // Initial sync
  // IMPORTANT: this will now show Joining warnings BY DEFAULT ON LOAD for:
  // - Suspension date
  // - current_posting_start month input(s)
  // - allowed_start_month month input
  _syncPmdcDates(form);
  _syncAllPrevPosting(form);
  _syncStatusDates(form);
  _syncSubstantiveAndAllowedDates(form);

  // Observe added rows / dynamic DOM changes (debounced)
  const obs = new MutationObserver(() => {
    _scheduleHeavySync();
  });
  obs.observe(form, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initExtraValidations);
} else {
  _initExtraValidations();
}

window.addEventListener("pageshow", _initExtraValidations);
