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
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
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
    const [y, m] = String(v).split("-").map((x) => parseInt(x, 10));
    return (y * 12) + (m - 1);
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
    const starts = rows.map((r) => _qs(r, 'input[name="posting_start[]"]')?.value || "");

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
 * NEW: Template-based repeatable rows (Add button shows row, no always-visible row)
 * Requires QWeb:
 *   <div id="qual_rows"></div> + <template id="tpl_qual_row">...</template>
 *   same for post/promo/leave
 * --------------------------------------------------------- */
function _cloneFromTemplate(tplIdSel, containerSel) {
    const tpl = _qs(document, tplIdSel);
    const container = _qs(document, containerSel);
    if (!tpl || !container) return null;

    // <template> element
    const frag = tpl.content.cloneNode(true);
    const row = frag.firstElementChild;
    if (!row) return null;

    // reset inputs/selects
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
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
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
        const text = (e.clipboardData || window.clipboardData).getData("text") || "";
        let v = text.replace(/\D/g, "");
        if (!v.startsWith("03")) v = "03" + v.replace(/^0+/, "");
        v = v.slice(0, 11);
        contactInput.value = v;
        contactInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    contactInput.addEventListener("focus", () => {
        normalize();
        contactInput.setSelectionRange(contactInput.value.length, contactInput.value.length);
    });

    contactInput.addEventListener("input", () => {
        normalize();

        if (contactInput.value && !contactRegex.test(contactInput.value)) {
            _showError(contactInput, "Contact must be 11 digits and start with 03 (e.g., 03XXXXXXXXX)");
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
 * Lightweight datepicker (for disabling arbitrary dates)
 * --------------------------------------------------------- */
let _hrmisDatePickerStyleInjected = false;
let _hrmisDatePickerPopup = null;
let _hrmisDatePickerState = null; // { input, monthDate, min, max, disabledRanges }

function _injectHrmisDatePickerStyles() {
    if (_hrmisDatePickerStyleInjected) return;
    _hrmisDatePickerStyleInjected = true;
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

function _ensureHrmisDatePickerPopup() {
    _injectHrmisDatePickerStyles();
    if (_hrmisDatePickerPopup) return _hrmisDatePickerPopup;
    const el = document.createElement("div");
    el.className = "hrmis-datepop";
    el.style.display = "none";
    document.body.appendChild(el);
    _hrmisDatePickerPopup = el;

    // Close on outside click / escape
    document.addEventListener("mousedown", (ev) => {
        if (!_hrmisDatePickerPopup || _hrmisDatePickerPopup.style.display === "none") return;
        const t = ev.target;
        if (t && (_hrmisDatePickerPopup.contains(t) || (_hrmisDatePickerState?.input && _hrmisDatePickerState.input.contains(t)))) return;
        _closeHrmisDatePicker();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") _closeHrmisDatePicker();
    });
    return el;
}

function _closeHrmisDatePicker() {
    if (_hrmisDatePickerPopup) _hrmisDatePickerPopup.style.display = "none";
    _hrmisDatePickerState = null;
}

function _startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function _daysInMonthLocal(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function _ymdForLocal(y, m0, day) {
    // m0 is 0-based month
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

function _renderHrmisDatePicker() {
    const popup = _ensureHrmisDatePickerPopup();
    const st = _hrmisDatePickerState;
    if (!popup || !st || !st.input) return;

    const monthDate = _startOfMonth(st.monthDate || new Date());
    const y = monthDate.getFullYear();
    const m0 = monthDate.getMonth();
    const selected = (st.input.value || "").trim();
    const today = _todayLocalYmd();

    // Header
    const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    const title = `${monthNames[m0]} ${y}`;

    // Determine prev/next month availability (based on min/max loosely)
    const prevMonth = new Date(y, m0 - 1, 1);
    const nextMonth = new Date(y, m0 + 1, 1);
    const min = st.min || "";
    const max = st.max || "";
    const prevOk = !min || _toLocalYmd(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0)) >= min;
    const nextOk = !max || _toLocalYmd(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1)) <= max;

    popup.innerHTML = `
      <div class="hrmis-datepop__head">
        <button type="button" class="hrmis-datepop__btn js-prev"${prevOk ? "" : " disabled"}>&lt;</button>
        <div class="hrmis-datepop__title">${title}</div>
        <button type="button" class="hrmis-datepop__btn js-next"${nextOk ? "" : " disabled"}>&gt;</button>
      </div>
      <div class="hrmis-datepop__grid js-grid"></div>
    `;

    const grid = popup.querySelector(".js-grid");
    if (!grid) return;
    const dows = ["Su","Mo","Tu","We","Th","Fr","Sa"];
    for (const d of dows) {
        const dow = document.createElement("div");
        dow.className = "hrmis-datepop__dow";
        dow.textContent = d;
        grid.appendChild(dow);
    }

    const firstDay = new Date(y, m0, 1).getDay();
    const days = _daysInMonthLocal(monthDate);
    // blanks
    for (let i = 0; i < firstDay; i++) {
        const blank = document.createElement("div");
        grid.appendChild(blank);
    }

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
            _closeHrmisDatePicker();
        });
        grid.appendChild(btn);
    }

    popup.querySelector(".js-prev")?.addEventListener("click", () => {
        _hrmisDatePickerState.monthDate = prevMonth;
        _renderHrmisDatePicker();
    });
    popup.querySelector(".js-next")?.addEventListener("click", () => {
        _hrmisDatePickerState.monthDate = nextMonth;
        _renderHrmisDatePicker();
    });
}

function _openHrmisDatePicker(input, { min = "", max = "", disabledRanges = [] } = {}) {
    const popup = _ensureHrmisDatePickerPopup();
    if (!popup) return;
    const rect = input.getBoundingClientRect();
    _hrmisDatePickerState = {
        input,
        monthDate: _parseLocalYmd(input.value) || new Date(),
        min,
        max,
        disabledRanges,
    };
    _renderHrmisDatePicker();
    popup.style.left = `${Math.max(8, rect.left + window.scrollX)}px`;
    popup.style.top = `${rect.bottom + window.scrollY + 6}px`;
    popup.style.display = "block";
}

function _attachHrmisDatePicker(input, getOptions) {
    if (!input || input._hrmisDatePickerAttached) return;
    input._hrmisDatePickerAttached = true;
    // Force our picker instead of native.
    try { input.type = "text"; } catch { /* ignore */ }
    input.setAttribute("inputmode", "none");
    input.setAttribute("autocomplete", "off");
    input.readOnly = true;
    input.addEventListener("click", () => {
        if (input.disabled) return;
        const opts = (typeof getOptions === "function" ? getOptions() : {}) || {};
        _openHrmisDatePicker(input, opts);
    });
    input.addEventListener("focus", () => {
        // On focus, open as well (keyboard navigation).
        if (input.disabled) return;
        const opts = (typeof getOptions === "function" ? getOptions() : {}) || {};
        _openHrmisDatePicker(input, opts);
    });
}

function _getAttr(input, name) {
    try {
        return (input && input.getAttribute && input.getAttribute(name)) || "";
    } catch {
        return "";
    }
}

function _setDateBoundsAttrs(input, { min = "", max = "" } = {}) {
    if (!input || !input.setAttribute) return;
    if (min) input.setAttribute("min", min);
    else input.removeAttribute("min");
    if (max) input.setAttribute("max", max);
    else input.removeAttribute("max");
}

function _rangesOverlapYmd(aStart, aEnd, bStart, bEnd) {
    // All args are YYYY-MM-DD; lexicographic compare is safe.
    if (_isEmpty(aStart) || _isEmpty(aEnd) || _isEmpty(bStart) || _isEmpty(bEnd)) return false;
    return !(aEnd < bStart || aStart > bEnd);
}

function _collectLeaveRanges(excludeRow) {
    const out = [];
    _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
        if (excludeRow && row === excludeRow) return;
        const start = _qs(row, 'input[name="leave_start[]"]')?.value || "";
        const end = _qs(row, 'input[name="leave_end[]"]')?.value || "";
        if (_isEmpty(start) || _isEmpty(end)) return;
        // Only keep valid YMD values.
        if (!_parseLocalYmd(start) || !_parseLocalYmd(end)) return;
        out.push({ start, end });
    });
    return out;
}

function _applyLeaveOverlapRule(row, changedEl) {
    const startEl = _qs(row, 'input[name="leave_start[]"]');
    const endEl = _qs(row, 'input[name="leave_end[]"]');
    if (!startEl || !endEl) return true;

    const s = (startEl.value || "").trim();
    const e = (endEl.value || "").trim();

    // Clear previous overlap errors for this row.
    if (changedEl) changedEl.setCustomValidity("");
    _clearError(startEl);
    _clearError(endEl);

    const others = _collectLeaveRanges(row);

    // If only start is selected, at least block picking a start day that is already used.
    if (s && !e) {
        const hit = others.find((r) => _rangesOverlapYmd(s, s, r.start, r.end));
        if (hit) {
            const msg = `This date overlaps an existing leave (${hit.start} to ${hit.end}).`;
            _showError(startEl, msg);
            startEl.setCustomValidity(msg);
            // Force a different pick.
            startEl.value = "";
            return false;
        }
        return true;
    }

    // If both are selected, block any overlap with other ranges.
    if (s && e) {
        const hit = others.find((r) => _rangesOverlapYmd(s, e, r.start, r.end));
        if (hit) {
            const msg = `These dates overlap an existing leave (${hit.start} to ${hit.end}).`;
            // Attach error to the field that changed (prefer end, otherwise start).
            const target = changedEl || endEl;
            _showError(target, msg);
            target.setCustomValidity(msg);
            // Clear the changed field to effectively "disable" those days for this row.
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

    // Start date: only allow dates strictly BEFORE today.
    const yesterday = _yesterdayLocalYmd();
    const today = _todayLocalYmd();
    _setDateBoundsAttrs(start, { min: "", max: yesterday });
    if (start.value && start.value > yesterday) start.value = yesterday;

    // Attach datepicker with disabled ranges (other leaves)
    _attachHrmisDatePicker(start, () => ({
        min: "",
        max: _getAttr(start, "max") || yesterday,
        disabledRanges: _collectLeaveRanges(row),
    }));

    // End date: only enable after a start date is chosen.
    if (!start.value) {
        end.disabled = true;
        _setDateBoundsAttrs(end, { min: "", max: today }); // user requirement: "till today"
        if (end.value) end.value = "";
        _attachHrmisDatePicker(end, () => ({
            min: "",
            max: _getAttr(end, "max") || today,
            disabledRanges: _collectLeaveRanges(row),
        }));
        _applyLeaveOverlapRule(row, start);
        return;
    }

    end.disabled = false;

    // End date must be at least 7 days AFTER start date.
    // i.e. earliest end = (start + 7 days).
    const minEnd = _addDaysLocalYmd(start.value, 7);
    _setDateBoundsAttrs(end, { min: minEnd || "", max: today });

    // End date can be selected up to today.
    // (already set via bounds)

    _attachHrmisDatePicker(end, () => ({
        min: _getAttr(end, "min") || (minEnd || ""),
        max: _getAttr(end, "max") || today,
        disabledRanges: _collectLeaveRanges(row),
    }));

    // If range is impossible, disable end input.
    const endMin = _getAttr(end, "min") || "";
    const endMax = _getAttr(end, "max") || "";
    if (endMin && endMax && endMin > endMax) {
        end.disabled = true;
        end.value = "";
        return;
    }

    if (end.value) {
        if (endMin && end.value < endMin) end.value = endMin;
        if (endMax && end.value > endMax) end.value = endMax;
    }
    _applyLeaveOverlapRule(row, end);
}

function _normLeaveTypeForCalc(name) {
    return String(name || "").trim().toLowerCase();
}

function _leaveContributionFromTypeName(name, effectiveDays) {
    const s = _normLeaveTypeForCalc(name);
    // Explicit 0-count types
    if (
        s.includes("without pay") ||
        s.includes("unpaid") ||
        s.includes(" eol") ||
        s.includes("eol") ||
        s.includes("medical") ||
        s.includes("maternity")
    )
        return 0;

    // Half-pay: follow backend rounding (upper-bound half), e.g. 3 days => 2.
    if (s.includes("half pay")) return Math.ceil((Number(effectiveDays || 0) || 0) / 2);

    // Full-pay / earned / LPR: 1:1 effective days.
    if (s.includes("full pay") || s.includes("earned") || s.includes("lpr"))
        return Number(effectiveDays || 0) || 0;

    // Default: don't count
    return 0;
}

function _daysInclusiveLocal(startYmd, endYmd) {
    const s = _parseLocalYmd(startYmd);
    const e = _parseLocalYmd(endYmd);
    if (!s || !e) return 0;
    // Normalize to midnight local
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
    _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
        const typeSel = _qs(row, 'select[name="leave_type_id[]"]');
        const start = _qs(row, 'input[name="leave_start[]"]');
        const end = _qs(row, 'input[name="leave_end[]"]');
        if (!typeSel || !start || !end) return;
        if (_isEmpty(typeSel.value) || _isEmpty(start.value) || _isEmpty(end.value)) return;

        const optText = typeSel.selectedOptions?.[0]?.textContent || "";
        const days = _daysInclusiveLocal(start.value, end.value);
        if (!days) return;
        total += _leaveContributionFromTypeName(optText, days);
    });

    // Keep as number string. Always set something to satisfy "required".
    out.value = String(total);
}

function _initDates(form) {
    const today = new Date().toISOString().split("T")[0];
    ["hrmis_joining_date", "hrmis_commission_date"].forEach((name) => {
        const input = _qs(form, `[name="${name}"]`);
        if (input) input.setAttribute("max", today);
    });

    // Apply the same calendar UI to these date fields too.
    const dob = _qs(form, '[name="birthday"]');
    const comm = _qs(form, '[name="hrmis_commission_date"]');
    const join = _qs(form, '[name="hrmis_joining_date"]');

    if (dob) {
        _attachHrmisDatePicker(dob, () => ({
            min: "",
            max: _getAttr(dob, "max") || "",
            disabledRanges: [],
        }));
    }
    if (comm) {
        _attachHrmisDatePicker(comm, () => ({
            min: "",
            max: _getAttr(comm, "max") || today,
            disabledRanges: [],
        }));
    }
    if (join) {
        _attachHrmisDatePicker(join, () => ({
            min: "",
            max: _getAttr(join, "max") || today,
            disabledRanges: [],
        }));
    }
}

/* ---------------------------------------------------------
 * Repeatable sections: Add/Remove + Posting district->facility filter
 * (UPDATED: template-based; show row only on Add)
 * --------------------------------------------------------- */
function _filterFacilitiesInRow(row) {
    const district = _qs(row, ".js-post-district");
    const facility = _qs(row, ".js-post-facility");
    if (!district || !facility) return;

    const districtId = district.value || "";
    const options = Array.from(facility.options || []);

    options.forEach((opt) => {
        if (!opt.value) { opt.hidden = false; return; }
        const optDistrict = opt.getAttribute("data-district-id") || "";
        opt.hidden = !!(districtId && optDistrict && optDistrict !== districtId);
    });

    const sel = facility.options[facility.selectedIndex];
    if (sel && sel.hidden) facility.selectedIndex = 0;
}

function _removeRepeatRow(btn) {
    const row = btn.closest(".hrmis-repeat-row");
    if (row) row.remove();
}

function _initRepeatables(form) {
    const btnQual = _qs(document, "#btn_add_qual_row");
    const btnPost = _qs(document, "#btn_add_post_row");
    const btnPromo = _qs(document, "#btn_add_promo_row");
    const btnLeave = _qs(document, "#btn_add_leave_row");

    // Add = clone from templates
    if (btnQual) btnQual.addEventListener("click", () => {
        const row = _cloneFromTemplate("#tpl_qual_row", "#qual_rows");
        if (row) _toggleQualCompleted(row);
    });

    if (btnPost) btnPost.addEventListener("click", () => {
        const row = _cloneFromTemplate("#tpl_post_row", "#post_rows");
        if (row) {
            _filterFacilitiesInRow(row);
            _togglePostCurrent(row);
        }
    });

    if (btnPromo) btnPromo.addEventListener("click", () => {
        _cloneFromTemplate("#tpl_promo_row", "#promo_rows");
    });

    if (btnLeave) btnLeave.addEventListener("click", () => {
        const row = _cloneFromTemplate("#tpl_leave_row", "#leave_rows");
        if (row) {
            _syncLeaveRowDateConstraints(row);
            _recalcLeavesTaken(form);
        }
    });

    // Remove (delegation)
    form.addEventListener("click", (e) => {
        const btn = e.target.closest(".btn_remove_row");
        if (btn) {
            e.preventDefault();
            _removeRepeatRow(btn);
            _recalcLeavesTaken(form);
        }
    });

    // Delegation: posting district + completed/current toggles
    form.addEventListener("change", (e) => {
        const district = e.target.closest(".js-post-district");
        if (district) {
            const row = district.closest(".hrmis-repeat-row");
            if (row) _filterFacilitiesInRow(row);
        }

        if (e.target && e.target.matches && e.target.matches('input[name="leave_start[]"], input[name="leave_end[]"], select[name="leave_type_id[]"]')) {
            const row = e.target.closest(".hrmis-repeat-row");
            if (row) {
                _syncLeaveRowDateConstraints(row);
                _applyLeaveOverlapRule(row, e.target);
            }
            _recalcLeavesTaken(form);
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

    // Digits-only for dynamic fields (delegation)
    form.addEventListener("input", (e) => {
        const t = e.target;
        if (!t) return;

        if (t.matches('input[name="posting_bps[]"]')) {
            const raw = t.value || "";
            const digits = raw.replace(/\D/g, "").slice(0, 2);
            if (digits !== raw) t.value = digits;
        }

        if (t.matches('input[name="promotion_bps_from[]"], input[name="promotion_bps_to[]"]')) {
            const raw = t.value || "";
            const digits = raw.replace(/\D/g, "").slice(0, 2);
            if (digits !== raw) t.value = digits;
        }
    });

    // Ensure any pre-rendered leave rows get constraints too.
    _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => _syncLeaveRowDateConstraints(row));
    _recalcLeavesTaken(form);
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

        if (_isEmpty(degree?.value)) { _showError(degree, "Degree is required"); hasError = true; }
        if (_isEmpty(start?.value) || !_isValidMonth(start.value)) { _showError(start, "Start month is required (YYYY-MM)"); hasError = true; }

        // End required only if completed
        if (completed) {
            if (_isEmpty(end?.value) || !_isValidMonth(end.value)) {
                _showError(end, "End month is required when Completed is checked (YYYY-MM)");
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

    // Posting rows
    _qsa(document, "#post_rows .hrmis-repeat-row").forEach((row) => {
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

        if (_isEmpty(district?.value)) { _showError(district, "District is required"); hasError = true; }
        if (_isEmpty(designation?.value)) { _showError(designation, "Designation is required"); hasError = true; }
        if (_isEmpty(bps?.value)) { _showError(bps, "BPS is required"); hasError = true; }
        if (_isEmpty(start?.value) || !_isValidMonth(start.value)) { _showError(start, "Start month is required (YYYY-MM)"); hasError = true; }

        if (!isCurrent && !_isEmpty(end?.value)) {
            if (!_isValidMonth(end.value)) { _showError(end, "End month must be YYYY-MM"); hasError = true; }
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

    // Promotion rows
    _qsa(document, "#promo_rows .hrmis-repeat-row").forEach((row) => {
        const from = _qs(row, 'input[name="promotion_bps_from[]"]');
        const to = _qs(row, 'input[name="promotion_bps_to[]"]');
        const date = _qs(row, 'input[name="promotion_date[]"]');

        const emptyRow = _isEmpty(from?.value) && _isEmpty(to?.value) && _isEmpty(date?.value);
        if (emptyRow) {
            [from, to, date].forEach(_clearError);
            return;
        }

        if (_isEmpty(from?.value)) { _showError(from, "BPS From is required"); hasError = true; }
        if (_isEmpty(to?.value)) { _showError(to, "BPS To is required"); hasError = true; }
        if (_isEmpty(date?.value) || !_isValidMonth(date.value)) { _showError(date, "Promotion month is required (YYYY-MM)"); hasError = true; }

        if (!_isEmpty(from?.value) && !_isEmpty(to?.value)) {
            const f = parseInt(from.value, 10);
            const t = parseInt(to.value, 10);
            if (!Number.isNaN(f) && !Number.isNaN(t) && t <= f) {
                _showError(to, "BPS To must be greater than BPS From");
                hasError = true;
            }
        }
    });

    // Leave rows
    _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
        const type = _qs(row, 'select[name="leave_type_id[]"]');
        const start = _qs(row, 'input[name="leave_start[]"]');
        const end = _qs(row, 'input[name="leave_end[]"]');

        const emptyRow = _isEmpty(type?.value) && _isEmpty(start?.value) && _isEmpty(end?.value);
        if (emptyRow) {
            [type, start, end].forEach(_clearError);
            return;
        }

        if (_isEmpty(type?.value)) { _showError(type, "Leave type is required"); hasError = true; }
        if (_isEmpty(start?.value)) { _showError(start, "Start date is required"); hasError = true; }
        if (_isEmpty(end?.value)) { _showError(end, "End date is required"); hasError = true; }

        const yesterday = _yesterdayLocalYmd();
        const today = _todayLocalYmd();
        if (!_isEmpty(start?.value) && !_isEmpty(yesterday) && start.value > yesterday) {
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

/* ---------------------------------------------------------
 * Main init
 * --------------------------------------------------------- */
function _initHRMISValidations() {
    const form = _qs(document, ".hrmis-form");
    if (!form) return;

    _initDates(form);
    _initCNIC(form);
    _initContact(form);

    // existing numeric fields
    _digitsOnly(_qs(form, '[name="hrmis_bps"]'), { maxLen: 2 });
    _digitsOnly(_qs(form, '[name="hrmis_merit_number"]'), { maxLen: 20 });

    // Total leaves taken is auto-calculated and read-only.
    const leavesTakenEl = _qs(form, '[name="hrmis_leaves_taken"]');
    if (leavesTakenEl) {
        leavesTakenEl.readOnly = true;
        leavesTakenEl.setAttribute("readonly", "readonly");
    }

    // init repeatables (UPDATED)
    _initRepeatables(form);

    // required fields (Employee ID NOT required)
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

        // required
        requiredFields.forEach((name) => {
            const input = _qs(form, `[name="${name}"]`);
            if (input && _isEmpty(input.value)) {
                _showError(input, "This field is required");
                hasError = true;
            }
        });

        // DOB 18+
        const dobVal = _qs(form, '[name="birthday"]')?.value;
        if (dobVal) {
            const dob = new Date(dobVal + "T00:00:00");
            const now = new Date();
            let age = now.getFullYear() - dob.getFullYear();
            const m = now.getMonth() - dob.getMonth();
            if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
            if (age < 18) {
                _showError(_qs(form, '[name="birthday"]'), "Employee must be at least 18 years old");
                hasError = true;
            }
        }

        // validate repeatable sections
        const repeatHasError = _validateRepeatables(form);
        if (repeatHasError) hasError = true;

        if (hasError) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
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
