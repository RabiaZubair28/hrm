/** @odoo-module **/

/* ---------------------------------------------------------
 * Helpers
 * --------------------------------------------------------- */
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
  let hint = input.parentElement.querySelector(".hrmis-hint");
  if (!hint) {
    hint = document.createElement("div");
    hint.className = "hrmis-hint";
    hint.style.fontSize = "12px";
    hint.style.marginTop = "4px";
    hint.style.color = "#6c757d";
    input.parentElement.appendChild(hint);
  }
  hint.textContent = message || "";
  hint.style.display = message ? "" : "none";
}

function _normInt(v) {
  const n = parseInt(String(v || "").trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function _showError(input, message) {
  if (!input) return;
  let error = input.parentElement.querySelector(".hrmis-error");
  if (!error) {
    error = document.createElement("div");
    error.className = "hrmis-error";
    input.parentElement.appendChild(error);
  }
  error.textContent = message;
  input.classList.add("has-error");
  input.style.borderColor = "#dc3545";
}
function _clearError(input) {
  if (!input) return;
  const error = input.parentElement.querySelector(".hrmis-error");
  if (error) error.remove();
  input.classList.remove("has-error");
  input.style.borderColor = "";
}

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
      e.key === "Home" ||
      e.key === "End";

    if (allowed) return;
    if (e.ctrlKey || e.metaKey) return;

    if (!/^\d$/.test(e.key)) {
      e.preventDefault();
      _showError(input, "Only numbers allowed");
    } else {
      _clearError(input);
    }
  });

  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text =
      (e.clipboardData || window.clipboardData).getData("text") || "";
    let digits = text.replace(/\D/g, "");
    if (maxLen) digits = digits.slice(0, maxLen);
    input.value = digits;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  input.addEventListener("input", () => {
    const raw = input.value || "";
    let digits = raw.replace(/\D/g, "");
    if (maxLen) digits = digits.slice(0, maxLen);
    if (digits !== raw) input.value = digits;
  });
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
  return `${y}-${m}`; // YYYY-MM
}

/* ---------------------------------------------------------
 * Completed/Current toggles + Posting auto-fill helpers
 * --------------------------------------------------------- */
function _toggleQualCompleted(row) {
  const chk = _qs(row, ".js-qual-completed");
  const wrap = _qs(row, ".js-qual-end-wrap");
  const end = _qs(row, ".js-qual-end");
  if (!chk || !wrap || !end) return;

  if (chk.checked) {
    wrap.style.display = "";
    end.setAttribute("required", "required");
  } else {
    wrap.style.display = "none";
    end.removeAttribute("required");
    end.value = "";
    _clearError(end);
  }
}

function _togglePostCurrent(row) {
  const chk = _qs(row, ".js-post-current");
  const wrap = _qs(row, ".js-post-end-wrap");
  const end = _qs(row, ".js-post-end");
  if (!chk || !wrap || !end) return;

  if (chk.checked) {
    wrap.style.display = "none";
    end.value = "";
    _clearError(end);
  } else {
    wrap.style.display = "";
  }
}

function _setFirstPostingStartFromJoining(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]')?.value; // YYYY-MM-DD
  if (!joining) return;

  const firstRow = _qs(document, "#post_rows .hrmis-repeat-row");
  if (!firstRow) return;

  const start = _qs(firstRow, 'input[name="posting_start[]"]');
  if (!start) return;

  start.value = joining.slice(0, 7); // YYYY-MM
  start.dispatchEvent(new Event("change", { bubbles: true }));
}

function _autofillPostingEndDates() {
  const rows = _qsa(document, "#post_rows .hrmis-repeat-row");
  const starts = rows.map(
    (r) => _qs(r, 'input[name="posting_start[]"]')?.value || "",
  );

  rows.forEach((row, idx) => {
    const isCurrent = _qs(row, ".js-post-current")?.checked;
    const end = _qs(row, 'input[name="posting_end[]"]');
    const endWrap = _qs(row, ".js-post-end-wrap");

    if (!end) return;

    if (isCurrent) {
      end.value = "";
      if (endWrap) endWrap.style.display = "none";
      return;
    }

    const nextStart = starts[idx + 1];
    end.value = _isValidMonth(nextStart) ? nextStart : "";

    if (endWrap) endWrap.style.display = "";
  });
}

/* ---------------------------------------------------------
 * Template-based repeatable rows (Add button shows row)
 * --------------------------------------------------------- */
function _cloneFromTemplate(tplSel, containerSel) {
  const tpl = _qs(document, tplSel);
  const container = _qs(document, containerSel);
  if (!tpl || !container) return null;

  const row = tpl.content.firstElementChild?.cloneNode(true);
  if (!row) return null;

  // clear inputs/selects
  _qsa(row, "input").forEach((inp) => {
    const type = (inp.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox" || type === "radio") inp.checked = false;
    else inp.value = "";
    _clearError(inp);
  });
  _qsa(row, "select").forEach((sel) => {
    sel.selectedIndex = 0;
    _clearError(sel);
  });

  container.appendChild(row);
  return row;
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
  cnicInput.setAttribute("maxlength", "15"); // includes dashes

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
    contactInput.setSelectionRange(2, 2);
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
      contactInput.setSelectionRange(2, 2);
      return;
    }

    if (e.key === "Delete" && pos < 2) {
      e.preventDefault();
      contactInput.value = "03";
      contactInput.setSelectionRange(2, 2);
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
    contactInput.setSelectionRange(
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
 * Dates
 * --------------------------------------------------------- */
function _pad2(n) {
  return String(n).padStart(2, "0");
}

function _toLocalYmd(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = _pad2(d.getMonth() + 1);
  const day = _pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

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

function _minYmd(a, b) {
  if (!_isEmpty(a) && !_isEmpty(b)) return a < b ? a : b; // YYYY-MM-DD lexicographic works
  return !_isEmpty(a) ? a : b;
}

function _yesterdayLocalYmd() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return _toLocalYmd(d);
}

function _todayLocalYmd() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return _toLocalYmd(d);
}

/* ---------------------------------------------------------
 * Lightweight datepicker (leave rows only)
 * --------------------------------------------------------- */
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
  // User cannot select joining date or earlier for leave history.
  // So min selectable day is (joining date + 1 day).
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
  const title = `${monthNames[m0]} ${y}`;

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

  // (title variable kept as you had it — no removal; not displayed but harmless)
  void title;
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

function _syncLeaveTypeSelectsByGender(form) {
  const genderEl = _qs(form, '[name="gender"]');
  const gender = String(genderEl?.value || "")
    .trim()
    .toLowerCase();
  const selects = _qsa(document, '#leave_rows select[name="leave_type_id[]"]');
  if (!selects.length) return;

  for (const sel of selects) {
    if (!(sel instanceof HTMLSelectElement)) continue;

    if (!gender) {
      sel.disabled = true;
      _showError(sel, "Please select the gender first.");
      continue;
    }

    sel.disabled = false;
    _clearError(sel);

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
  }
}

function _applyLeaveOverlapRule(row, changedEl) {
  const startEl = _qs(row, 'input[name="leave_start[]"]');
  const endEl = _qs(row, 'input[name="leave_end[]"]');
  if (!startEl || !endEl) return true;

  const s = (startEl.value || "").trim();
  const e = (endEl.value || "").trim();

  if (changedEl) changedEl.setCustomValidity("");
  _clearError(startEl);
  _clearError(endEl);

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

  // If joining date is too recent, the allowed range can be empty (min > max).
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
  if (joinMin) start.min = joinMin;
  start.max = yesterday;
  if (start.value && start.value > yesterday) start.value = yesterday;
  if (joinMin && start.value && start.value < joinMin) start.value = joinMin;

  _attachHrmisLeaveDatePicker(start, () => ({
    min: _getAttrSafe(start, "min") || joinMin || "",
    max: _getAttrSafe(start, "max") || yesterday,
    disabledRanges: _collectLeaveRanges(row),
    openTo: joinMin || "",
  }));

  if (!start.value) {
    end.disabled = true;
    end.min = joinMin || "";
    end.max = today;
    if (end.value) end.value = "";
    _attachHrmisLeaveDatePicker(end, () => ({
      min: _getAttrSafe(end, "min") || joinMin || "",
      max: _getAttrSafe(end, "max") || today,
      disabledRanges: _collectLeaveRanges(row),
      openTo: joinMin || "",
    }));
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

  _attachHrmisLeaveDatePicker(end, () => ({
    min: _getAttrSafe(end, "min") || minEnd || "",
    max: _getAttrSafe(end, "max") || today,
    disabledRanges,
    openTo: minEnd || start.value || joinMin || "",
  }));

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

  // If there are no complete rows, do not overwrite the existing value
  // (submitted requests render rows read-only / not present).
  if (!hasAny) return;

  out.value = String(total);
}

function _initDates(form) {
  const today = new Date().toISOString().split("T")[0];
  ["hrmis_joining_date", "hrmis_commission_date"].forEach((name) => {
    const input = _qs(form, `[name="${name}"]`);
    if (input) input.setAttribute("max", today);
  });
}

/* ---------------------------------------------------------
 * Profile date pickers: reuse HRMIS calendar widget
 * - DOB uses its existing max constraint
 * - Commission date min = DOB
 * - Joining date min = Commission date
 * --------------------------------------------------------- */
function _initProfileDatePickers(form) {
  const dob = _qs(form, '[name="birthday"]');
  const comm = _qs(form, '[name="hrmis_commission_date"]');
  const join = _qs(form, '[name="hrmis_joining_date"]');

  // Attach calendar widget (same as leave datepicker)
  if (dob) {
    _attachHrmisLeaveDatePicker(dob, () => ({
      min: _getAttrSafe(dob, "min") || "",
      max: _getAttrSafe(dob, "max") || "",
      disabledRanges: [],
      openTo: dob.value || "",
    }));
  }

  if (comm) {
    const syncCommMinMax = () => {
      const v = (dob?.value || "").trim();
      comm.min = v || "";
      if (comm.value && v && comm.value < v) comm.value = "";

      // Commission cannot be after Joining (if joining selected)
      const jv = (join?.value || "").trim();
      if (jv) comm.max = jv;
    };
    syncCommMinMax();
    dob?.addEventListener("change", syncCommMinMax);
    join?.addEventListener("change", syncCommMinMax);

    _attachHrmisLeaveDatePicker(comm, () => ({
      min: (comm.min || "").trim(),
      max: _getAttrSafe(comm, "max") || "",
      disabledRanges: [],
      openTo: (dob?.value || "").trim() || comm.value || "",
    }));
  }

  if (join) {
    const syncJoinMin = () => {
      const v = (comm?.value || "").trim();
      join.min = v || "";
      if (join.value && v && join.value < v) join.value = "";

      // Require commission first (UX)
      const hasComm = !_isEmpty(v);
      join.disabled = !hasComm;
      if (!hasComm) {
        join.value = "";
        _setHint(join, "Select Commission Date first to enable Joining Date.");
      } else {
        _setHint(join, "");
      }
    };
    syncJoinMin();
    comm?.addEventListener("change", syncJoinMin);

    _attachHrmisLeaveDatePicker(join, () => ({
      min: (join.min || "").trim(),
      max: _getAttrSafe(join, "max") || "",
      disabledRanges: [],
      openTo: (comm?.value || "").trim() || join.value || "",
    }));
  }
}

/* ---------------------------------------------------------
 * Joining/Current BPS helpers
 * --------------------------------------------------------- */
function _joiningMonthValue(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]'); // YYYY-MM-DD
  const v = (joining?.value || "").trim();
  return v ? v.slice(0, 7) : ""; // YYYY-MM
}
function _currentBpsValue(form) {
  const bps = _qs(form, '[name="hrmis_bps"]');
  return _normInt(bps?.value);
}

/* ---------------------------------------------------------
 * Repeatable sections: Add/Remove + Posting district->facility filter
 * --------------------------------------------------------- */
function _filterFacilitiesInRow(row) {
  const district = _qs(row, ".js-post-district");
  const facility = _qs(row, ".js-post-facility");
  if (!district || !facility) return;

  const districtId = district.value || "";
  const options = Array.from(facility.options || []);

  options.forEach((opt) => {
    if (!opt.value) {
      opt.hidden = false;
      return;
    }
    const optDistrict = opt.getAttribute("data-district-id") || "";
    opt.hidden = !!(districtId && optDistrict && optDistrict !== districtId);
  });

  const sel = facility.options[facility.selectedIndex];
  if (sel && sel.hidden) facility.selectedIndex = 0;
}

/* ---------------------------------------------------------
 * Posting BPS <= Current BPS (previous posting rows)
 * --------------------------------------------------------- */
function _postingRows() {
  return _qsa(document, "#prev_post_rows .hrmis-repeat-row");
}

function _applyPostingBpsMaxFromCurrent(form, row) {
  const bpsInp = _qs(row, 'input[name="posting_bps[]"]');
  if (!bpsInp) return;

  const currentBps = _currentBpsValue(form);
  if (currentBps !== null && currentBps >= 1) {
    bpsInp.setAttribute("max", String(currentBps));
  } else {
    bpsInp.setAttribute("max", "22");
  }
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

  // If empty: other validations handle required; don't block here
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
      if (row) _toggleQualCompleted(row);
    });

  if (btnPrevPost)
    btnPrevPost.addEventListener("click", () => {
      const row = _cloneFromTemplate("#tpl_prev_post_row", "#prev_post_rows");
      if (row) {
        _filterFacilitiesInRow(row);
        _togglePostCurrent(row);
        _applyPostingBpsMaxFromCurrent(form, row);
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
    }
  });

  form.addEventListener("change", (e) => {
    const district = e.target.closest(".js-post-district");
    if (district) {
      const row = district.closest(".hrmis-repeat-row");
      if (row) _filterFacilitiesInRow(row);
    }

    if (
      e.target &&
      e.target.matches &&
      e.target.matches(
        'input[name="leave_start[]"], input[name="leave_end[]"], select[name="leave_type_id[]"]',
      )
    ) {
      const row = e.target.closest(".hrmis-repeat-row");
      if (row) {
        _syncLeaveRowDateConstraints(row);
        _applyLeaveOverlapRule(row, e.target);
      }
      _recalcLeavesTaken(form);
    }

    if (
      e.target &&
      e.target.matches &&
      e.target.matches('[name="hrmis_joining_date"]')
    ) {
      _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) =>
        _syncLeaveRowDateConstraints(row),
      );
    }

    if (e.target && e.target.matches && e.target.matches('[name="gender"]')) {
      _syncLeaveTypeSelectsByGender(form);
    }

    const qualChk = e.target.closest(".js-qual-completed");
    if (qualChk) {
      const row = qualChk.closest(".hrmis-repeat-row");
      if (row) _toggleQualCompleted(row);
    }

    const postChk = e.target.closest(".js-post-current");
    if (postChk) {
      const row = postChk.closest(".hrmis-repeat-row");
      if (row) _togglePostCurrent(row);
    }
  });

  form.addEventListener("input", (e) => {
    const t = e.target;
    if (!t) return;

    if (t.matches('input[name="posting_bps[]"]')) {
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
      t.matches(
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
}

/* ---------------------------------------------------------
 * Promotion History: strict chain
 * - auto-add next row
 * - next row From = previous To (locked)
 * - last To must equal Current BPS (if promos exist)
 * - To cannot exceed Current BPS
 * - To must be > From
 * - Promotion Date disabled until Joining selected; min=Joining month, max=today month
 * - Promotion BPS To disabled until Current BPS is filled
 * --------------------------------------------------------- */
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
      _showError(to, `BPS To cannot be greater than current BPS (${currentBps})`);
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
    // First row From is editable; subsequent rows can be locked by chain logic
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
    if (e.target && e.target.matches && e.target.matches('input[name="promotion_bps_from[]"]')) {
      _applyPromoToMinFromFrom(row);
    }
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
    const refresh = () => {
      _promoRows().forEach((r) => _syncPromoRowConstraints(form, r));
    };
    bps.addEventListener("input", refresh);
    bps.addEventListener("change", refresh);
  }
}

/* ---------------------------------------------------------
 * Validation for repeatable sections on submit
 * --------------------------------------------------------- */
function _validateRepeatables(form) {
  let hasError = false;

  // Qualification rows
  _qsa(document, "#qual_rows .hrmis-repeat-row").forEach((row) => {
    const degree = _qs(row, 'select[name="qualification_degree[]"]');
    const start = _qs(row, 'input[name="qualification_start[]"]');
    const end = _qs(row, 'input[name="qualification_end[]"]');
    const spec = _qs(row, 'input[name="qualification_specialization[]"]');
    const completed = _qs(row, ".js-qual-completed")?.checked;

    const emptyRow =
      _isEmpty(degree?.value) &&
      _isEmpty(start?.value) &&
      _isEmpty(end?.value) &&
      _isEmpty(spec?.value) &&
      !completed;

    if (emptyRow) {
      [degree, start, end, spec].forEach(_clearError);
      return;
    }

    if (_isEmpty(degree?.value)) {
      _showError(degree, "Degree is required");
      hasError = true;
    }
    if (_isEmpty(start?.value) || !_isValidMonth(start.value)) {
      _showError(start, "Start month is required (YYYY-MM)");
      hasError = true;
    }

    if (completed) {
      if (_isEmpty(end?.value) || !_isValidMonth(end.value)) {
        _showError(
          end,
          "End month is required when Completed is checked (YYYY-MM)",
        );
        hasError = true;
      } else if (_isValidMonth(start?.value) && _isValidMonth(end?.value)) {
        if (_monthToIndex(end.value) < _monthToIndex(start.value)) {
          _showError(end, "End month cannot be earlier than Start month");
          hasError = true;
        }
      }
    } else {
      if (end) _clearError(end);
    }
  });

  // Previous Posting rows  (FIXED: end + isCurrent defined)
  _qsa(document, "#prev_post_rows .hrmis-repeat-row").forEach((row) => {
    const district = _qs(row, 'select[name="posting_district_id[]"]');
    const designation = _qs(row, 'select[name="posting_designation_id[]"]');
    const bps = _qs(row, 'input[name="posting_bps[]"]');
    const start = _qs(row, 'input[name="posting_start[]"]');
    const end = _qs(row, 'input[name="posting_end[]"]');
    const facility = _qs(row, 'select[name="posting_facility_id[]"]');
    const isCurrent = _qs(row, ".js-post-current")?.checked;

    const emptyRow =
      _isEmpty(district?.value) &&
      _isEmpty(designation?.value) &&
      _isEmpty(bps?.value) &&
      _isEmpty(start?.value) &&
      _isEmpty(end?.value) &&
      _isEmpty(facility?.value) &&
      !isCurrent;

    if (emptyRow) {
      [district, designation, bps, start, end, facility].forEach(_clearError);
      return;
    }

    if (_isEmpty(district?.value)) {
      _showError(district, "District is required");
      hasError = true;
    }
    if (_isEmpty(designation?.value)) {
      _showError(designation, "Designation is required");
      hasError = true;
    }
    if (_isEmpty(bps?.value)) {
      _showError(bps, "BPS is required");
      hasError = true;
    }
    if (_isEmpty(start?.value) || !_isValidMonth(start.value)) {
      _showError(start, "Start month is required (YYYY-MM)");
      hasError = true;
    }
    if (_isEmpty(facility?.value)) {
      _showError(facility, "Facility is required");
      hasError = true;
    }

    // End month optional unless you want it required; keep your rule: validate only if provided and not current
    if (!isCurrent && !_isEmpty(end?.value)) {
      if (!_isValidMonth(end.value)) {
        _showError(end, "End month must be YYYY-MM");
        hasError = true;
      }
      if (_isValidMonth(start?.value) && _isValidMonth(end.value)) {
        if (_monthToIndex(end.value) < _monthToIndex(start.value)) {
          _showError(end, "End month cannot be earlier than Start month");
          hasError = true;
        }
      }
    } else {
      if (end) _clearError(end);
    }
  });

  // Promotion rows (strict chain)
  const promoRows = _promoRows();
  const currentBps = _currentBpsValue(form);
  const filledPromoRows = promoRows.filter((row) => {
    const from = _qs(row, 'input[name="promotion_bps_from[]"]')?.value || "";
    const to = _qs(row, 'input[name="promotion_bps_to[]"]')?.value || "";
    const date = _qs(row, 'input[name="promotion_date[]"]')?.value || "";
    return !(_isEmpty(from) && _isEmpty(to) && _isEmpty(date));
  });

  filledPromoRows.forEach((row, idx) => {
    const fromEl = _qs(row, 'input[name="promotion_bps_from[]"]');

    if (!_validatePromoRow(form, row)) hasError = true;

    // Chain: From must equal previous To
    if (idx > 0) {
      const prev = filledPromoRows[idx - 1];
      const prevTo = _normInt(_qs(prev, 'input[name="promotion_bps_to[]"]')?.value);
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

  // Leave rows
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

  // Leave rows overlap check (no reused days)
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

function _initPostingPrevToggle(form) {
  const joining = _qs(form, '[name="hrmis_joining_date"]'); // YYYY-MM-DD
  const currentStart = _qs(form, '[name="current_posting_start"]'); // YYYY-MM
  const wrap = _qs(document, ".js-prev-posting-wrap");

  if (!joining || !currentStart || !wrap) return;

  function compute() {
    const joiningVal = (joining.value || "").trim();
    const startVal = (currentStart.value || "").trim();

    const joiningMonth = joiningVal ? joiningVal.slice(0, 7) : ""; // YYYY-MM
    const startMonth = startVal;

    const show = !!(joiningMonth && startMonth && joiningMonth !== startMonth);

    wrap.style.display = show ? "" : "none";

    if (!show) {
      const prevRows = _qs(document, "#prev_post_rows");
      if (prevRows) prevRows.innerHTML = "";
    }
  }

  joining.addEventListener("change", compute);
  currentStart.addEventListener("change", compute);
  compute();
}

/* ---------------------------------------------------------
 * Main init
 * --------------------------------------------------------- */
function _initHRMISValidations() {
  const form = _qs(document, ".hrmis-form");
  if (!form) return;

  _initDates(form);
  _initProfileDatePickers(form);
  _initCNIC(form);
  _initContact(form);
  _initCnicScanFiles(form);

  _digitsOnly(_qs(form, '[name="hrmis_bps"]'), { maxLen: 2 });
  _digitsOnly(_qs(form, '[name="hrmis_merit_number"]'), { maxLen: 20 });
  _initPostingPrevToggle(form);

  const leavesTakenEl = _qs(form, '[name="hrmis_leaves_taken"]');
  if (leavesTakenEl) {
    leavesTakenEl.readOnly = true;
    leavesTakenEl.setAttribute("readonly", "readonly");
  }

  _initRepeatables(form);
  _initPromotionChain(form);

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

  const requiredFields = [
    "hrmis_cnic",
    "hrmis_father_name",
    "birthday",
    "gender",
    "hrmis_cadre",
    "hrmis_designation",
    "hrmis_bps",
    "district_id",
    "facility_id",
    "hrmis_merit_number",
    "hrmis_joining_date",
    "hrmis_commission_date",
  ];

  form.addEventListener("submit", function (e) {
    let hasError = false;

    requiredFields.forEach((name) => {
      const input = _qs(form, `[name="${name}"]`);
      if (input && _isEmpty(input.value)) {
        _showError(input, "This field is required");
        hasError = true;
      }
    });

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

    const repeatHasError = _validateRepeatables(form);
    if (repeatHasError) hasError = true;
    if (form._hrmisValidateCnicFiles && !form._hrmisValidateCnicFiles()) {
      hasError = true;
    }

    if (hasError) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

/* ---------------------------------------------------------
 * File validation: CNIC scans (front/back)
 * - Max size: 4MB
 * - Allowed: pdf, jpg, jpeg, png, svg
 * - Uses existing _showError/_clearError and blocks submit via hasError
 * --------------------------------------------------------- */
function _initCnicScanFiles(form) {
  const MAX_BYTES = 4 * 1024 * 1024; // 4MB
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

    // Clear previous
    input.setCustomValidity("");
    _clearError(input);

    // No file selected => OK here (required is handled by your t-att-required and submit requiredFields if you add it)
    const file = input.files && input.files[0];
    if (!file) return true;

    const ext = _extOf(file.name);
    const mime = String(file.type || "").toLowerCase();

    // Extension check (primary)
    if (!allowedExt.has(ext)) {
      const msg = "Invalid file type. Allowed: PDF, JPG, JPEG, PNG, SVG.";
      _showError(input, msg);
      input.setCustomValidity(msg);
      // Reset selection so user must pick again
      input.value = "";
      return false;
    }

    // MIME check (secondary — browsers sometimes provide empty type, especially for svg)
    if (mime && !allowedMime.has(mime)) {
      // accept svg if browser reports empty type but extension is svg (already allowed above)
      if (!(ext === "svg" && mime === "")) {
        const msg = "Invalid file format. Allowed: PDF, JPG, JPEG, PNG, SVG.";
        _showError(input, msg);
        input.setCustomValidity(msg);
        input.value = "";
        return false;
      }
    }

    // Size check
    if (file.size > MAX_BYTES) {
      const msg = `File too large (${_humanMB(file.size)}). Max allowed is 4.00 MB.`;
      _showError(input, msg);
      input.setCustomValidity(msg);
      input.value = "";
      return false;
    }

    // All good
    _clearError(input);
    input.setCustomValidity("");
    return true;
  }

  // Validate on change
  inputs.forEach((inp) => {
    inp.addEventListener("change", () => validateFileInput(inp));
  });

  // Hook into submit by exposing a checker on the form
  form._hrmisValidateCnicFiles = () => {
    let ok = true;
    inputs.forEach((inp) => {
      if (!validateFileInput(inp)) ok = false;
    });
    return ok;
  };
}

function _initHRMIS() {
  _initHRMISValidations();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initHRMIS);
} else {
  _initHRMIS();
}
window.addEventListener("pageshow", _initHRMIS);
