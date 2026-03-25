/** @odoo-module **/

// HRMIS:
// Filter designation dropdown based on entered BPS (BPS-only)
// Works across the whole form (including repeatable rows)

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _norm(v) {
  return (v || "").toString().trim();
}

function _canonBps(v) {
  // Accepts: "18", "BS-18", "BPS 18", "BS 18", etc.
  // Returns numeric string if found, else normalized string.
  const s = _norm(v);
  const m = s.match(/\b(\d{1,2})\b/);
  return m ? m[1] : s;
}

function _isOther(v) {
  return _norm(v) === "__other__";
}

function _ensureInitialValue(designationSelect) {
  if (!designationSelect || designationSelect.dataset.hrmisInitialValueBound === "1") {
    return;
  }
  designationSelect.dataset.hrmisInitialValueBound = "1";
  designationSelect.dataset.hrmisInitialValue = _norm(designationSelect.value);
}

function _isHiddenOption(opt) {
  return !!(opt && (opt.hidden === true || opt.style.display === "none"));
}

function _setOptionVisible(opt, visible) {
  opt.hidden = !visible;
  opt.style.display = visible ? "" : "none";
}

function _getCtx(el, form) {
  return (
    el.closest(".js-status-box") ||
    el.closest(".hrmis-form__grid") ||
    el.closest(".hrmis-repeatable-row") ||
    el.closest(".hrmis-repeat-row") ||
    el.closest(".repeatable_row") ||
    el.closest("tr") ||
    el.closest(".row") ||
    form
  );
}

function _initBpsDesignationFilter() {
  const form = _qs(document, "#profile_update_form") || document;
  const isSubmittedView = !!form?.classList?.contains?.("is-submitted");

  // Read-only submitted screens should keep server-rendered selections untouched.
  if (isSubmittedView) {
    return;
  }

  if (form && form.dataset && form.dataset.hrmisBpsFilterBound === "1") {
    console.info("[HRMIS][BPS] already bound, skipping rebind");
    return;
  }
  if (form && form.dataset) form.dataset.hrmisBpsFilterBound = "1";

  const designationSelector = [
    "select.js-designation-select",
    'select[name="hrmis_designation"]',
    'select[name="designation_id"]',
    'select[name="posting_designation_id[]"]',
    'select[name="allowed_designation_id"]',
    'select[name="frontend_reporting_designation_id"]',
    'select[name="frontend_onleave_designation_id"]',
  ].join(", ");

  const bpsSelector = [
    ".js-hrmis-bps",
    "input.js-hrmis-bps",
    "select.js-hrmis-bps",
    'input[name="hrmis_bps"]',
    'select[name="hrmis_bps"]',
    'input[name="bps"]',
    'select[name="bps"]',
    'input[name="bps_id"]',
    'select[name="bps_id"]',
    'input[name="posting_bps[]"]',
    'select[name="posting_bps[]"]',
    'input[name="allowed_bps"]',
    'select[name="allowed_bps"]',
  ].join(", ");

  const designations = _qsa(form, designationSelector);
  const bpsInputs = _qsa(form, bpsSelector);

  const topBpsEl =
    _qs(form, 'input[name="hrmis_bps"], select[name="hrmis_bps"]') || null;

  function _isTopBps(el) {
    return !!(topBpsEl && el === topBpsEl);
  }

  if (!designations.length && !bpsInputs.length) {
    console.warn("[HRMIS][BPS] No designation/BPS fields found.");
    return;
  }

  function _findDesignationFor(ctxRoot) {
    return _qs(ctxRoot, designationSelector) || null;
  }

  function _findBpsFor(ctxRoot) {
    const local =
      _qs(
        ctxRoot,
        [
          ".js-hrmis-bps",
          'input[name="bps"]',
          'select[name="bps"]',
          'input[name="bps_id"]',
          'select[name="bps_id"]',
          'input[name="posting_bps[]"]',
          'select[name="posting_bps[]"]',
          'input[name="allowed_bps"]',
          'select[name="allowed_bps"]',
        ].join(", ")
      ) || null;

    return local || topBpsEl || null;
  }

  function filterDesignationsByBps(designationSelect, bpsInput) {
    if (!designationSelect) return;
    _ensureInitialValue(designationSelect);
    const isAllowedDesignation =
      _norm(designationSelect.getAttribute("name")) === "allowed_designation_id";
    const hasLocalAllowedBps =
      !!designationSelect.closest(".hrmis-field, .hrmis-form__grid, .js-status-box, form")?.querySelector?.(
        'input[name="allowed_bps"], select[name="allowed_bps"]',
      );

    // Allowed-to-work designation currently has no dedicated BPS input in the form.
    // Do not clear a valid prefilled value just because the generic top-level BPS differs.
    if (isAllowedDesignation && !hasLocalAllowedBps) {
      if (typeof designationSelect._hrmisRefreshCombobox === "function") {
        designationSelect._hrmisRefreshCombobox();
      }
      return;
    }

    const bpsValueRaw = bpsInput ? _norm(bpsInput.value) : "";
    const bpsValue = _canonBps(bpsValueRaw);
    const currentValue = _norm(designationSelect.value);
    const initialValue = _norm(designationSelect.dataset.hrmisInitialValue);

    let visibleCount = 0;
    let totalReal = 0;

    Array.from(designationSelect.options).forEach((option, idx) => {
      if (idx === 0 || _isOther(option.value)) {
        _setOptionVisible(option, true);
        return;
      }

      totalReal += 1;

      const optBpsRaw = _norm(option.dataset.bps || option.dataset.bpsId);
      const optBps = _canonBps(optBpsRaw);

      // Keep the server-prefilled choice available on first load even when
      // production data has a stale/mismatched BPS on that designation row.
      const preservePrefill =
        !!initialValue &&
        currentValue === initialValue &&
        _norm(option.value) === initialValue;
      const visible = preservePrefill || !bpsValue || !optBps || optBps === bpsValue;

      _setOptionVisible(option, visible);
      if (visible) visibleCount += 1;
    });

    const selOpt = designationSelect.selectedOptions?.[0];
    if (selOpt && _isHiddenOption(selOpt) && !_isOther(designationSelect.value)) {
      designationSelect.value = "";
      designationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (typeof designationSelect._hrmisRefreshCombobox === "function") {
      designationSelect._hrmisRefreshCombobox();
    }

  }

  function runBpsDesignation(ctxRoot) {
    const ds = _findDesignationFor(ctxRoot);
    const bps = _findBpsFor(ctxRoot);
    if (ds) filterDesignationsByBps(ds, bps);
  }

  designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    if (t.matches(bpsSelector)) {
     
      if (_isTopBps(t)) {
        designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));
        return;
      }

      runBpsDesignation(_getCtx(t, form));
    }
  });

  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    if (
      t.matches(
        [
          ".js-hrmis-bps",
          'input[name="hrmis_bps"]',
          'input[name="bps"]',
          'input[name="bps_id"]',
          'input[name="posting_bps[]"]',
          'input[name="allowed_bps"]',
        ].join(", ")
      )
    ) {
      if (_isTopBps(t)) {
        designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));
      } else {
        runBpsDesignation(_getCtx(t, form));
      }
    }
  });

  form.addEventListener(
    "focusin",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;

      let sel = null;
      if (t.matches && t.matches(".hrmis-combobox input")) {
        const wrap = t.closest(".hrmis-combobox");
        sel = wrap ? _qs(wrap, "select") : null;
      } else if (t.matches && t.matches("select")) {
        sel = t;
      }

      if (!sel) return;

      if (sel.matches(designationSelector)) {
        filterDesignationsByBps(sel, _findBpsFor(_getCtx(sel, form)));
      }
    },
    true
  );

  const obs = new MutationObserver((muts) => {
    let hit = false;

    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (!(n instanceof Element)) continue;

        const hasRelevant =
          n.matches?.('select[name="hrmis_designation"], input[name="hrmis_bps"]') ||
          n.querySelector?.('select[name="hrmis_designation"], input[name="hrmis_bps"]');

        if (hasRelevant) {
          hit = true;
          runBpsDesignation(_getCtx(n, form));
        }
      }
    }

  });

  obs.observe(form, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initBpsDesignationFilter);
} else {
  _initBpsDesignationFilter();
}

window.addEventListener("pageshow", _initBpsDesignationFilter);