/** @odoo-module **/

// HRMIS: leaves-taken auto-calculation for profile request leave history
// Aligns with Sunday-only policy used in hr.leave custom logic:
// - Base: count all days except Sunday
// - Sandwich: count Sunday(s) strictly between first and last working day (Mon–Sat)

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}
function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _parseYmdUtc(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function _addDaysUtc(dt, n) {
  return new Date(dt.getTime() + Number(n || 0) * 24 * 60 * 60 * 1000);
}

function _cmpUtc(a, b) {
  const ta = a?.getTime?.();
  const tb = b?.getTime?.();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return 0;
}

function _calendarDaysInclusiveUtc(startUtc, endUtc) {
  const ms = endUtc.getTime() - startUtc.getTime();
  if (ms < 0 || Number.isNaN(ms)) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
}

function _isSundayUtc(dt) {
  // getUTCDay(): 0=Sun ... 6=Sat
  return dt.getUTCDay() === 0;
}

function _effectiveDaysSundayOnly(startYmd, endYmd) {
  const s = _parseYmdUtc(startYmd);
  const e = _parseYmdUtc(endYmd);
  if (!s || !e) return 0;
  if (_cmpUtc(e, s) < 0) return 0;

  // base: count Mon–Sat (exclude Sunday)
  let base = 0;
  for (let cur = s; _cmpUtc(cur, e) <= 0; cur = _addDaysUtc(cur, 1)) {
    if (!_isSundayUtc(cur)) base += 1;
  }

  // sandwich: count Sunday(s) strictly between first and last workday
  let firstWork = null;
  for (let cur = s; _cmpUtc(cur, e) <= 0; cur = _addDaysUtc(cur, 1)) {
    if (!_isSundayUtc(cur)) {
      firstWork = cur;
      break;
    }
  }
  let lastWork = null;
  for (let cur = e; _cmpUtc(cur, s) >= 0; cur = _addDaysUtc(cur, -1)) {
    if (!_isSundayUtc(cur)) {
      lastWork = cur;
      break;
    }
  }

  let sandwich = 0;
  if (firstWork && lastWork && _cmpUtc(firstWork, lastWork) < 0) {
    for (let cur = _addDaysUtc(firstWork, 1); _cmpUtc(cur, lastWork) < 0; cur = _addDaysUtc(cur, 1)) {
      if (_isSundayUtc(cur)) sandwich += 1;
    }
  }

  const cal = _calendarDaysInclusiveUtc(s, e);
  return Math.min(base + sandwich, cal);
}

function _normLeaveTypeForCalc(name) {
  return String(name || "").trim().toLowerCase();
}

function _leaveContributionFromTypeName(name, effectiveDays) {
  const s = _normLeaveTypeForCalc(name);
  const days = Number(effectiveDays || 0) || 0;

  if (
    s.includes("without pay") ||
    s.includes("unpaid") ||
    s.includes(" eol") ||
    s.includes("eol") ||
    s.includes("medical") ||
    s.includes("maternity")
  ) {
    return 0;
  }

  if (s.includes("half pay")) return Math.ceil(days / 2);

  if (s.includes("full pay") || s.includes("earned") || s.includes("lpr")) return days;

  return 0;
}

function _recalcLeavesTakenPolicy(form) {
  const out = _qs(form, 'input[name="hrmis_leaves_taken"]');
  if (!out) return;

  let total = 0;
  _qsa(document, "#leave_rows .hrmis-repeat-row").forEach((row) => {
    const typeSel = _qs(row, 'select[name="leave_type_id[]"]');
    const start = _qs(row, 'input[name="leave_start[]"]');
    const end = _qs(row, 'input[name="leave_end[]"]');
    if (!typeSel || !start || !end) return;
    if (!typeSel.value || !start.value || !end.value) return;

    const optText = typeSel.selectedOptions?.[0]?.textContent || "";
    const eff = _effectiveDaysSundayOnly(start.value, end.value);
    if (!eff) return;
    total += _leaveContributionFromTypeName(optText, eff);
  });

  out.value = String(total || 0);
}

function _wireLeavesTakenPolicy() {
  const form = document.querySelector("#profile_update_form");
  if (!form) return;

  // Always recalc on entry (safe + cheap).
  _recalcLeavesTakenPolicy(form);

  // Prevent double-binding (BFCache/pageshow or repeated script eval).
  if (form.dataset.hrmisLeavesTakenPolicyInit === "1") return;
  form.dataset.hrmisLeavesTakenPolicyInit = "1";

  function scheduleRecalc() {
    // Let other handlers (existing profile_validation.js) run first.
    setTimeout(() => _recalcLeavesTakenPolicy(form), 0);
  }

  form.addEventListener(
    "change",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (
        t.matches(
          'input[name="leave_start[]"], input[name="leave_end[]"], select[name="leave_type_id[]"]',
        )
      ) {
        scheduleRecalc();
      }
    },
    true,
  );

  // Row add/remove buttons
  form.addEventListener(
    "click",
    (ev) => {
      const btn = ev.target instanceof Element ? ev.target.closest("#btn_add_leave_row, .btn_remove_row") : null;
      if (!btn) return;
      scheduleRecalc();
    },
    true,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _wireLeavesTakenPolicy);
} else {
  _wireLeavesTakenPolicy();
}

// BFCache restore
window.addEventListener("pageshow", () => {
  const form = document.querySelector("#profile_update_form");
  if (!form) return;
  _recalcLeavesTakenPolicy(form);
});

