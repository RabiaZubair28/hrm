/** @odoo-module **/

/* =========================================================
 *  HRMIS VALIDATIONS + REPEATABLES (FULL FILE) — CORRECTED
 *
 *  Key fixes in this corrected file:
 *   1) Removed duplicate _initPostingPrevChain definition (only ONE kept)
 *   2) Removed orphan / out-of-scope posting-chain code (that caused runtime/syntax issues)
 *   3) Month proxy (Commission/Joining) no longer conflicts with _initProfileDatePickers
 *      - DOB uses HRMIS calendar widget
 *      - Commission/Joining use month proxy ONLY
 *   4) Added init guard to prevent double-binding on pageshow / bfcache
 *   5) Combobox: errors now highlight visible input (not hidden select)
 * ========================================================= */

/* ---------------------------------------------------------
 * Helpers
 * --------------------------------------------------------- */
let _hrmisComboboxGlobalListenerAttached = false;

function _attachComboboxGlobalCloser() {
  if (_hrmisComboboxGlobalListenerAttached) return;
  _hrmisComboboxGlobalListenerAttached = true;

  document.addEventListener("click", (e) => {
    document.querySelectorAll(".hrmis-combobox").forEach((wrap) => {
      if (!wrap.contains(e.target)) {
        const dd = wrap.querySelector(".hrmis-combobox-dd");
        if (dd) dd.style.display = "none";
      }
    });
  });
}
function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}
function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}
function _isEmpty(val) {
  return val === null || val === undefined || String(val).trim() === "";
}
function _setHint(input, message) {
  if (!input) return;
  let hint = input.parentElement?.querySelector?.(".hrmis-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "hrmis-hint";
    hint.style.fontSize = "12px";
    hint.style.marginTop = "4px";
    hint.style.color = "#6c757d";
    input.parentElement?.appendChild(hint);
  }
  hint.textContent = message || "";
  hint.style.display = message ? "" : "none";
}

function _normInt(v) {
  const n = parseInt(String(v || "").trim(), 10);
  return Number.isNaN(n) ? null : n;
}

/* ---------------------------------------------------------
 * Error helpers (combobox-safe)
 * --------------------------------------------------------- */
function _visualErrorTarget(el) {
  // If this is a hidden select that has a visible combobox input, use that.
  if (el && el.tagName === "SELECT" && el._hrmisComboboxInput)
    return el._hrmisComboboxInput;
  return el;
}

function _showError(input, message) {
  if (!input) return;
  const target = _visualErrorTarget(input);

  let error = target.parentElement?.querySelector?.(".hrmis-error");
  if (!error) {
    error = document.createElement("div");
    error.className = "hrmis-error";
    target.parentElement?.appendChild(error);
  }
  error.textContent = message;

  target.classList.add("has-error");
  target.style.borderColor = "#dc3545";

  // Also mark original element if different (e.g., select)
  if (target !== input && input) {
    input.classList.add("has-error");
  }
}

function _clearError(input) {
  if (!input) return;
  const target = _visualErrorTarget(input);

  const error = target.parentElement?.querySelector?.(".hrmis-error");
  if (error) error.remove();

  target.classList.remove("has-error");
  target.style.borderColor = "";

  if (target !== input && input) {
    input.classList.remove("has-error");
  }
}
function _syncPostingRowDateConstraints(form, row) {
  const startInp = _qs(row, 'input[name="posting_start[]"]');
  const endInp = _qs(row, 'input[name="posting_end[]"]');
  if (!startInp || !endInp) return;

  const jm = _joiningMonthValue(form); // YYYY-MM
  const cm = (_qs(form, '[name="current_posting_start"]')?.value || "").trim(); // YYYY-MM

  // Upper bound is the month BEFORE current posting start (strictly before cm)
  const upper = _isValidMonth(cm) ? _prevMonth(cm) : "";
  const lower = _isValidMonth(jm) ? jm : "";

  // apply min/max bounds
  if (lower) {
    startInp.setAttribute("min", lower);
    endInp.setAttribute("min", lower);
  } else {
    startInp.removeAttribute("min");
    endInp.removeAttribute("min");
  }

  if (upper) {
    startInp.setAttribute("max", upper);
    endInp.setAttribute("max", upper);
  } else {
    startInp.removeAttribute("max");
    endInp.removeAttribute("max");
  }

  // end.min should also be >= start (if start is valid)
  const s = _readMonthValueFromInput(startInp);
  if (_isValidMonth(s)) endInp.setAttribute("min", s);

  // clamp values if they are out of range
  function clamp(inp) {
    const v = _readMonthValueFromInput(inp);
    if (!_isValidMonth(v)) return;

    let nv = v;
    if (lower && _monthToIndex(nv) < _monthToIndex(lower)) nv = lower;
    if (upper && _monthToIndex(nv) > _monthToIndex(upper)) nv = upper;

    if (nv !== v) _writeMonthValueToInput(inp, nv);
  }

  clamp(startInp);
  clamp(endInp);
}

/* ---------------------------------------------------------
 * Month helpers (YYYY-MM)
 * --------------------------------------------------------- */
function _isValidMonth(v) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v || "").trim());
}
function _monthToIndex(v) {
  const [y, m] = String(v)
    .split("-")
    .map((x) => parseInt(x, 10));
  return y * 12 + (m - 1);
}
function _todayMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
function _indexToMonth(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
function _addMonths(ym, delta) {
  if (!_isValidMonth(ym)) return "";
  return _indexToMonth(_monthToIndex(ym) + delta);
}
function _nextMonth(ym) {
  return _addMonths(ym, 1);
}
function _prevMonth(ym) {
  return _addMonths(ym, -1);
}

/* ---------------------------------------------------------
 * Month <-> Date input compatibility
 * --------------------------------------------------------- */
function _inputTypeLower(inp) {
  return String(inp?.getAttribute("type") || inp?.type || "").toLowerCase();
}
function _readMonthValueFromInput(inp) {
  if (!inp) return "";
  const v = (inp.value || "").trim();
  if (_isEmpty(v)) return "";
  const t = _inputTypeLower(inp);
  if (t === "date") return v.slice(0, 7);
  return v;
}
function _writeMonthValueToInput(inp, ym) {
  if (!inp) return;
  const t = _inputTypeLower(inp);
  if (_isEmpty(ym)) {
    inp.value = "";
    return;
  }
  if (t === "date")
    inp.value = `${ym}-01`; // important
  else inp.value = ym;
}

/* ---------------------------------------------------------
 * Month UI proxy for DATE fields (Commission/Joining)
 *  - Shows month picker (YYYY-MM)
 *  - Hidden original stays enabled and submits YYYY-MM-01
 * --------------------------------------------------------- */
function _toLocalYmd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function _todayLocalYmd() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return _toLocalYmd(d);
}

function _attachMonthProxy(dateInput) {
  if (!dateInput) return null;
  if (dateInput.dataset.hrmisMonthProxyApplied === "1") {
    return dateInput._hrmisMonthProxy || null;
  }

  dateInput.dataset.hrmisMonthProxyApplied = "1";

  const proxy = document.createElement("input");
  proxy.type = "month";
  proxy.className = dateInput.className;
  proxy.autocomplete = "off";

  const parent = dateInput.parentNode;
  if (parent) parent.insertBefore(proxy, dateInput);
  dateInput.style.display = "none"; // keep enabled for submit

  const dv = (dateInput.value || "").trim();
  if (dv && dv.length >= 7) proxy.value = dv.slice(0, 7);

  proxy.setAttribute("max", _todayMonth());
  dateInput.setAttribute("max", _todayLocalYmd());

  function syncToOriginal() {
    const mv = (proxy.value || "").trim();
    dateInput.value = mv ? `${mv}-01` : "";
  }

  proxy.addEventListener("input", () => {
    syncToOriginal();
    dateInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  proxy.addEventListener("change", () => {
    syncToOriginal();
    dateInput.dispatchEvent(new Event("change", { bubbles: true }));
  });

  dateInput._hrmisMonthProxy = proxy;
  return proxy;
}

/* =========================================================
 * QUALIFICATION VALIDATIONS/IMPROVEMENTS
 * ========================================================= */
function _qualRows() {
  return _qsa(document, "#qual_rows .hrmis-repeat-row");
}
function _qualSelectedDegrees(exceptRow = null) {
  const set = new Set();
  _qualRows().forEach((r) => {
    if (exceptRow && r === exceptRow) return;
    const sel = _qs(r, 'select[name="qualification_degree[]"]');
    const v = (sel?.value || "").trim();
    if (v) set.add(v);
  });
  return set;
}
function _syncQualEndVisibility(row) {
  const statusSel = _qs(row, 'select[name="qualification_status[]"]');
  const chk = _qs(row, ".js-qual-completed");
  const wrap = _qs(row, ".js-qual-end-wrap");
  const end = _qs(row, 'input[name="qualification_end[]"]');
  if ((!statusSel && !chk) || !wrap || !end) return;

  const status = (statusSel?.value || "").trim();
  const isCompleted = statusSel ? status === "completed" : !!chk?.checked;

  if (isCompleted) {
    wrap.style.display = "";
    end.setAttribute("required", "required");
  } else {
    wrap.style.display = "none";
    end.removeAttribute("required");
    end.value = "";
    _clearError(end);
  }
}

function _syncQualStartMax(row) {
  const start = _qs(row, 'input[name="qualification_start[]"]');
  if (!start) return;
  start.setAttribute("max", _todayMonth());
}
function _syncQualEndMinMax(row) {
  const start = _qs(row, 'input[name="qualification_start[]"]');
  const end = _qs(row, 'input[name="qualification_end[]"]');
  if (!start || !end) return;

  end.setAttribute("max", _todayMonth());

  const sv = (start.value || "").trim();
  if (_isValidMonth(sv)) end.setAttribute("min", sv);
  else end.removeAttribute("min");
}
function _syncQualDegreeOptions() {
  const rows = _qualRows();

  rows.forEach((row) => {
    const sel = _qs(row, 'select[name="qualification_degree[]"]');
    if (!sel) return;

    Array.from(sel.options || []).forEach((opt) => {
      if (!opt) return;
      opt.hidden = false;
    });

    if (sel._hrmisRefreshCombobox) sel._hrmisRefreshCombobox();
  });
}

function _validateQualStartNotFuture(row) {
  const start = _qs(row, 'input[name="qualification_start[]"]');
  if (!start) return true;

  _clearError(start);

  const sv = (start.value || "").trim();
  if (_isEmpty(sv) || !_isValidMonth(sv)) return true;

  const tm = _todayMonth();
  if (_monthToIndex(sv) > _monthToIndex(tm)) {
    _showError(start, "Start month cannot be after current month");
    return false;
  }
  return true;
}
function _validateQualificationRow(row) {
  let ok = true;

  const start = _qs(row, 'input[name="qualification_start[]"]');
  const end = _qs(row, 'input[name="qualification_end[]"]');
  const statusSel = _qs(row, 'select[name="qualification_status[]"]');
  const chk = _qs(row, ".js-qual-completed");

  if (start) {
    if (!_validateQualStartNotFuture(row)) ok = false;
  }

  if (!end || (!statusSel && !chk)) return ok;

  _clearError(end);

  const status = (statusSel?.value || "").trim();
  const isCompleted = statusSel ? status === "completed" : !!chk?.checked;
  if (!isCompleted) return ok;

  const sv = (start?.value || "").trim();
  const ev = (end.value || "").trim();

  if (_isEmpty(sv) || !_isValidMonth(sv)) return ok;
  if (_isEmpty(ev) || !_isValidMonth(ev)) return ok;

  if (_monthToIndex(ev) < _monthToIndex(sv)) {
    _showError(end, "End month cannot be earlier than Start month");
    ok = false;
  }

  const tm = _todayMonth();
  if (_monthToIndex(ev) > _monthToIndex(tm)) {
    _showError(end, "End month cannot be after current month");
    ok = false;
  }

  return ok;
}
function _syncQualificationRow(row) {
  _syncQualEndVisibility(row);
  _syncQualStartMax(row);
  _syncQualEndMinMax(row);
  _syncQualDegreeOptions();
}

/* =========================================================
 * SEARCHABLE SELECT (Single input combobox)
 * ========================================================= */
function _isSelectSearchable(sel) {
  if (!sel) return false;
  if (sel.dataset.searchableApplied === "1") return false;
  if (sel.multiple) return false;
  if (sel.size && Number(sel.size) > 1) return false;
  if (sel.closest(".o_field_widget")) return false;
  return true;
}

function _enhanceSelect(select) {
  if (!_isSelectSearchable(select)) return;

  select.dataset.searchableApplied = "1";

  const wrap = document.createElement("div");
  wrap.className = "hrmis-combobox";
  wrap.style.position = "relative";

  const input = document.createElement("input");
  input.type = "text";
  input.className = select.className;
  input.autocomplete = "off";
  input.placeholder = "Type to search…";

  const dd = document.createElement("div");
  dd.className = "hrmis-combobox-dd";
  dd.style.position = "absolute";
  dd.style.left = "0";
  dd.style.right = "0";
  dd.style.top = "calc(100% + 6px)";
  dd.style.zIndex = "50";
  dd.style.background = "#fff";
  dd.style.border = "1px solid #dee2e6";
  dd.style.borderRadius = "12px";
  dd.style.boxShadow = "0 8px 24px rgba(0,0,0,0.10)";
  dd.style.maxHeight = "240px";
  dd.style.overflow = "auto";
  dd.style.display = "none";

  const parent = select.parentNode;
  parent.insertBefore(wrap, select);
  wrap.appendChild(input);
  wrap.appendChild(select);
  wrap.appendChild(dd);

  select.style.display = "none";
  input.disabled = !!select.disabled;

  // keep reference so _showError() can highlight the visible input
  select._hrmisComboboxInput = input;

  function getVisibleOptions() {
    const opts = Array.from(select.options || []);
    return opts.filter((o, idx) => {
      if (idx === 0 && (!o.value || o.disabled)) return false;
      if (!o.value) return false;
      if (o.hidden) return false;
      return true;
    });
  }

  function setDisplayFromSelect() {
    const selOpt = select.options[select.selectedIndex];
    input.value =
      selOpt && selOpt.value ? (selOpt.textContent || "").trim() : "";
  }
  function selectedLabel() {
    const selOpt = select.options[select.selectedIndex];
    return selOpt && selOpt.value ? (selOpt.textContent || "").trim() : "";
  }

  function clearSelection() {
    // reset select + visible input
    select.selectedIndex = 0;
    input.value = "";
    _clearError(select);
    _clearError(input);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function rebuildDD(query) {
    const q = (query || "").trim().toLowerCase();
    dd.innerHTML = "";

    const opts = getVisibleOptions().filter((o) => {
      if (!q) return true;
      return (o.textContent || "").toLowerCase().includes(q);
    });

    if (!opts.length) {
      const empty = document.createElement("div");
      empty.style.padding = "10px 12px";
      empty.style.color = "#6c757d";
      empty.textContent = "No matches";
      dd.appendChild(empty);
      return;
    }

    opts.forEach((opt) => {
      const item = document.createElement("div");
      item.style.padding = "10px 12px";
      item.style.cursor = "pointer";
      item.style.borderRadius = "10px";
      item.style.margin = "4px";
      item.textContent = (opt.textContent || "").trim();

      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "#f3f4f6"),
      );
      item.addEventListener("mouseleave", () => (item.style.background = ""));

      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        select.value = opt.value;
        setDisplayFromSelect();
        _clearError(select);
        _clearError(input);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        dd.style.display = "none";
      });

      dd.appendChild(item);
    });
  }

  function openDD() {
    if (input.disabled) return;

    // If input currently equals selected label, treat it as "no query"
    // so user sees full dropdown on click/focus.
    const q = (input.value || "").trim();
    const selLbl = selectedLabel();
    const effectiveQuery = q && selLbl && q === selLbl ? "" : q;

    rebuildDD(effectiveQuery);
    dd.style.display = "block";
  }
  function closeDD() {
    dd.style.display = "none";
  }

  // input.addEventListener("focus", openDD);
  // input.addEventListener("input", openDD);
  input.addEventListener("focus", () => {
    openDD();
    input.select();
  });

  input.addEventListener("mousedown", (e) => {
    if (input.disabled) return;
    e.stopPropagation();
    openDD();
  });

  input.addEventListener("input", () => {
    if ((input.value || "").trim() === "") {
      clearSelection();
      openDD();
      return;
    }
    openDD();
  });
  //   input.addEventListener("focus", () => {
  //   openDD();
  //   input.select();
  // });
  //   input.addEventListener("input", () => {
  //   // If user cleared the visible input, truly clear the select too
  //   if ((input.value || "").trim() === "") {
  //     clearSelection();
  //     openDD(); // optional: show full list immediately
  //     return;
  //   }
  //   openDD();
  // });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDD();
      input.blur();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      closeDD();

      // If user left it empty, don't restore from select (this was your bug #2)
      if ((input.value || "").trim() === "") return;

      // Otherwise, restore label from select (normal behavior)
      setDisplayFromSelect();
    }, 120);
  });

  // document.addEventListener("click", (e) => {
  //   if (!wrap.contains(e.target)) closeDD();
  // });

  select.addEventListener("change", setDisplayFromSelect);

  select._hrmisRefreshCombobox = () => {
    const selOpt = select.options[select.selectedIndex];
    if (selOpt && (selOpt.hidden || selOpt.style.display === "none")) {
      select.selectedIndex = 0;
    }
    setDisplayFromSelect();
    if (dd.style.display !== "none") rebuildDD(input.value || "");
  };

  setDisplayFromSelect();
}

function _initSearchableSelects(scopeRoot) {
  const root = scopeRoot || document;
  _qsa(root, "select").forEach((sel) => {
    if (!sel) return;
    if (sel.name === "hrmis_current_status_frontend") return;
    if (sel.classList.contains("js-no-search")) return;
    _enhanceSelect(sel);
  });
}

/* ---------------------------------------------------------
 * Digits-only enforcement (strict)
 * --------------------------------------------------------- */
// function _digitsOnly(input, { maxLen = null } = {}) {
//   if (!input) return;

//   input.setAttribute("inputmode", "numeric");
//   input.setAttribute("autocomplete", "off");
//   if (maxLen) input.setAttribute("maxlength", String(maxLen));

//   input.addEventListener("keydown", (e) => {
//     const allowed =
//       e.key === "Backspace" ||
//       e.key === "Delete" ||
//       e.key === "Tab" ||
//       e.key === "ArrowLeft" ||
//       e.key === "ArrowRight" ||
//       e.key === "Home" ||
//       e.key === "End";

//     if (allowed) return;
//     if (e.ctrlKey || e.metaKey) return;

//     if (!/^\d$/.test(e.key)) {
//       e.preventDefault();
//       _showError(input, "Only numbers allowed");
//     } else {
//       _clearError(input);
//     }
//   });

//   input.addEventListener("paste", (e) => {
//     e.preventDefault();
//     const text =
//       (e.clipboardData || window.clipboardData).getData("text") || "";
//     let digits = text.replace(/\D/g, "");
//     if (maxLen) digits = digits.slice(0, maxLen);
//     input.value = digits;
//     input.dispatchEvent(new Event("input", { bubbles: true }));
//   });

//   input.addEventListener("input", () => {
//     const raw = input.value || "";
//     let digits = raw.replace(/\D/g, "");
//     if (maxLen) digits = digits.slice(0, maxLen);
//     if (digits !== raw) input.value = digits;
//   });
// }

/* ---------------------------------------------------------
 * Digits-only enforcement (strict)
 * --------------------------------------------------------- */
function _digitsOnly(input, { maxLen = null } = {}) {
  if (!input) return;

  input.setAttribute("inputmode", "numeric");
  input.setAttribute("autocomplete", "off");
  if (maxLen) input.setAttribute("maxlength", String(maxLen));

  input.addEventListener("keydown", (e) => {
    const allowed =
      e.key === "Backspace" ||
      e.key === "Delete" ||
      e.key === "Tab" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === "Enter";

    if (allowed || e.ctrlKey || e.metaKey) {
      return;
    }

    if (!/[0-9]/.test(e.key)) {
      e.preventDefault();
      _showError(input, "Only numbers allowed");
    } else {
      _clearError(input);
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text") || "";
    let digits = text.replace(/\D/g, "");

    if (maxLen) {
      digits = digits.slice(0, maxLen);
    }

    input.value = digits;
    _clearError(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  input.addEventListener("input", () => {
    const raw = input.value || "";
    let digits = raw.replace(/\D/g, "");

    if (maxLen) {
      digits = digits.slice(0, maxLen);
    }

    if (digits !== raw) {
      input.value = digits;
    }

    if (digits) {
      _clearError(input);
    }
  });

  input.addEventListener("blur", () => {
  const raw = input.value || "";
  const digits = raw.replace(/\D/g, "");

  if (digits) {
    _clearError(input);
  }
});
}


/* ---------------------------------------------------------
 * Joining/Current BPS helpers
 * --------------------------------------------------------- */
function _joiningMonthValue(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]'); // hidden date YYYY-MM-DD
  const v = (joining?.value || "").trim();
  return v ? v.slice(0, 7) : "";
}
function _currentBpsValue(form) {
  const bps = _qs(form, '[name="hrmis_bps"]');
  return _normInt(bps?.value);
}

/* ---------------------------------------------------------
 * PMDC fields required only for specific cadres
 *   - General
 *   - Special
 *   - Health Management
 * --------------------------------------------------------- */
function _cadreSelectedLabel(form) {
  const sel = _qs(form, 'select[name="hrmis_cadre"]');
  if (!sel) return "";
  const opt = sel.options?.[sel.selectedIndex];
  return (opt?.textContent || "").trim();
}

function _cadreRequiresPmdc(form) {
  const label = _cadreSelectedLabel(form).toLowerCase();
  return ["general", "specialist", "health management"].includes(label);
}

function _syncPmdcRequiredByCadre(form) {
  if (!form) return;

  const needs = _cadreRequiresPmdc(form);
  const fields = [
    _qs(form, '[name="hrmis_pmdc_no"]'),
    _qs(form, '[name="hrmis_pmdc_issue_date"]'),
    _qs(form, '[name="hrmis_pmdc_expiry_date"]'),
  ];

  fields.forEach((inp) => {
    if (!inp) return;
    if (needs) {
      inp.setAttribute("required", "required");
    } else {
      inp.removeAttribute("required");
      // clear any previous error when it becomes optional
      _clearError(inp);
    }
  });

  // Toggle the * marker visibility
  _qsa(form, ".js-pmdc-req").forEach((star) => {
    star.style.display = needs ? "" : "none";
  });

  return needs;
}

/* ---------------------------------------------------------
 * Template-based repeatable rows
 * --------------------------------------------------------- */
function _cloneFromTemplate(tplSelector, containerSelector) {
  const tpl = _qs(document, tplSelector);
  const container = _qs(document, containerSelector);
  if (!tpl || !container) return null;

  const row = tpl.content?.firstElementChild?.cloneNode(true);
  if (!row) return null;

  _qsa(row, "input").forEach((inp) => {
    const type = (inp.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox" || type === "radio") inp.checked = false;
    else inp.value = "";

    // IMPORTANT: ensure previous posting start never gets auto-filled
    if (inp.name === "posting_start[]") inp.value = "";

    _clearError(inp);
  });

  _qsa(row, "select").forEach((sel) => {
    sel.selectedIndex = 0;
    _clearError(sel);
  });

  container.appendChild(row);
  _initSearchableSelects(row);
  return row;
}

/* ---------------------------------------------------------
 * Current Posting Start validation
 * --------------------------------------------------------- */
function _validateCurrentPostingStart(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]'); // hidden date
  const currentStart = _qs(form, '[name="current_posting_start"]'); // YYYY-MM
  if (!joining || !currentStart) return true;

  _clearError(currentStart);

  const joiningVal = (joining.value || "").trim();
  const currentVal = (currentStart.value || "").trim();

  if (_isEmpty(joiningVal)) {
    _showError(currentStart, "Please select Joining Date first");
    return false;
  }

  const joiningMonth = joiningVal.slice(0, 7);
  if (!_isValidMonth(joiningMonth)) {
    _showError(currentStart, "Joining Date is invalid");
    return false;
  }

  if (_isEmpty(currentVal) || !_isValidMonth(currentVal)) {
    _showError(currentStart, "Current Posting Start is required (YYYY-MM)");
    return false;
  }

  if (_monthToIndex(currentVal) < _monthToIndex(joiningMonth)) {
    _showError(
      currentStart,
      "Current Posting Start cannot be before Joining Month",
    );
    return false;
  }

  const tm = _todayMonth();
  if (_monthToIndex(currentVal) > _monthToIndex(tm)) {
    _showError(
      currentStart,
      "Current Posting Start cannot be after current month",
    );
    return false;
  }

  return true;
}

/* ---------------------------------------------------------
 * DOB vs Commission year rule
 *  - Commission is month-proxy (YYYY-MM) stored as YYYY-MM-01
 *  - Requirement: Commission year cannot be before Date of Birth year
 * --------------------------------------------------------- */
function _validateDobCommission(form) {
  const dob = _qs(form, '[name="birthday"]'); // date YYYY-MM-DD
  const commission = _qs(form, '[name="hrmis_commission_date"]'); // hidden date YYYY-MM-DD
  if (!dob || !commission) return true;

  const commissionUI = commission._hrmisMonthProxy || null;
  const cErrTarget = commissionUI || commission;

  _clearError(cErrTarget);

  const dobVal = (dob.value || "").trim();
  const cv = (commission.value || "").trim();
  if (_isEmpty(dobVal) || _isEmpty(cv)) return true;

  // Commission is month-granular; enforce month >= DOB month.
  const minMonth = dobVal.length >= 7 ? dobVal.slice(0, 7) : "";
  const commMonth = cv.length >= 7 ? cv.slice(0, 7) : "";
  if (!_isValidMonth(minMonth) || !_isValidMonth(commMonth)) return true;

  if (_monthToIndex(commMonth) < _monthToIndex(minMonth)) {
    _showError(cErrTarget, "Commission month cannot be before Date of Birth");
    return false;
  }
  return true;
}

function _syncCommissionMinFromDob(form) {
  const dob = _qs(form, '[name="birthday"]'); // date YYYY-MM-DD
  const commission = _qs(form, '[name="hrmis_commission_date"]'); // hidden date YYYY-MM-DD
  if (!dob || !commission) return;

  const dobVal = (dob.value || "").trim();
  const minMonth = dobVal.length >= 7 ? dobVal.slice(0, 7) : "";

  const commissionUI = commission._hrmisMonthProxy || null;
  const cUi = commissionUI || null;

  if (_isValidMonth(minMonth)) {
    if (cUi) cUi.setAttribute("min", minMonth);
    commission.setAttribute("min", `${minMonth}-01`);
  } else {
    if (cUi) cUi.removeAttribute("min");
    commission.removeAttribute("min");
    return;
  }

  // Clamp existing value into min range.
  const curMonth =
    (cUi && (cUi.value || "").trim()) ||
    (commission.value || "").trim().slice(0, 7) ||
    "";
  if (
    _isValidMonth(curMonth) &&
    _monthToIndex(curMonth) < _monthToIndex(minMonth)
  ) {
    if (cUi) cUi.value = minMonth;
    commission.value = `${minMonth}-01`;
  }
}

/* ---------------------------------------------------------
 * Joining vs Commission date rule (compares submitted dates)
 * --------------------------------------------------------- */
function _validateJoiningCommission(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]'); // hidden date YYYY-MM-DD
  const commission = _qs(form, '[name="hrmis_commission_date"]'); // hidden date YYYY-MM-DD
  if (!joining || !commission) return true;

  const joiningUI = joining._hrmisMonthProxy || null;
  const commissionUI = commission._hrmisMonthProxy || null;

  const jErrTarget = joiningUI || joining;
  const cErrTarget = commissionUI || commission;

  _clearError(jErrTarget);
  _clearError(cErrTarget);

  const jv = (joining.value || "").trim();
  const cv = (commission.value || "").trim();
  if (_isEmpty(jv) || _isEmpty(cv)) return true;

  const j = new Date(jv + "T00:00:00");
  const c = new Date(cv + "T00:00:00");

  if (j < c) {
    _showError(jErrTarget, "Joining Date cannot be before Commission Date");
    _showError(cErrTarget, "Commission Date cannot be after Joining Date");
    return false;
  }
  return true;
}

/* ---------------------------------------------------------
 * CNIC strict formatter: #####-#######-#
 * --------------------------------------------------------- */
function _initCNIC(form) {
  const cnicInput = _qs(form, '[name="hrmis_cnic"]');
  if (!cnicInput) return;

  const cnicRegex = /^\d{5}-\d{7}-\d{1}$/;

  cnicInput.setAttribute("inputmode", "numeric");
  cnicInput.setAttribute("autocomplete", "off");
  cnicInput.setAttribute("maxlength", "15");

  function formatCNIC(digits) {
    digits = (digits || "").replace(/\D/g, "").slice(0, 13);
    const p1 = digits.slice(0, 5);
    const p2 = digits.slice(5, 12);
    const p3 = digits.slice(12, 13);

    let out = p1;
    if (digits.length > 5) out += "-" + p2;
    if (digits.length > 12) out += "-" + p3;
    return out;
  }

  cnicInput.addEventListener("keydown", (e) => {
    const allowed =
      e.key === "Backspace" ||
      e.key === "Delete" ||
      e.key === "Tab" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "Home" ||
      e.key === "End";
    if (allowed) return;
    if (e.ctrlKey || e.metaKey) return;

    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      _showError(cnicInput, "CNIC format: 12345-1234567-1");
    }
  });

  cnicInput.addEventListener("paste", (e) => {
    e.preventDefault();
    const text =
      (e.clipboardData || window.clipboardData).getData("text") || "";
    const digits = text.replace(/\D/g, "");
    cnicInput.value = formatCNIC(digits);
    cnicInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  cnicInput.addEventListener("input", () => {
    const digits = (cnicInput.value || "").replace(/\D/g, "");
    const formatted = formatCNIC(digits);
    cnicInput.value = formatted;

    if (formatted && !cnicRegex.test(formatted)) {
      _showError(cnicInput, "CNIC format: 12345-1234567-1");
    } else {
      _clearError(cnicInput);
    }
  });
}

/* ---------------------------------------------------------
 * Contact strict: must be 03 + 9 digits (total 11)
 * --------------------------------------------------------- */
function _initContact(form) {
  const contactInput = _qs(form, '[name="hrmis_contact_info"]');
  if (!contactInput) return;

  const contactRegex = /^03\d{9}$/;

  contactInput.setAttribute("inputmode", "numeric");
  contactInput.setAttribute("autocomplete", "off");
  contactInput.setAttribute("maxlength", "11");

  function normalize() {
    let v = (contactInput.value || "").replace(/\D/g, "");
    if (!v.startsWith("03")) v = "03" + v.replace(/^0+/, "");
    v = v.slice(0, 11);
    if (v.length < 2) v = "03";
    contactInput.value = v;
  }

  if (_isEmpty(contactInput.value)) {
    contactInput.value = "03";
    contactInput.setSelectionRange?.(2, 2);
  } else {
    normalize();
  }

  contactInput.addEventListener("keydown", (e) => {
    const pos = contactInput.selectionStart || 0;

    const allowed =
      e.key === "Tab" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight" ||
      e.key === "Home" ||
      e.key === "End";
    if (allowed) return;

    if (e.key === "Backspace" && pos <= 2) {
      e.preventDefault();
      contactInput.value = "03";
      contactInput.setSelectionRange?.(2, 2);
      return;
    }

    if (e.key === "Delete" && pos < 2) {
      e.preventDefault();
      contactInput.value = "03";
      contactInput.setSelectionRange?.(2, 2);
      return;
    }

    if (e.ctrlKey || e.metaKey) return;

    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      _showError(contactInput, "Contact must be digits only");
    }
  });

  contactInput.addEventListener("paste", (e) => {
    e.preventDefault();
    const text =
      (e.clipboardData || window.clipboardData).getData("text") || "";
    let v = text.replace(/\D/g, "");
    if (!v.startsWith("03")) v = "03" + v.replace(/^0+/, "");
    v = v.slice(0, 11);
    contactInput.value = v;
    contactInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  contactInput.addEventListener("focus", () => {
    normalize();
    contactInput.setSelectionRange?.(
      contactInput.value.length,
      contactInput.value.length,
    );
  });

  contactInput.addEventListener("input", () => {
    normalize();

    if (contactInput.value && !contactRegex.test(contactInput.value)) {
      _showError(
        contactInput,
        "Contact must be 11 digits and start with 03 (e.g., 03XXXXXXXXX)",
      );
    } else {
      _clearError(contactInput);
    }
  });
}

/* ---------------------------------------------------------
 * Date helpers (YYYY-MM-DD local)
 * --------------------------------------------------------- */
function _parseLocalYmd(ymd) {
  const s = String(ymd || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(y, mo - 1, d);
}
function _addDaysLocalYmd(ymd, days) {
  const base = _parseLocalYmd(ymd);
  if (!base) return "";
  base.setDate(base.getDate() + Number(days || 0));
  return _toLocalYmd(base);
}
function _yesterdayLocalYmd() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return _toLocalYmd(d);
}

/* =========================================================
 * Leave datepicker + overlap logic (unchanged)
 * ========================================================= */
let _hrmisLeaveDatePickerStyleInjected = false;
let _hrmisLeaveDatePickerPopup = null;
let _hrmisLeaveDatePickerState = null; // { input, monthDate, min, max, disabledRanges }

function _injectHrmisLeaveDatePickerStyles() {
  if (_hrmisLeaveDatePickerStyleInjected) return;
  _hrmisLeaveDatePickerStyleInjected = true;
  const css = `
      .hrmis-datepop{position:absolute;z-index:100000;background:#fff;border:1px solid #e5e7eb;border-radius:12px;
        box-shadow:0 8px 28px rgba(0,0,0,.12);padding:10px;min-width:280px;font-family:inherit}
      .hrmis-datepop__head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
      .hrmis-datepop__btn{border:1px solid #e5e7eb;background:#f9fafb;border-radius:10px;padding:6px 10px;cursor:pointer}
      .hrmis-datepop__btn:disabled{opacity:.5;cursor:not-allowed}
      .hrmis-datepop__title{font-weight:700;color:#111827}
      .hrmis-datepop__grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
      .hrmis-datepop__dow{font-size:12px;color:#6b7280;text-align:center;font-weight:700}
      .hrmis-datepop__day{height:34px;border:1px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer}
      .hrmis-datepop__day[disabled]{opacity:.35;cursor:not-allowed;background:#f3f4f6}
      .hrmis-datepop__day.is-selected{background:#2563eb;border-color:#2563eb;color:#fff}
      .hrmis-datepop__day.is-today{border-color:#9ca3af}
    `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
function _ensureHrmisLeaveDatePickerPopup() {
  _injectHrmisLeaveDatePickerStyles();
  if (_hrmisLeaveDatePickerPopup) return _hrmisLeaveDatePickerPopup;
  const el = document.createElement("div");
  el.className = "hrmis-datepop";
  el.style.display = "none";
  document.body.appendChild(el);
  _hrmisLeaveDatePickerPopup = el;

  document.addEventListener("mousedown", (ev) => {
    if (
      !_hrmisLeaveDatePickerPopup ||
      _hrmisLeaveDatePickerPopup.style.display === "none"
    )
      return;
    const t = ev.target;
    if (
      t &&
      (_hrmisLeaveDatePickerPopup.contains(t) ||
        (_hrmisLeaveDatePickerState?.input &&
          _hrmisLeaveDatePickerState.input.contains(t)))
    )
      return;
    _closeHrmisLeaveDatePicker();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") _closeHrmisLeaveDatePicker();
  });

  return el;
}
function _closeHrmisLeaveDatePicker() {
  if (_hrmisLeaveDatePickerPopup)
    _hrmisLeaveDatePickerPopup.style.display = "none";
  _hrmisLeaveDatePickerState = null;
}
function _startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function _daysInMonthLocal(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function _ymdForLocal(y, m0, day) {
  return _toLocalYmd(new Date(y, m0, day));
}
function _inDisabledRanges(ymd, ranges) {
  if (!ymd || !ranges || !ranges.length) return false;
  for (const r of ranges) {
    if (!r || !r.start || !r.end) continue;
    if (ymd >= r.start && ymd <= r.end) return true;
  }
  return false;
}
function _nextEnabledYmd(fromYmd, toYmd, disabledRanges) {
  if (_isEmpty(fromYmd) || _isEmpty(toYmd)) return "";
  const from = _parseLocalYmd(fromYmd);
  const to = _parseLocalYmd(toYmd);
  if (!from || !to) return "";
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  if (from.getTime() > to.getTime()) return "";

  const d = new Date(from);
  const maxIter = 365 * 50;
  let i = 0;
  while (d.getTime() <= to.getTime() && i < maxIter) {
    const ymd = _toLocalYmd(d);
    if (!_inDisabledRanges(ymd, disabledRanges)) return ymd;
    d.setDate(d.getDate() + 1);
    i++;
  }
  return "";
}
function _getAttrSafe(input, name) {
  try {
    return (input && input.getAttribute && input.getAttribute(name)) || "";
  } catch {
    return "";
  }
}
function _getJoiningMinLeaveStartYmd() {
  const form = _qs(document, ".hrmis-form");
  const joining = _qs(form, '[name="hrmis_joining_date"]')?.value || "";
  const d = _parseLocalYmd(joining);
  if (!d) return "";
  return _addDaysLocalYmd(joining, 1);
}

function _renderHrmisLeaveDatePicker() {
  const popup = _ensureHrmisLeaveDatePickerPopup();
  const st = _hrmisLeaveDatePickerState;
  if (!popup || !st || !st.input) return;

  const monthDate = _startOfMonth(st.monthDate || new Date());
  const y = monthDate.getFullYear();
  const m0 = monthDate.getMonth();
  const selected = (st.input.value || "").trim();
  const today = _todayLocalYmd();

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const prevMonth = new Date(y, m0 - 1, 1);
  const nextMonth = new Date(y, m0 + 1, 1);
  const min = st.min || "";
  const max = st.max || "";
  const prevOk =
    !min ||
    _toLocalYmd(
      new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0),
    ) >= min;
  const nextOk =
    !max ||
    _toLocalYmd(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1)) <=
      max;

  let minYear = 1900;
  let maxYear = new Date().getFullYear();
  const minD = _parseLocalYmd(min);
  const maxD = _parseLocalYmd(max);
  if (minD) minYear = minD.getFullYear();
  if (maxD) maxYear = maxD.getFullYear();
  if (minYear > maxYear) {
    minYear = 1900;
    maxYear = new Date().getFullYear();
  }

  popup.innerHTML = `
      <div class="hrmis-datepop__head">
        <button type="button" class="hrmis-datepop__btn js-prev"${prevOk ? "" : " disabled"}>&lt;</button>
        <div style="display:flex; align-items:center; gap:8px;">
          <select class="hrmis-datepop__btn js-month" aria-label="Month">
            ${monthNames.map((nm, idx) => `<option value="${idx}"${idx === m0 ? " selected" : ""}>${nm}</option>`).join("")}
          </select>
          <input class="hrmis-datepop__btn js-year" aria-label="Year" type="number" inputmode="numeric"
                 style="width:88px; text-align:center;" value="${y}"
                 min="${minYear}" max="${maxYear}" step="1"/>
        </div>
        <button type="button" class="hrmis-datepop__btn js-next"${nextOk ? "" : " disabled"}>&gt;</button>
      </div>
      <div class="hrmis-datepop__grid js-grid"></div>
    `;

  const grid = popup.querySelector(".js-grid");
  if (!grid) return;

  const dows = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  for (const d of dows) {
    const dow = document.createElement("div");
    dow.className = "hrmis-datepop__dow";
    dow.textContent = d;
    grid.appendChild(dow);
  }

  const firstDay = new Date(y, m0, 1).getDay();
  const days = _daysInMonthLocal(monthDate);
  for (let i = 0; i < firstDay; i++)
    grid.appendChild(document.createElement("div"));

  for (let day = 1; day <= days; day++) {
    const ymd = _ymdForLocal(y, m0, day);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hrmis-datepop__day";
    btn.textContent = String(day);

    const disabled =
      (min && ymd < min) ||
      (max && ymd > max) ||
      _inDisabledRanges(ymd, st.disabledRanges);

    if (disabled) btn.disabled = true;
    if (ymd === selected) btn.classList.add("is-selected");
    if (ymd === today) btn.classList.add("is-today");

    btn.addEventListener("click", () => {
      st.input.value = ymd;
      st.input.dispatchEvent(new Event("change", { bubbles: true }));
      _closeHrmisLeaveDatePicker();
    });
    grid.appendChild(btn);
  }

  popup.querySelector(".js-prev")?.addEventListener("click", () => {
    _hrmisLeaveDatePickerState.monthDate = prevMonth;
    _renderHrmisLeaveDatePicker();
  });
  popup.querySelector(".js-next")?.addEventListener("click", () => {
    _hrmisLeaveDatePickerState.monthDate = nextMonth;
    _renderHrmisLeaveDatePicker();
  });

  const monthSel = popup.querySelector(".js-month");
  const yearInp = popup.querySelector(".js-year");

  if (monthSel) {
    monthSel.addEventListener("change", () => {
      const newM0 = parseInt(monthSel.value, 10);
      if (Number.isNaN(newM0)) return;
      _hrmisLeaveDatePickerState.monthDate = new Date(y, newM0, 1);
      _renderHrmisLeaveDatePicker();
    });
  }

  if (yearInp) {
    const clampYear = (yr) => {
      const n = parseInt(String(yr), 10);
      if (Number.isNaN(n)) return y;
      return Math.min(maxYear, Math.max(minYear, n));
    };
    const applyYear = (raw) => {
      const newY = clampYear(raw);
      yearInp.value = String(newY);
      _hrmisLeaveDatePickerState.monthDate = new Date(newY, m0, 1);
      _renderHrmisLeaveDatePicker();
    };

    yearInp.addEventListener("input", () => {
      const v = String(yearInp.value || "").trim();
      if (!/^\d{1,4}$/.test(v)) return;
      if (v.length < 4) return;
      applyYear(v);
    });
    yearInp.addEventListener("change", () => applyYear(yearInp.value));
    yearInp.addEventListener("blur", () => applyYear(yearInp.value));
    yearInp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applyYear(yearInp.value);
      }
    });

    yearInp.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const delta = ev.deltaY > 0 ? -1 : 1;
        const newY = clampYear((parseInt(yearInp.value, 10) || y) + delta);
        yearInp.value = String(newY);
        _hrmisLeaveDatePickerState.monthDate = new Date(newY, m0, 1);
        _renderHrmisLeaveDatePicker();
      },
      { passive: false },
    );

    yearInp.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown") return;
      ev.preventDefault();
      const delta = ev.key === "ArrowUp" ? 1 : -1;
      const newY = clampYear((parseInt(yearInp.value, 10) || y) + delta);
      yearInp.value = String(newY);
      _hrmisLeaveDatePickerState.monthDate = new Date(newY, m0, 1);
      _renderHrmisLeaveDatePicker();
    });
  }
}

function _openHrmisLeaveDatePicker(
  input,
  { min = "", max = "", disabledRanges = [], openTo = "" } = {},
) {
  const popup = _ensureHrmisLeaveDatePickerPopup();
  if (!popup) return;
  const rect = input.getBoundingClientRect();
  _hrmisLeaveDatePickerState = {
    input,
    monthDate:
      _parseLocalYmd(input.value) || _parseLocalYmd(openTo) || new Date(),
    min,
    max,
    disabledRanges,
  };
  _renderHrmisLeaveDatePicker();
  popup.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
  popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popup.style.display = "block";
}

function _attachHrmisLeaveDatePicker(input, getOptions) {
  if (!input || input._hrmisLeaveDatePickerAttached) return;
  input._hrmisLeaveDatePickerAttached = true;
  try {
    input.type = "text";
  } catch {
    // ignore
  }
  input.setAttribute("inputmode", "none");
  input.setAttribute("autocomplete", "off");
  input.readOnly = true;

  input.addEventListener("click", () => {
    if (input.disabled) return;
    const opts = (typeof getOptions === "function" ? getOptions() : {}) || {};
    _openHrmisLeaveDatePicker(input, opts);
  });
  input.addEventListener("focus", () => {
    if (input.disabled) return;
    const opts = (typeof getOptions === "function" ? getOptions() : {}) || {};
    _openHrmisLeaveDatePicker(input, opts);
  });
}

function _rangesOverlapYmd(aStart, aEnd, bStart, bEnd) {
  if (_isEmpty(aStart) || _isEmpty(aEnd) || _isEmpty(bStart) || _isEmpty(bEnd))
    return false;
  return !(aEnd < bStart || aStart > bEnd);
}
function _collectLeaveRanges(excludeRow) {
  const out = [];
  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
    if (excludeRow && row === excludeRow) return;
    const start = _qs(row, 'input[name="leave_start[]"]')?.value || "";
    const end = _qs(row, 'input[name="leave_end[]"]')?.value || "";
    if (_isEmpty(start) || _isEmpty(end)) return;
    if (!_parseLocalYmd(start) || !_parseLocalYmd(end)) return;
    out.push({ start, end });
  });
  return out;
}

/* (leave gender filter + overlap + constraints + calc: unchanged from your file) */
function _syncLeaveTypeSelectsByGender(form) {
  const genderEl = _qs(form, '[name="gender"]');
  const gender = String(genderEl?.value || "")
    .trim()
    .toLowerCase();

  const selects = _qsa(document, '#leave_rows select[name="leave_type_id[]"]');
  if (!selects.length) return;

  for (const sel of selects) {
    if (!(sel instanceof HTMLSelectElement)) continue;

    // No gender -> disable + red look + message
    if (!gender) {
      sel.value = "";
      _setComboboxDisabled(sel, true, "Please select the gender first.");
      continue;
    }

    // Gender selected -> enable + clear red
    _setComboboxDisabled(sel, false);

    const isMale = gender === "male";

    for (const opt of Array.from(sel.options || [])) {
      if (!opt || !opt.value) continue;
      const txt = String(opt.textContent || "")
        .trim()
        .toLowerCase();
      const isMaternity = txt.includes("maternity");
      opt.hidden = !!(isMale && isMaternity);
    }

    const cur = sel.selectedOptions?.[0];
    if (cur && cur.hidden) sel.selectedIndex = 0;

    if (sel._hrmisRefreshCombobox) sel._hrmisRefreshCombobox();
  }
}

function _applyLeaveOverlapRule(row, changedEl) {
  const startEl = _qs(row, 'input[name="leave_start[]"]');
  const endEl = _qs(row, 'input[name="leave_end[]"]');
  if (!startEl || !endEl) return true;

  // ✅ If joining date isn't selected (or fields are disabled),
  // don't clear errors that were set by _syncLeaveRowDateConstraints.
  const joinMin = _getJoiningMinLeaveStartYmd();
  if (!joinMin || startEl.disabled || endEl.disabled) {
    return true; // overlap rule irrelevant right now
  }

  // (now it's safe to clear overlap-related errors)
  if (changedEl) changedEl.setCustomValidity("");
  _clearError(startEl);
  _clearError(endEl);

  const s = (startEl.value || "").trim();
  const e = (endEl.value || "").trim();

  const others = _collectLeaveRanges(row);

  if (s && !e) {
    const hit = others.find((r) => _rangesOverlapYmd(s, s, r.start, r.end));
    if (hit) {
      const msg = `This date overlaps an existing leave (${hit.start} to ${hit.end}).`;
      _showError(startEl, msg);
      startEl.setCustomValidity(msg);
      startEl.value = "";
      return false;
    }
    return true;
  }

  if (s && e) {
    const hit = others.find((r) => _rangesOverlapYmd(s, e, r.start, r.end));
    if (hit) {
      const msg = `These dates overlap an existing leave (${hit.start} to ${hit.end}).`;
      const target = changedEl || endEl;
      _showError(target, msg);
      target.setCustomValidity(msg);
      if (target === startEl) startEl.value = "";
      if (target === endEl) endEl.value = "";
      return false;
    }
  }

  return true;
}

function _syncLeaveRowDateConstraints(row) {
  const start = _qs(row, 'input[name="leave_start[]"]');
  const end = _qs(row, 'input[name="leave_end[]"]');
  if (!start || !end) return;

  const yesterday = _yesterdayLocalYmd();
  const today = _todayLocalYmd();
  const joinMin = _getJoiningMinLeaveStartYmd();

  if (!joinMin) {
    start.disabled = true;
    end.disabled = true;
    start.value = "";
    end.value = "";
    const msg = "Please select the joining date first.";
    _showError(start, msg);
    _showError(end, msg);
    return;
  }

  if (joinMin && yesterday && joinMin > yesterday) {
    start.disabled = true;
    end.disabled = true;
    start.value = "";
    end.value = "";
    const msg = "Leave history cannot be added before your joining date.";
    _showError(start, msg);
    _showError(end, msg);
    return;
  }

  start.disabled = false;
  _clearError(start);
  _clearError(end);

  start.min = joinMin;
  start.max = yesterday;

  if (start.value && start.value > yesterday) start.value = yesterday;
  if (joinMin && start.value && start.value < joinMin) start.value = joinMin;

  _ensureNativeDateInput(start);

  if (!start.value) {
    end.disabled = true;
    end.min = joinMin || "";
    end.max = today;
    if (end.value) end.value = "";
    _ensureNativeDateInput(end);
    _applyLeaveOverlapRule(row, start);
    return;
  }

  end.disabled = false;

  const minEnd = _addDaysLocalYmd(start.value, 7);
  end.min = minEnd || "";
  end.max = today;

  const disabledRanges = _collectLeaveRanges(row);
  const curEnd = (end.value || "").trim();
  const minBound = (end.min || "").trim();
  const maxBound = (end.max || "").trim();

  const needsDefault =
    _isEmpty(curEnd) ||
    (minBound && curEnd < minBound) ||
    (maxBound && curEnd > maxBound) ||
    _inDisabledRanges(curEnd, disabledRanges);

  if (needsDefault && minBound && maxBound && minBound <= maxBound) {
    const next = _nextEnabledYmd(minBound, maxBound, disabledRanges);
    if (next) end.value = next;
  }

  _ensureNativeDateInput(end);

  if (end.min && end.max && end.min > end.max) {
    end.disabled = true;
    end.value = "";
    return;
  }

  if (end.value) {
    if (end.min && end.value < end.min) end.value = end.min;
    if (end.max && end.value > end.max) end.value = end.max;
  }
  _applyLeaveOverlapRule(row, end);
}

/* leave contribution calc */
function _normLeaveTypeForCalc(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}
function _leaveContributionFromTypeName(name, effectiveDays) {
  const s = _normLeaveTypeForCalc(name);

  if (
    s.includes("without pay") ||
    s.includes("unpaid") ||
    s.includes(" eol") ||
    s.includes("eol") ||
    s.includes("medical") ||
    s.includes("maternity")
  )
    return 0;

  if (s.includes("half pay"))
    return Math.ceil((Number(effectiveDays || 0) || 0) / 2);

  if (s.includes("full pay") || s.includes("earned") || s.includes("lpr"))
    return Number(effectiveDays || 0) || 0;

  return 0;
}
function _daysInclusiveLocal(startYmd, endYmd) {
  const s = _parseLocalYmd(startYmd);
  const e = _parseLocalYmd(endYmd);
  if (!s || !e) return 0;
  s.setHours(0, 0, 0, 0);
  e.setHours(0, 0, 0, 0);
  const ms = e.getTime() - s.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}
function _recalcLeavesTaken(form) {
  const out = _qs(form, 'input[name="hrmis_leaves_taken"]');
  if (!out) return;

  let total = 0;
  let hasAny = false;

  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
    const typeSel = _qs(row, 'select[name="leave_type_id[]"]');
    const start = _qs(row, 'input[name="leave_start[]"]');
    const end = _qs(row, 'input[name="leave_end[]"]');
    if (!typeSel || !start || !end) return;
    if (_isEmpty(typeSel.value) || _isEmpty(start.value) || _isEmpty(end.value))
      return;

    hasAny = true;
    const optText = typeSel.selectedOptions?.[0]?.textContent || "";
    const days = _daysInclusiveLocal(start.value, end.value);
    if (!days) return;
    total += _leaveContributionFromTypeName(optText, days);
  });

  out.value = String(total || 0);
}
/** @odoo-module **/

import publicWidget from "@web/legacy/js/public/public_widget";

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}
function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _setContainerEnabled(container, enabled) {
  const els = _qsa(container, "input, select, textarea");

  els.forEach((el) => {
    // Save original required once
    if (!el.dataset.origRequired) {
      el.dataset.origRequired = el.required ? "1" : "0";
    }

    // Disable/enable
    el.disabled = !enabled;

    // Required only when enabled AND originally required
    el.required = enabled && el.dataset.origRequired === "1";
  });
}

function _toggleStatusBoxes(form) {
  const statusSel = _qs(form, 'select[name="hrmis_current_status_frontend"]');
  if (!statusSel) return;

  const status = statusSel.value || "";
  console.warn("[POSTING_STATUS] status=", status);

  const boxes = _qsa(form, ".js-status-box");
  boxes.forEach((box) => {
    const boxStatus = box.getAttribute("data-status") || "";
    const active = boxStatus === status;

    box.style.display = active ? "" : "none";
    _setContainerEnabled(box, active);

    console.warn("[POSTING_STATUS] box", boxStatus, "active=", active);
  });

  // Also handle allowed-to-work dependent blocks (optional)
  _qsa(form, ".js-status-dependent").forEach((wrap) => {
    const statuses = (wrap.getAttribute("data-statuses") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const shouldShow = statuses.includes(status);
    wrap.style.display = shouldShow ? "" : "none";
    _setContainerEnabled(wrap, shouldShow);
  });
}

/* Removed legacy publicWidget status toggle to avoid duplicate status logic. */

/* ---------------------------------------------------------
 * Dates (basic max=today)
 * --------------------------------------------------------- */
function _initDates(form) {
  const today = _todayLocalYmd();
  ["hrmis_joining_date", "hrmis_commission_date"].forEach((name) => {
    const input = _qs(form, `[name="${name}"]`);
    if (input) input.setAttribute("max", today);
  });
}

/* ---------------------------------------------------------
 * Profile date pickers
 *  - DOB uses calendar widget
 *  - Commission/Joining are month-proxy fields (handled elsewhere)
 * --------------------------------------------------------- */
function _initProfileDatePickers(form) {
  const dob = _qs(form, '[name="birthday"]');
  if (dob) {
    _ensureNativeDateInput(dob);
    // Avoid double-binding on BFCache / repeated init.
    if (dob.dataset.hrmisDobCommissionBound === "1") return;
    dob.dataset.hrmisDobCommissionBound = "1";
    // Keep Commission-vs-DOB validation in sync.
    dob.addEventListener("change", () => {
      _syncCommissionMinFromDob(form);
      _validateDobCommission(form);
    });
    dob.addEventListener("blur", () => {
      _syncCommissionMinFromDob(form);
      _validateDobCommission(form);
    });
  }
}

/* =========================================================
 * Previous Posting (Manual Fill – No Auto Chain) — SINGLE, FIXED
 * ========================================================= */
function _postingRows() {
  return _qsa(document, "#prev_post_rows .hrmis-repeat-row");
}

function _applyPostingBpsMaxFromCurrent(form, row) {
  const bpsInp = _qs(row, 'input[name="posting_bps[]"]');
  if (!bpsInp) return;

  const currentBps = _currentBpsValue(form);
  if (currentBps !== null && currentBps >= 1)
    bpsInp.setAttribute("max", String(currentBps));
  else bpsInp.setAttribute("max", "22");
}

function _syncPostingBpsConstraints(form) {
  _postingRows().forEach((row) => _applyPostingBpsMaxFromCurrent(form, row));
}

function _validatePostingBpsAgainstCurrent(form, row) {
  const bpsInp = _qs(row, 'input[name="posting_bps[]"]');
  if (!bpsInp) return true;

  const v = _normInt(bpsInp.value);
  const currentBps = _currentBpsValue(form);

  _clearError(bpsInp);

  if (v === null || currentBps === null) return true;

  if (v > currentBps) {
    _showError(
      bpsInp,
      `Posting BPS cannot be greater than current BPS (${currentBps})`,
    );
    return false;
  }
  return true;
}

function _initPostingPrevChain(form) {
  // NOTE: Previous Posting History is always available now (like Qualifications)
  // and is NOT dependent on Current Posting Start vs Joining Month.
  const wrap = _qs(document, ".js-prev-posting-wrap");
  const container = _qs(document, "#prev_post_rows");
  if (!wrap || !container) return;

  // prevent double-binding if init is called again
  if (wrap.dataset.hrmisPrevPostingInited === "1") return;
  wrap.dataset.hrmisPrevPostingInited = "1";

  // ensure visible (server may still prefill rows)
  wrap.style.display = "";

  const resync = () => {
    _qsa(container, ".hrmis-repeat-row").forEach((r) => {
      _applyPostingBpsMaxFromCurrent(form, r);
      _syncPostingRowDateConstraints(form, r);
    });
  };

  // resync bounds whenever relevant inputs change
  const joining = _qs(form, '[name="hrmis_joining_date"]');
  const currentStart = _qs(form, '[name="current_posting_start"]');
  const bps = _qs(form, '[name="hrmis_bps"]');

  joining?.addEventListener("change", resync);
  currentStart?.addEventListener("change", resync);
  bps?.addEventListener("input", resync);
  bps?.addEventListener("change", resync);

  resync();
}
/* =========================================================
 * PROMOTION CHAIN (strict chain) — unchanged
 * ========================================================= */
function _promoRows() {
  return _qsa(document, "#promo_rows .hrmis-repeat-row");
}
function _promoRowIndex(row) {
  return _promoRows().indexOf(row);
}
function _lockInput(inp) {
  if (!inp) return;
  inp.readOnly = true;
  inp.style.pointerEvents = "none";
  inp.tabIndex = -1;
  inp.style.background = "#f3f4f6";
  inp.style.cursor = "not-allowed";
}
function _unlockInput(inp) {
  if (!inp) return;
  inp.readOnly = false;
  inp.style.pointerEvents = "";
  inp.tabIndex = 0;
  inp.style.background = "";
  inp.style.cursor = "";
}

function _togglePromoBpsToEnabled(form, row) {
  const to = _qs(row, 'input[name="promotion_bps_to[]"]');
  if (!to) return;

  const currentBps = _currentBpsValue(form);
  const enabled = currentBps !== null && currentBps >= 1;
  to.disabled = !enabled;
  if (!enabled) {
    to.value = "";
    _clearError(to);
    _setHint(to, "Fill Current BPS first to enable Promotion BPS To.");
  } else {
    _setHint(to, "");
  }
}
function _applyPromoBpsToMaxFromCurrent(form, row) {
  const to = _qs(row, 'input[name="promotion_bps_to[]"]');
  if (!to) return;

  const currentBps = _currentBpsValue(form);
  if (currentBps !== null && currentBps >= 1)
    to.setAttribute("max", String(currentBps));
  else to.setAttribute("max", "22");
}
function _applyPromoToMinFromFrom(row) {
  const from = _qs(row, 'input[name="promotion_bps_from[]"]');
  const to = _qs(row, 'input[name="promotion_bps_to[]"]');
  if (!from || !to) return;

  const f = _normInt(from.value);
  if (f !== null) to.setAttribute("min", String(Math.min(22, f + 1)));
  else to.setAttribute("min", "1");
}
function _setPromoDateMinMax(form, row) {
  const date = _qs(row, 'input[name="promotion_date[]"]');
  if (!date) return;

  date.setAttribute("max", _todayMonth());

  const jm = _joiningMonthValue(form);
  if (_isValidMonth(jm)) {
    date.setAttribute("min", jm);
    date.disabled = false;
    _clearError(date);
    _setHint(date, "");
  } else {
    date.removeAttribute("min");
    date.value = "";
    date.disabled = true;
    _setHint(date, "Select Joining Date first to enable Promotion Date.");
  }
}
function _syncPromoRowConstraints(form, row) {
  _setPromoDateMinMax(form, row);
  _applyPromoBpsToMaxFromCurrent(form, row);
  _applyPromoToMinFromFrom(row);
  _togglePromoBpsToEnabled(form, row);
}
function _validatePromoRow(form, row) {
  let ok = true;

  const from = _qs(row, 'input[name="promotion_bps_from[]"]');
  const to = _qs(row, 'input[name="promotion_bps_to[]"]');
  const date = _qs(row, 'input[name="promotion_date[]"]');
  [from, to, date].forEach(_clearError);

  const vDate = (date?.value || "").trim();
  const emptyRow =
    _isEmpty(from?.value) && _isEmpty(to?.value) && _isEmpty(vDate);
  if (emptyRow) return true;

  const f = _normInt(from?.value);
  const t = _normInt(to?.value);
  const currentBps = _currentBpsValue(form);

  if (f === null) {
    _showError(from, "BPS From is required");
    ok = false;
  } else if (f < 1 || f > 22) {
    _showError(from, "BPS From must be 1 to 22");
    ok = false;
  }

  if (t === null) {
    _showError(to, "BPS To is required");
    ok = false;
  } else if (t < 1 || t > 22) {
    _showError(to, "BPS To must be 1 to 22");
    ok = false;
  }

  if (f !== null && t !== null) {
    if (t <= f) {
      _showError(to, "BPS To must be greater than BPS From");
      ok = false;
    }
    if (currentBps !== null && t > currentBps) {
      _showError(
        to,
        `BPS To cannot be greater than current BPS (${currentBps})`,
      );
      ok = false;
    }
  }

  if (_isEmpty(vDate) || !_isValidMonth(vDate)) {
    _showError(date, "Promotion month is required (YYYY-MM)");
    ok = false;
  } else {
    const jm = _joiningMonthValue(form);
    const tm = _todayMonth();
    if (!_isValidMonth(jm)) {
      _showError(date, "Select Joining Date first");
      ok = false;
    } else {
      if (_monthToIndex(vDate) < _monthToIndex(jm)) {
        _showError(date, "Promotion month cannot be before Joining Month");
        ok = false;
      }
      if (_monthToIndex(vDate) > _monthToIndex(tm)) {
        _showError(date, "Promotion month cannot be after current month");
        ok = false;
      }
    }
  }

  return ok;
}

function _ensurePromoRow(form, i) {
  const container = _qs(document, "#promo_rows");
  if (!container) return null;

  while (_promoRows().length <= i) {
    const row = _cloneFromTemplate("#tpl_promo_row", "#promo_rows");
    if (!row) break;

    _syncPromoRowConstraints(form, row);

    const from = _qs(row, 'input[name="promotion_bps_from[]"]');
    _unlockInput(from);
  }

  return _promoRows()[i] || null;
}
function _removePromoRowsAfter(idx) {
  _promoRows()
    .slice(idx + 1)
    .forEach((r) => r.remove());
}
function _continuePromoChainIfNeeded(form, row) {
  const currentBps = _currentBpsValue(form);
  if (currentBps === null) return;

  const to = _qs(row, 'input[name="promotion_bps_to[]"]');
  if (!to) return;

  const t = _normInt(to.value);
  if (t === null) return;
  if (t === currentBps) return;

  if (t < currentBps) {
    const idx = _promoRowIndex(row);
    const next = _ensurePromoRow(form, idx + 1);
    if (!next) return;

    const nextFrom = _qs(next, 'input[name="promotion_bps_from[]"]');
    const nextTo = _qs(next, 'input[name="promotion_bps_to[]"]');
    const nextDate = _qs(next, 'input[name="promotion_date[]"]');

    if (nextFrom) {
      nextFrom.value = String(t);
      _lockInput(nextFrom);
    }
    if (nextTo) nextTo.value = "";
    if (nextDate) nextDate.value = "";

    _syncPromoRowConstraints(form, next);
  }
}

function _initPromotionChain(form) {
  const container = _qs(document, "#promo_rows");
  const btnPromo = _qs(document, "#btn_add_promo_row");
  if (!container) return;

  if (btnPromo) {
    btnPromo.addEventListener("click", () => {
      if (_promoRows().length === 0) {
        const first = _ensurePromoRow(form, 0);
        if (first) _syncPromoRowConstraints(form, first);
      } else {
        _promoRows()[_promoRows().length - 1]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    });
  }

  container.addEventListener("input", (e) => {
    const row = e.target?.closest?.(".hrmis-repeat-row");
    if (!row) return;
    _syncPromoRowConstraints(form, row);
    if (e.target?.matches?.('input[name="promotion_bps_from[]"]'))
      _applyPromoToMinFromFrom(row);

    // Live validation: clears warnings as soon as values become valid
    _validatePromoRow(form, row);
  });

  container.addEventListener("change", (e) => {
    const row = e.target?.closest?.(".hrmis-repeat-row");
    if (!row) return;
    const idx = _promoRowIndex(row);
    if (idx < 0) return;

    const ok = _validatePromoRow(form, row);
    _removePromoRowsAfter(idx);
    if (!ok) return;
    _continuePromoChainIfNeeded(form, row);
  });

  const joining = _qs(form, '[name="hrmis_joining_date"]');
  if (joining) {
    joining.addEventListener("change", () => {
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
    });
  }

  const bps = _qs(form, '[name="hrmis_bps"]');
  if (bps) {
    const refresh = () =>
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
    bps.addEventListener("input", refresh);
    bps.addEventListener("change", refresh);
  }
}

/* ---------------------------------------------------------
 * Repeatables init (Add/Remove + delegation)
 * --------------------------------------------------------- */
function _removeRepeatRow(btn) {
  const row = btn.closest(".hrmis-repeat-row");
  if (row) row.remove();
}

function _initRepeatables(form) {
  const btnQual = _qs(document, "#btn_add_qual_row");
  const btnPrevPost = _qs(document, "#btn_add_prev_post_row");
  const btnLeave = _qs(document, "#btn_add_leave_row");

  if (btnQual)
    btnQual.addEventListener("click", () => {
      const row = _cloneFromTemplate("#tpl_qual_row", "#qual_rows");
      if (row) _syncQualificationRow(row);
    });

  if (btnPrevPost)
    btnPrevPost.addEventListener("click", () => {
      const row = _cloneFromTemplate("#tpl_prev_post_row", "#prev_post_rows");
      if (row) {
        _applyPostingBpsMaxFromCurrent(form, row);
        _syncPostingRowDateConstraints(form, row);
      }
    });

  if (btnLeave)
    btnLeave.addEventListener("click", () => {
      const row = _cloneFromTemplate("#tpl_leave_row", "#leave_rows");
      if (row) {
        _syncLeaveRowDateConstraints(row);
        _syncLeaveTypeSelectsByGender(form);
        _recalcLeavesTaken(form);
      }
    });

  form.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn_remove_row");
    if (btn) {
      e.preventDefault();
      _removeRepeatRow(btn);
      _recalcLeavesTaken(form);
      setTimeout(() => _syncQualDegreeOptions(), 0);
    }
  });

  form.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;

    // leave row changes
    if (
      t.matches?.(
        'input[name="leave_start[]"], input[name="leave_end[]"], select[name="leave_type_id[]"]',
      )
    ) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) {
        _syncLeaveRowDateConstraints(row);
        _applyLeaveOverlapRule(row, t);
      }
      _recalcLeavesTaken(form);
    }
    if (
      t.matches?.('input[name="posting_start[]"], input[name="posting_end[]"]')
    ) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) _syncPostingRowDateConstraints(form, row);
    }

    if (t.matches?.('[name="hrmis_joining_date"]')) {
      _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) =>
        _syncLeaveRowDateConstraints(row),
      );
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
    }

    if (t.matches?.('[name="gender"]')) _syncLeaveTypeSelectsByGender(form);

    if (t.matches?.('select[name="qualification_status[]"]')) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) {
        _syncQualEndVisibility(row);
        _syncQualEndMinMax(row);
        _validateQualificationRow(row);
      }
    }

    if (t.matches?.('select[name="qualification_degree[]"]'))
      _syncQualDegreeOptions();

    if (
      t.matches?.(
        'input[name="qualification_start[]"], input[name="qualification_end[]"]',
      )
    ) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) {
        _syncQualStartMax(row);
        _syncQualEndMinMax(row);
        _validateQualificationRow(row);
      }
    }

    if (t.matches?.('input[name="posting_bps[]"]')) {
      const row = t.closest(".hrmis-repeat-row");
      if (row) {
        _applyPostingBpsMaxFromCurrent(form, row);
        _validatePostingBpsAgainstCurrent(form, row);
      }
    }
  });

  form.addEventListener("input", (e) => {
    const t = e.target;
    if (!t) return;

    if (t.matches?.('input[name="posting_bps[]"]')) {
      const raw = t.value || "";
      const digits = raw.replace(/\D/g, "").slice(0, 2);
      if (digits !== raw) t.value = digits;

      const row = t.closest(".hrmis-repeat-row");
      if (row) {
        _applyPostingBpsMaxFromCurrent(form, row);
        _validatePostingBpsAgainstCurrent(form, row);
      }
    }

    if (
      t.matches?.(
        'input[name="promotion_bps_from[]"], input[name="promotion_bps_to[]"]',
      )
    ) {
      const raw = t.value || "";
      const digits = raw.replace(/\D/g, "").slice(0, 2);
      if (digits !== raw) t.value = digits;
    }
  });

  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) =>
    _syncLeaveRowDateConstraints(row),
  );
  _syncPostingBpsConstraints(form);
  _syncLeaveTypeSelectsByGender(form);
  _recalcLeavesTaken(form);
  _qualRows().forEach((r) => _syncQualificationRow(r));
}

/* ---------------------------------------------------------
 * Validation for repeatables on submit (unchanged from your file)
 * --------------------------------------------------------- */
function _validateRepeatables(form) {
  let hasError = false;
  const tm = _todayMonth();

  // qualifications
  _qsa(document, "#qual_rows .hrmis-repeat-row").forEach((row) => {
    const degree = _qs(row, 'select[name="qualification_degree[]"]');
    const start = _qs(row, 'input[name="qualification_start[]"]');
    const end = _qs(row, 'input[name="qualification_end[]"]');
    const spec = _qs(row, 'input[name="qualification_specialization[]"]');
    const statusSel = _qs(row, 'select[name="qualification_status[]"]');
    const status = (statusSel?.value || "").trim() || "ongoing";
    const completed =
      status === "completed" || !!_qs(row, ".js-qual-completed")?.checked;

    const emptyRow =
      _isEmpty(degree?.value) &&
      _isEmpty(start?.value) &&
      _isEmpty(end?.value) &&
      _isEmpty(spec?.value);

    if (emptyRow) {
      [degree, start, end, spec].forEach(_clearError);
      return;
    }

    // keep UI in sync in case something changed before submit
    _syncQualEndVisibility(row);

    if (_isEmpty(degree?.value)) {
      _showError(degree, "Degree is required");
      hasError = true;
    }

    if (_isEmpty(start?.value) || !_isValidMonth(start.value)) {
      _showError(start, "Start month is required (YYYY-MM)");
      hasError = true;
    } else if (_monthToIndex(start.value) > _monthToIndex(tm)) {
      _showError(start, "Start month cannot be after current month");
      hasError = true;
    }

    if (completed) {
      _syncQualEndMinMax(row);

      if (_isEmpty(end?.value) || !_isValidMonth(end.value)) {
        _showError(
          end,
          "End month is required when Status is Complete (YYYY-MM)",
        );
        hasError = true;
      } else if (_isValidMonth(start?.value) && _isValidMonth(end?.value)) {
        if (_monthToIndex(end.value) < _monthToIndex(start.value)) {
          _showError(end, "End month cannot be earlier than Start month");
          hasError = true;
        }
        if (_monthToIndex(end.value) > _monthToIndex(tm)) {
          _showError(end, "End month cannot be after current month");
          hasError = true;
        }
      }
    } else {
      if (end) {
        _clearError(end);
        end.value = "";
      }
    }
  });

  _syncQualDegreeOptions();

  // previous posting strict chain (only when jm != cm)
  const joiningVal = _qs(form, '[name="hrmis_joining_date"]')?.value || "";
  const currentVal = _qs(form, '[name="current_posting_start"]')?.value || "";

  const jm = joiningVal ? joiningVal.slice(0, 7) : "";
  const cm = (currentVal || "").trim();
  const currentBps = _currentBpsValue(form);

  if (_isValidMonth(jm) && _isValidMonth(cm)) {
    if (_monthToIndex(cm) < _monthToIndex(jm)) {
      _showError(
        _qs(form, '[name="current_posting_start"]'),
        "Current Posting Start cannot be before Joining Month",
      );
      hasError = true;
    }

    if (jm !== cm) {
      const rows = _qsa(document, "#prev_post_rows .hrmis-repeat-row");

      if (rows.length > 0) {
        let expectedStart = jm;

        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];

          const district = _qs(r, 'select[name="posting_district_id[]"]');
          const designation = _qs(r, 'select[name="posting_designation_id[]"]');
          const bps = _qs(r, 'input[name="posting_bps[]"]');
          const startInp = _qs(r, 'input[name="posting_start[]"]');
          const endInp = _qs(r, 'input[name="posting_end[]"]');

          const start = _readMonthValueFromInput(startInp);
          const end = _readMonthValueFromInput(endInp);
          // hard bounds: not before joining, not after/beyond current posting start
          if (_isValidMonth(jm)) {
            if (
              _isValidMonth(start) &&
              _monthToIndex(start) < _monthToIndex(jm)
            ) {
              _showError(
                startInp,
                "Start month cannot be before Joining Month",
              );
              hasError = true;
              break;
            }
            if (_isValidMonth(end) && _monthToIndex(end) < _monthToIndex(jm)) {
              _showError(endInp, "End month cannot be before Joining Month");
              hasError = true;
              break;
            }
          }

          if (_isValidMonth(cm)) {
            if (
              _isValidMonth(start) &&
              _monthToIndex(start) >= _monthToIndex(cm)
            ) {
              _showError(
                startInp,
                "Start must be before Current Posting Start",
              );
              hasError = true;
              break;
            }
            // you already check end >= cm, keep it; it enforces end < cm
          }

          if (_isEmpty(district?.value)) {
            _showError(district, "District is required");
            hasError = true;
            break;
          }
          if (_isEmpty(designation?.value)) {
            _showError(designation, "Designation is required");
            hasError = true;
            break;
          }
          if (_isEmpty(bps?.value)) {
            _showError(bps, "BPS is required");
            hasError = true;
            break;
          }

          if (currentBps !== null) {
            const pv = _normInt(bps?.value);
            if (pv !== null && pv > currentBps) {
              _showError(
                bps,
                `Posting BPS cannot be greater than current BPS (${currentBps})`,
              );
              hasError = true;
              break;
            }
          }

          if (!startInp || start !== expectedStart) {
            _showError(
              startInp,
              "Start must match previous End / Joining Month",
            );
            hasError = true;
            break;
          }

          if (!endInp || _isEmpty(end) || !_isValidMonth(end)) {
            _showError(endInp, "End month is required (YYYY-MM)");
            hasError = true;
            break;
          }

          if (_monthToIndex(end) < _monthToIndex(start)) {
            _showError(endInp, "End cannot be earlier than Start");
            hasError = true;
            break;
          }

          if (_monthToIndex(end) >= _monthToIndex(cm)) {
            _showError(endInp, "End must be before Current Posting Start");
            hasError = true;
            break;
          }

          expectedStart = _nextMonth(end);
        }

        if (!hasError) {
          const lastEndInp = _qs(
            rows[rows.length - 1],
            'input[name="posting_end[]"]',
          );
          const lastEnd = _readMonthValueFromInput(lastEndInp);
          if (_nextMonth(lastEnd) !== cm) {
            _showError(
              lastEndInp,
              "Last End must be exactly 1 month before Current Posting Start",
            );
            hasError = true;
          }
        }
      }
    }
  }

  // promotions strict chain
  const promoRows = _promoRows();
  const filledPromoRows = promoRows.filter((row) => {
    const from = _qs(row, 'input[name="promotion_bps_from[]"]')?.value || "";
    const to = _qs(row, 'input[name="promotion_bps_to[]"]')?.value || "";
    const date = _qs(row, 'input[name="promotion_date[]"]')?.value || "";
    return !(_isEmpty(from) && _isEmpty(to) && _isEmpty(date));
  });

  filledPromoRows.forEach((row, idx) => {
    const fromEl = _qs(row, 'input[name="promotion_bps_from[]"]');

    if (!_validatePromoRow(form, row)) hasError = true;

    if (idx > 0) {
      const prev = filledPromoRows[idx - 1];
      const prevTo = _normInt(
        _qs(prev, 'input[name="promotion_bps_to[]"]')?.value,
      );
      const thisFrom = _normInt(fromEl?.value);
      if (prevTo !== null && thisFrom !== null && thisFrom !== prevTo) {
        _showError(fromEl, "BPS From must equal previous row BPS To");
        hasError = true;
      }
    }
  });

  if (filledPromoRows.length && currentBps !== null) {
    const last = filledPromoRows[filledPromoRows.length - 1];
    const lastToEl = _qs(last, 'input[name="promotion_bps_to[]"]');
    const lastTo = _normInt(lastToEl?.value);
    if (lastTo === null || lastTo !== currentBps) {
      _showError(
        lastToEl || _qs(form, '[name="hrmis_bps"]'),
        `Complete Promotion History: last "BPS To" must equal current BPS (${currentBps}).`,
      );
      hasError = true;
    }
  }

  // leave validations + overlap
  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
    const type = _qs(row, 'select[name="leave_type_id[]"]');
    const start = _qs(row, 'input[name="leave_start[]"]');
    const end = _qs(row, 'input[name="leave_end[]"]');

    const emptyRow =
      _isEmpty(type?.value) && _isEmpty(start?.value) && _isEmpty(end?.value);
    if (emptyRow) {
      [type, start, end].forEach(_clearError);
      return;
    }

    if (_isEmpty(type?.value)) {
      _showError(type, "Leave type is required");
      hasError = true;
    }
    if (_isEmpty(start?.value)) {
      _showError(start, "Start date is required");
      hasError = true;
    }
    if (_isEmpty(end?.value)) {
      _showError(end, "End date is required");
      hasError = true;
    }

    const yesterday = _yesterdayLocalYmd();
    const today = _todayLocalYmd();

    if (
      !_isEmpty(start?.value) &&
      !_isEmpty(yesterday) &&
      start.value > yesterday
    ) {
      _showError(start, "Start date must be before today");
      hasError = true;
    }
    if (!_isEmpty(end?.value) && !_isEmpty(today) && end.value > today) {
      _showError(end, "End date cannot be after today");
      hasError = true;
    }

    if (!_isEmpty(start?.value) && !_isEmpty(end?.value)) {
      const s = new Date(start.value + "T00:00:00");
      const e = new Date(end.value + "T00:00:00");
      if (e < s) {
        _showError(end, "End date cannot be earlier than Start date");
        hasError = true;
      }
      const minEnd = _addDaysLocalYmd(start.value, 7);
      if (!_isEmpty(minEnd) && end.value < minEnd) {
        _showError(end, "End date must be at least 7 days after Start date");
        hasError = true;
      }
    }
  });

  const leaveRanges = [];
  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
    const start = _qs(row, 'input[name="leave_start[]"]')?.value || "";
    const end = _qs(row, 'input[name="leave_end[]"]')?.value || "";
    if (_isEmpty(start) || _isEmpty(end)) return;
    leaveRanges.push({ row, start, end });
  });

  for (let i = 0; i < leaveRanges.length; i++) {
    for (let j = i + 1; j < leaveRanges.length; j++) {
      const a = leaveRanges[i];
      const b = leaveRanges[j];
      if (_rangesOverlapYmd(a.start, a.end, b.start, b.end)) {
        const msg = `Leave dates overlap between rows (${a.start} to ${a.end}) and (${b.start} to ${b.end}).`;
        const aEnd = _qs(a.row, 'input[name="leave_end[]"]');
        const bEnd = _qs(b.row, 'input[name="leave_end[]"]');
        if (aEnd) _showError(aEnd, msg);
        if (bEnd) _showError(bEnd, msg);
        hasError = true;
      }
    }
  }

  return hasError;
}

/* ---------------------------------------------------------
 * File validation: CNIC scans (front/back) — unchanged
 * --------------------------------------------------------- */
function _initCnicScanFiles(form) {
  const MAX_BYTES = 4 * 1024 * 1024;
  const allowedExt = new Set(["pdf", "jpg", "jpeg", "png", "svg"]);
  const allowedMime = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
  ]);

  const inputs = [
    _qs(form, 'input[type="file"][name="hrmis_cnic_front"]'),
    _qs(form, 'input[type="file"][name="hrmis_cnic_back"]'),
  ].filter(Boolean);

  function _extOf(fileName) {
    const n = String(fileName || "").trim();
    const idx = n.lastIndexOf(".");
    return idx >= 0 ? n.slice(idx + 1).toLowerCase() : "";
  }
  function _humanMB(bytes) {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  function validateFileInput(input) {
    if (!input) return true;

    input.setCustomValidity("");
    _clearError(input);

    const file = input.files && input.files[0];
    if (!file) return true;

    const ext = _extOf(file.name);
    const mime = String(file.type || "").toLowerCase();

    if (!allowedExt.has(ext)) {
      const msg = "Invalid file type. Allowed: PDF, JPG, JPEG, PNG, SVG.";
      _showError(input, msg);
      input.setCustomValidity(msg);
      input.value = "";
      return false;
    }

    if (mime && !allowedMime.has(mime)) {
      if (!(ext === "svg" && mime === "")) {
        const msg = "Invalid file format. Allowed: PDF, JPG, JPEG, PNG, SVG.";
        _showError(input, msg);
        input.setCustomValidity(msg);
        input.value = "";
        return false;
      }
    }

    if (file.size > MAX_BYTES) {
      const msg = `File too large (${_humanMB(file.size)}). Max allowed is 4.00 MB.`;
      _showError(input, msg);
      input.setCustomValidity(msg);
      input.value = "";
      return false;
    }

    _clearError(input);
    input.setCustomValidity("");
    return true;
  }

  inputs.forEach((inp) =>
    inp.addEventListener("change", () => validateFileInput(inp)),
  );

  form._hrmisValidateCnicFiles = () => {
    let ok = true;
    inputs.forEach((inp) => {
      if (!validateFileInput(inp)) ok = false;
    });
    return ok;
  };
}

function _initAllowedToWorkToggle() {
  const checkbox = document.getElementById("allowed_to_work_checkbox");
  const box = document.getElementById("allowed_to_work_box");
  const startMonth = document.querySelector('input[name="allowed_start_month"]');

  if (!checkbox || !box) return;

  function syncAllowedUI() {
    const enabled = checkbox.checked;
    box.style.display = enabled ? "" : "none";

    if (startMonth) {
      if (enabled) {
        startMonth.setAttribute("required", "required");
      } else {
        startMonth.removeAttribute("required");
        startMonth.value = "";
        _clearError(startMonth);
      }
    }
  }

  checkbox.addEventListener("change", syncAllowedUI);
  syncAllowedUI();
}
function _readPrefillJSON() {
  const el = document.getElementById("hrmis_profile_prefill_json");
  if (!el) return null;
  try {
    const raw = (el.textContent || "").trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("[HRMIS] Invalid prefill JSON", e);
    return null;
  }
}

function _setSelectValue(selectEl, value) {
  if (!selectEl) return;
  const v = String(value || "");
  selectEl.value = v;
  // if option not found, keep empty
  if (selectEl.value !== v) selectEl.value = "";
}

function _seedQualificationRows(form, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  list.forEach((it) => {
    const row = _cloneFromTemplate("#tpl_qual_row", "#qual_rows");
    if (!row) return;

    _setSelectValue(
      _qs(row, 'select[name="qualification_degree[]"]'),
      it.degree,
    );
    const spec = _qs(row, 'input[name="qualification_specialization[]"]');
    if (spec) spec.value = it.specialization || "";

    const start = _qs(row, 'input[name="qualification_start[]"]');
    if (start) start.value = it.start_month || "";

    const end = _qs(row, 'input[name="qualification_end[]"]');
    if (end) end.value = it.end_month || "";

    const chk = _qs(row, ".js-qual-completed");
    if (chk) chk.checked = !!(it.completed || it.end_month);

    _syncQualificationRow(row);
  });

  setTimeout(() => _syncQualDegreeOptions(), 0);
}

function _seedPrevPostingRows(form, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  // show the section
  const wrap = _qs(document, ".js-prev-posting-wrap");
  if (wrap) wrap.style.display = "";

  list.forEach((it) => {
    const row = _cloneFromTemplate("#tpl_prev_post_row", "#prev_post_rows");
    if (!row) return;

    _setSelectValue(
      _qs(row, 'select[name="posting_district_id[]"]'),
      it.district_id || 0,
    );
    _setSelectValue(
      _qs(row, 'select[name="posting_facility_id[]"]'),
      it.facility_id || 0,
    );
    _setSelectValue(
      _qs(row, 'select[name="posting_designation_id[]"]'),
      it.designation_id || 0,
    );

    const bps = _qs(row, 'input[name="posting_bps[]"]');
    if (bps) bps.value = it.bps != null ? String(it.bps) : "";

    const s = _qs(row, 'input[name="posting_start[]"]');
    if (s) s.value = it.start_month || "";

    const e = _qs(row, 'input[name="posting_end[]"]');
    if (e) e.value = it.end_month || "";

    _applyPostingBpsMaxFromCurrent(form, row);
  });
}

function _seedLeaveRows(form, items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return;

  list.forEach((it) => {
    const row = _cloneFromTemplate("#tpl_leave_row", "#leave_rows");
    if (!row) return;

    _setSelectValue(
      _qs(row, 'select[name="leave_type_id[]"]'),
      it.leave_type_id || 0,
    );

    const s = _qs(row, 'input[name="leave_start[]"]');
    if (s) s.value = it.start_date || "";

    const e = _qs(row, 'input[name="leave_end[]"]');
    if (e) e.value = it.end_date || "";

    _syncLeaveRowDateConstraints(row);
  });

  _syncLeaveTypeSelectsByGender(form);
  _recalcLeavesTaken(form);
}

function _applyPrefillRepeatables(form) {
  const data = _readPrefillJSON();
  if (!data) return;

  _seedQualificationRows(form, data.qual);
  _seedPrevPostingRows(form, data.post);
  _seedLeaveRows(form, data.leave);

  // if later you add promo:
  // _seedPromoRows(form, data.promo);
}
/* ---------------------------------------------------------
 * Main init (guarded)
 * --------------------------------------------------------- */
function _initHRMISValidations() {
  const form = _qs(document, ".hrmis-form");
  if (!form) return;

  // INIT GUARD: prevent double binding on pageshow/bfcache
  if (form.dataset.hrmisInited === "1") return;
  form.dataset.hrmisInited = "1";

  _initSearchableSelects(form);
  _attachComboboxGlobalCloser();
  _initDates(form);
  _initProfileDatePickers(form); // DOB only (commission/joining use month proxy)
  _initCNIC(form);
  _initContact(form);
  _initCnicScanFiles(form);
  // Status UI (Suspended hides current posting + shows suspension box)
  _initFrontendStatusToggle(form);

  _digitsOnly(_qs(form, '[name="hrmis_bps"]'), { maxLen: 2 });
  _digitsOnly(_qs(form, '[name="hrmis_merit_number"]'), { maxLen: 20 });

  // PMDC conditional required (depends on Cadre)
  const cadreSel = _qs(form, 'select[name="hrmis_cadre"]');
  if (cadreSel) {
    cadreSel.addEventListener("change", () => _syncPmdcRequiredByCadre(form));
    // run once on load (prefilled cadre)
    _syncPmdcRequiredByCadre(form);
  }

  const leavesTakenEl = _qs(form, '[name="hrmis_leaves_taken"]');
  if (leavesTakenEl) {
    leavesTakenEl.readOnly = true;
    leavesTakenEl.setAttribute("readonly", "readonly");
  }

  // Commission & Joining month/year UI proxy (keeps backend date intact)
  const joiningInput = _qs(form, '[name="hrmis_joining_date"]');
  const commissionInput = _qs(form, '[name="hrmis_commission_date"]');
  const joiningUI = joiningInput ? _attachMonthProxy(joiningInput) : null;
  const commissionUI = commissionInput
    ? _attachMonthProxy(commissionInput)
    : null;

  // Previous posting visibility logic
  _initPostingPrevChain(form);

  // Current Posting Start: prevent future months
  const cpsInput = _qs(form, '[name="current_posting_start"]');
  if (cpsInput) cpsInput.setAttribute("max", _todayMonth());

  // Require Joining before enabling current posting start (UX)
  if (joiningInput && cpsInput) {
    const toggle = () => {
      const hasJoining = !_isEmpty(joiningInput.value);
      cpsInput.disabled = !hasJoining;

      if (!hasJoining) {
        cpsInput.value = "";
        _clearError(cpsInput);
        _setHint(
          cpsInput,
          "Enter Joining Date first to enable Current Posting Start.",
        );
      } else {
        _setHint(cpsInput, "");
        _validateCurrentPostingStart(form);
      }
    };

    joiningInput.addEventListener("change", () => {
      toggle();
      _validateCurrentPostingStart(form);
      _validateJoiningCommission(form);
      _validateDobCommission(form);
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
      _syncPostingBpsConstraints(form);
    });

    cpsInput.addEventListener("change", () => {
      _validateCurrentPostingStart(form);
      _postingRows().forEach((r) => _syncPostingRowDateConstraints(form, r));
    });

    toggle();
  }

  // Joining vs Commission: enforce order (Commission first) on UI proxies
  if (joiningInput && commissionInput && joiningUI && commissionUI) {
    const syncMinMax = () => {
      const jmv = (joiningUI.value || "").trim(); // YYYY-MM
      const cmv = (commissionUI.value || "").trim(); // YYYY-MM

      // DOB constraint: commission >= DOB month
      _syncCommissionMinFromDob(form);

      commissionUI.setAttribute("max", _todayMonth());
      commissionInput.setAttribute("max", _todayLocalYmd());

      const hasCommission = !_isEmpty(cmv);

      // Disable ONLY UI joining picker (do NOT disable hidden date input)
      joiningUI.disabled = !hasCommission;

      if (!hasCommission) {
        joiningUI.value = "";
        joiningInput.value = "";
        _clearError(joiningUI);
        _clearError(commissionUI);
        _setHint(
          joiningUI,
          "Select Commission Date first to enable Joining Date.",
        );
        return;
      } else {
        _setHint(joiningUI, "");
      }

      joiningUI.setAttribute("min", cmv);
      joiningInput.setAttribute("min", `${cmv}-01`);

      // commission <= joining if joining exists
      if (!_isEmpty(jmv)) {
        commissionUI.setAttribute("max", jmv);
        commissionInput.setAttribute("max", `${jmv}-01`);
      } else {
        commissionUI.setAttribute("max", _todayMonth());
        commissionInput.setAttribute("max", _todayLocalYmd());
      }

      _validateJoiningCommission(form);
      _validateDobCommission(form);
    };

    commissionUI.addEventListener("change", syncMinMax);
    joiningUI.addEventListener("change", syncMinMax);
    syncMinMax();
  }

  _applyPrefillRepeatables(form);
  _initRepeatables(form);
  _initPromotionChain(form);

  _promoRows().forEach((row) => _syncPromoRowConstraints(form, row));
  _syncPostingBpsConstraints(form);

  // Keep constraints in sync when Current BPS changes
  const bpsEl = _qs(form, '[name="hrmis_bps"]');
  if (bpsEl) {
    const refresh = () => {
      _syncPostingBpsConstraints(form);
      _postingRows().forEach((r) => _validatePostingBpsAgainstCurrent(form, r));
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
    };
    bpsEl.addEventListener("input", refresh);
    bpsEl.addEventListener("change", refresh);
  }

  function _isActuallyVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  form.addEventListener("submit", function (e) {
    let hasError = false;

    // Ensure conditional required flags are in sync right before validation
    const needsPmdc = _syncPmdcRequiredByCadre(form);

    if (needsPmdc) {
      [
        { name: "hrmis_pmdc_no", msg: "PMDC No. is required" },
        { name: "hrmis_pmdc_issue_date", msg: "PMDC Issue Date is required" },
        { name: "hrmis_pmdc_expiry_date", msg: "PMDC Expiry Date is required" },
      ].forEach((f) => {
        const inp = _qs(form, `[name="${f.name}"]`);
        if (!inp || inp.disabled) return;
        if (_isEmpty(inp.value)) {
          _showError(inp, f.msg);
          hasError = true;
        }
      });
    }

    // Validate all visible enabled required fields, including active Status box fields.
    _qsa(form, "input[required], select[required], textarea[required]").forEach(
      (input) => {
        if (!input) return;
        if (input.disabled) return;

        const box = input.closest(".js-status-box");
        if (box && (box.style.display === "none" || box.hidden)) return;

        const wrap = input.closest("[style*='display: none'], .d-none");
        if (wrap) return;

        if (!_isActuallyVisible(input) && !input.closest(".js-status-box"))
          return;

        if (_isEmpty(input.value)) {
          if (
            input.name === "hrmis_joining_date" &&
            joiningInput?._hrmisMonthProxy
          ) {
            _showError(joiningInput._hrmisMonthProxy, "This field is required");
          } else if (
            input.name === "hrmis_commission_date" &&
            commissionInput?._hrmisMonthProxy
          ) {
            _showError(
              commissionInput._hrmisMonthProxy,
              "This field is required",
            );
          } else {
            _showError(input, "This field is required");
          }
          hasError = true;
        }
      },
    );

    // DOB 18+
    const dobVal = _qs(form, '[name="birthday"]')?.value;
    if (dobVal) {
      const dob = new Date(dobVal + "T00:00:00");
      const now = new Date();
      let age = now.getFullYear() - dob.getFullYear();
      const m = now.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
      if (age < 18) {
        _showError(
          _qs(form, '[name="birthday"]'),
          "Employee must be at least 18 years old",
        );
        hasError = true;
      }
    }

    if (!_validateCurrentPostingStart(form)) hasError = true;
    if (!_validateJoiningCommission(form)) hasError = true;
    if (!_validateDobCommission(form)) hasError = true;

    if (_validateRepeatables(form)) hasError = true;
    if (form._hrmisValidateCnicFiles && !form._hrmisValidateCnicFiles())
      hasError = true;

    if (hasError) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

function _ensureNativeDateInput(input) {
  if (!input) return;

  // If this input was previously converted to text for custom popup,
  // restore it back to native date input.
  try {
    input.type = "date";
  } catch {
    // ignore if browser refuses changing type (rare)
  }

  input.readOnly = false;
  input.removeAttribute("inputmode");
  input.removeAttribute("autocomplete");

  // prevent custom popup behavior if it was attached earlier
  input._hrmisLeaveDatePickerAttached = false;
}

function _setComboboxDisabled(selectEl, disabled, msg = "") {
  if (!selectEl) return;

  const combo = selectEl.closest(".hrmis-combobox");
  const comboInput = combo ? combo.querySelector("input[type='text']") : null;

  // Sync BOTH: real select + the visible combobox input
  selectEl.disabled = !!disabled;
  if (comboInput) comboInput.disabled = !!disabled;

  // Optional: pointer feel
  if (comboInput) {
    comboInput.style.cursor = disabled ? "not-allowed" : "";
    comboInput.style.backgroundColor = disabled ? "#fff5f5" : "";
  }

  // Error styling on the visible input (so it becomes reddish)
  if (disabled && msg) {
    if (comboInput) _showError(comboInput, msg);
    else _showError(selectEl, msg);
  } else {
    if (comboInput) _clearError(comboInput);
    _clearError(selectEl);
  }
}
function _initFrontendStatusToggle(formArg) {
  const form = formArg || document.querySelector(".hrmis-form");
  if (!form) return;

  const statusEl = form.querySelector('[name="hrmis_current_status_frontend"]');
  if (!statusEl) return;

  // status boxes (currently_posted, suspended, on_leave, eol_pgship etc.)
  const boxes = Array.from(document.querySelectorAll(".js-status-box"));

  // Allowed-to-work UI
  const allowedCbs = Array.from(
    form.querySelectorAll(".js-allowed-to-work-toggle"),
  );
  const allowedBox = document.getElementById("allowed_to_work_box");

  // ---------- helpers ----------
  function remember(el) {
    if (!el || el.dataset.hrmisRemembered === "1") return;
    el.dataset.hrmisRemembered = "1";
    el.dataset.hrmisOrigDisabled = el.disabled ? "1" : "0";
    el.dataset.hrmisOrigRequired = el.hasAttribute("required") ? "1" : "0";
  }

  function setBoxEnabled(box, enabled) {
    if (!box) return;
    box.querySelectorAll("input, select, textarea").forEach((el) => {
      remember(el);
      const field = el.closest(".hrmis-field");
      const hasStar = !!field?.querySelector(".req");
      if (!enabled) {
        el.disabled = true;
        el.removeAttribute("required");
      } else {
        el.disabled = el.dataset.hrmisOrigDisabled === "1";
        if (hasStar || el.dataset.hrmisOrigRequired === "1") {
          el.setAttribute("required", "required");
        } else {
          el.removeAttribute("required");
        }
      }
    });
  }

  function showOnly(statusValue) {
    const normalized = (statusValue || "").trim();
    boxes.forEach((b) => {
      b.style.display = "none";
      setBoxEnabled(b, false);
    });

    const active = boxes.find(
      (b) => (b.dataset.status || "").trim() === normalized,
    );
    if (active) {
      active.style.display = "";
      setBoxEnabled(active, true);
    }
    return active || null;
  }

  // ---------- Allowed-to-work toggle ----------
  function setAllowedBoxVisible(visible) {
    if (!allowedBox) return;

    allowedBox.style.display = visible ? "" : "none";

    allowedBox.querySelectorAll("input, select, textarea").forEach((el) => {
      remember(el);

      if (!visible) {
        // clear values when hiding
        if (el.tagName === "SELECT") el.value = "";
        else if (el.type === "checkbox" || el.type === "radio")
          el.checked = false;
        else el.value = "";

        el.disabled = true;
        el.removeAttribute("required");
      } else {
        // restore original
        el.disabled = el.dataset.hrmisOrigDisabled === "1";
        if (el.dataset.hrmisOrigRequired === "1")
          el.setAttribute("required", "required");
      }
    });
  }

  function syncAllowedToWork(activeStatus) {
    const eligible =
      activeStatus === "currently_posted" || activeStatus === "eol_pgship";

    // Force-hide unless eligible for allowed-to-work
    if (!eligible) {
      allowedCbs.forEach((cb) => {
        remember(cb);
        cb.checked = false;
        cb.disabled = true;
      });
      setAllowedBoxVisible(false);
      return;
    }

    // eligible: enable checkbox(es) and follow their state
    allowedCbs.forEach((cb) => {
      remember(cb);
      cb.disabled = cb.dataset.hrmisOrigDisabled === "1";
    });

    const shouldShow = allowedCbs.some((cb) => cb.checked);
    setAllowedBoxVisible(shouldShow);
  }

  // ---------- suspension sub-toggle ----------
  const suspensionReportingTo = form.querySelector(
    '[name="frontend_reporting_to"]',
  );
  const suspensionDistrictWrap = document.getElementById(
    "frontend_reporting_district_wrap",
  );
  const suspensionFacilityWrap = document.getElementById(
    "frontend_reporting_facility_wrap",
  );
  const suspensionDistrictSel = form.querySelector(
    '[name="frontend_reporting_district_id"]',
  );
  const suspensionFacilitySel = form.querySelector(
    '[name="frontend_reporting_facility_id"]',
  );

  function syncSuspensionFacility() {
    if (!suspensionReportingTo) return;

    const showFacility = (suspensionReportingTo.value || "") === "facility";
    if (suspensionDistrictWrap)
      suspensionDistrictWrap.style.display = showFacility ? "" : "none";
    if (suspensionFacilityWrap)
      suspensionFacilityWrap.style.display = showFacility ? "" : "none";

    if (suspensionDistrictSel) {
      remember(suspensionDistrictSel);
      if (showFacility) {
        suspensionDistrictSel.disabled =
          suspensionDistrictSel.dataset.hrmisOrigDisabled === "1";
        suspensionDistrictSel.removeAttribute("required");
      } else {
        suspensionDistrictSel.value = "";
        suspensionDistrictSel.disabled = true;
        suspensionDistrictSel.removeAttribute("required");
      }
    }

    if (suspensionFacilitySel) {
      remember(suspensionFacilitySel);
      if (showFacility) {
        suspensionFacilitySel.disabled =
          suspensionFacilitySel.dataset.hrmisOrigDisabled === "1";
        suspensionFacilitySel.removeAttribute("required");
      } else {
        suspensionFacilitySel.value = "";
        suspensionFacilitySel.disabled = true;
        suspensionFacilitySel.removeAttribute("required");
      }
    }
  }

  // ---------- on-leave sub-toggle ----------
  const onLeaveReportingTo = form.querySelector(
    '[name="frontend_onleave_reporting_to"]',
  );
  const onLeaveDistrictWrap = document.getElementById(
    "frontend_onleave_district_wrap",
  );
  const onLeaveFacilityWrap = document.getElementById(
    "frontend_onleave_facility_wrap",
  );
  const onLeaveDistrictSel = form.querySelector(
    '[name="frontend_onleave_district_id"]',
  );
  const onLeaveFacilitySel = form.querySelector(
    '[name="frontend_onleave_facility_id"]',
  );

  function syncOnLeaveFacility() {
    if (!onLeaveReportingTo) return;

    const showFacility = (onLeaveReportingTo.value || "") === "facility";
    if (onLeaveDistrictWrap)
      onLeaveDistrictWrap.style.display = showFacility ? "" : "none";
    if (onLeaveFacilityWrap)
      onLeaveFacilityWrap.style.display = showFacility ? "" : "none";

    if (onLeaveDistrictSel) {
      remember(onLeaveDistrictSel);
      if (showFacility) {
        onLeaveDistrictSel.disabled =
          onLeaveDistrictSel.dataset.hrmisOrigDisabled === "1";
        onLeaveDistrictSel.removeAttribute("required");
      } else {
        onLeaveDistrictSel.value = "";
        onLeaveDistrictSel.disabled = true;
        onLeaveDistrictSel.removeAttribute("required");
      }
    }

    if (onLeaveFacilitySel) {
      remember(onLeaveFacilitySel);
      if (showFacility) {
        onLeaveFacilitySel.disabled =
          onLeaveFacilitySel.dataset.hrmisOrigDisabled === "1";
        onLeaveFacilitySel.removeAttribute("required");
      } else {
        onLeaveFacilitySel.value = "";
        onLeaveFacilitySel.disabled = true;
        onLeaveFacilitySel.removeAttribute("required");
      }
    }
  }

  // ---------- eol (pgship) end-date by status ----------
  const eolStatusSel = form.querySelector('[name="frontend_eol_status"]');
  const eolEndWrap = document.getElementById("frontend_eol_end_wrap");
  const eolEndInp = form.querySelector('[name="frontend_eol_end"]');

  function syncEolEndVisibility() {
    if (!eolStatusSel || !eolEndWrap || !eolEndInp) return;
    remember(eolStatusSel);
    remember(eolEndInp);

    const v = (eolStatusSel.value || "").trim();
    const show = v === "completed";

    eolEndWrap.style.display = show ? "" : "none";

    if (!show) {
      eolEndInp.value = "";
      eolEndInp.disabled = true;
      eolEndInp.removeAttribute("required");
    } else {
      eolEndInp.disabled = eolEndInp.dataset.hrmisOrigDisabled === "1";
      eolEndInp.setAttribute("required", "required");
    }
  }

  // remember original attrs once
  boxes.forEach((box) =>
    box.querySelectorAll("input, select, textarea").forEach(remember),
  );
  allowedCbs.forEach((cb) => remember(cb));
  if (allowedBox)
    allowedBox.querySelectorAll("input, select, textarea").forEach(remember);
  if (suspensionFacilitySel) remember(suspensionFacilitySel);
  if (suspensionDistrictSel) remember(suspensionDistrictSel);
  if (onLeaveFacilitySel) remember(onLeaveFacilitySel);
  if (onLeaveDistrictSel) remember(onLeaveDistrictSel);
  if (eolStatusSel) remember(eolStatusSel);
  if (eolEndInp) remember(eolEndInp);

  // ---------- main sync ----------
  function sync() {
    const status = (statusEl.value || "").trim();

    const active = showOnly(status);

    // ✅ allowed-to-work must follow status + checkbox
    syncAllowedToWork(status);

    // run sub-toggles only when their box is active
    if (active && active.dataset.status === "suspended") {
      syncSuspensionFacility();
    } else {
      if (suspensionDistrictWrap) suspensionDistrictWrap.style.display = "none";
      if (suspensionDistrictSel) {
        suspensionDistrictSel.value = "";
        suspensionDistrictSel.disabled = true;
        suspensionDistrictSel.removeAttribute("required");
      }
      if (suspensionFacilityWrap) suspensionFacilityWrap.style.display = "none";
      if (suspensionFacilitySel) {
        suspensionFacilitySel.value = "";
        suspensionFacilitySel.disabled = true;
        suspensionFacilitySel.removeAttribute("required");
      }
    }

    if (active && active.dataset.status === "on_leave") {
      syncOnLeaveFacility();
    } else {
      if (onLeaveDistrictWrap) onLeaveDistrictWrap.style.display = "none";
      if (onLeaveDistrictSel) {
        onLeaveDistrictSel.value = "";
        onLeaveDistrictSel.disabled = true;
        onLeaveDistrictSel.removeAttribute("required");
      }
      if (onLeaveFacilityWrap) onLeaveFacilityWrap.style.display = "none";
      if (onLeaveFacilitySel) {
        onLeaveFacilitySel.value = "";
        onLeaveFacilitySel.disabled = true;
        onLeaveFacilitySel.removeAttribute("required");
      }
    }

    if (active && active.dataset.status === "eol_pgship") {
      syncEolEndVisibility();
    } else {
      if (eolEndWrap) eolEndWrap.style.display = "none";
      if (eolEndInp) {
        eolEndInp.value = "";
        eolEndInp.disabled = true;
        eolEndInp.removeAttribute("required");
      }
    }
  }

  // events
  statusEl.addEventListener("change", sync);

  allowedCbs.forEach((cb) => {
    cb.addEventListener("change", () => {
      // If multiple checkboxes exist in DOM, keep them synced
      const checked = !!cb.checked;
      allowedCbs.forEach((other) => {
        if (other !== cb) other.checked = checked;
      });
      syncAllowedToWork((statusEl.value || "").trim());
    });
  });

  if (suspensionReportingTo)
    suspensionReportingTo.addEventListener("change", syncSuspensionFacility);
  if (onLeaveReportingTo)
    onLeaveReportingTo.addEventListener("change", syncOnLeaveFacility);
  if (eolStatusSel)
    eolStatusSel.addEventListener("change", syncEolEndVisibility);

  sync(); // run once on load
}

function _initHRMIS() {
  const form = document.getElementById("profile_update_form");
  if (!form) return;

  const isSubmittedView = form.classList.contains("is-submitted");
  if (isSubmittedView) {
    // Hide delete icons
    document.querySelectorAll(".btn_remove_row").forEach((el) => {
      el.style.display = "none";
    });

    const btnQual = document.getElementById("btn_add_qual_row");
    const btnPromo = document.getElementById("btn_add_promo_row");
    const btnLeave = document.getElementById("btn_add_leave_row");

    if (btnQual) btnQual.style.display = "none";
    if (btnPromo) btnPromo.style.display = "none";
    if (btnLeave) btnLeave.style.display = "none";

    console.log("[HRMIS] Skipping JS init — form is submitted view");
    return;
  }

  _initHRMISValidations();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initHRMIS);
} else {
  _initHRMIS();
}
window.addEventListener("pageshow", _initHRMIS);