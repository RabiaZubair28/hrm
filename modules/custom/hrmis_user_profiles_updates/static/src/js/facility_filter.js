/** @odoo-module **/

// HRMIS: filter facility dropdown based on selected district
// + filter designation dropdown based on entered BPS (BPS-only)
// + make designation list unique (by designation name)
// Works across the whole form (including repeatable rows)
//
// FIXES:
// - District change pairs with nearest facility select (prevents cross-section filtering)
// - BPS input detection fixed for name="hrmis_bps" (and other bps inputs)
// - Designation select detection fixed for name="hrmis_designation" (and other selects)
// - Filters designations by data-bps; shows all if BPS empty

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

function _isHiddenOption(opt) {
  return !!(opt && (opt.hidden === true || opt.style.display === "none"));
}

function _setOptionVisible(opt, visible) {
  // hidden is the reliable switch for <option>; style.display kept as fallback.
  opt.hidden = !visible;
  opt.style.display = visible ? "" : "none";
}

function _getCtx(el, form) {
  // Prefer scoping inside the same status box / grid first (prevents cross-filtering)
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

function _filterFacilityAndDesignation() {
  const form = _qs(document, "#profile_update_form") || document;

  // Avoid double-binding (DOMContentLoaded + pageshow)
  if (form && form.dataset && form.dataset.hrmisFilterBound === "1") {
    console.info("[HRMIS][FILTER] already bound, skipping rebind");
    return;
  }
  if (form && form.dataset) form.dataset.hrmisFilterBound = "1";

  // District selects
  const districts = _qsa(
    form,
    [
      "select.js-hrmis-district",
      "select.js-current-district",
      "select.js-post-district",
      "select.js-suspension-district",
      "select.js-onleave-district",
      // name-based fallbacks
      'select[name="district_id"]',
      'select[name="frontend_reporting_district_id"]',
      'select[name="frontend_onleave_district_id"]',
      'select[name="posting_district_id[]"]',
      'select[name="allowed_district_id"]',
    ].join(", "),
  );

  // Facility selects
  const facilities = _qsa(
    form,
    [
      "select.js-hrmis-facility",
      "select.js-current-facility",
      "select.js-suspension-facility",
      "select.js-onleave-facility",
      // name-based fallbacks
      'select[name="facility_id"]',
      'select[name="frontend_reporting_facility_id"]',
      'select[name="frontend_onleave_facility_id"]',
      'select[name="posting_facility_id[]"]',
      'select[name="allowed_facility_id"]',
    ].join(", "),
  );

  // Designation selects (IMPORTANT: include hrmis_designation)
  const designations = _qsa(
    form,
    [
      "select.js-designation-select",
      'select[name="hrmis_designation"]',
      'select[name="designation_id"]',
      'select[name="posting_designation_id[]"]',
      'select[name="allowed_designation_id"]',
      'select[name="frontend_reporting_designation_id"]',
      'select[name="frontend_onleave_designation_id"]',
    ].join(", "),
  );

  // BPS inputs (IMPORTANT: include name="hrmis_bps")
  const bpsInputs = _qsa(
    form,
    [
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
    ].join(", "),
  );

  // Top BPS (Employee Information) drives designation filters in sections where BPS inputs were removed
  const topBpsEl =
    _qs(form, 'input[name="hrmis_bps"], select[name="hrmis_bps"]') || null;

  function _isTopBps(el) {
    return !!(topBpsEl && el === topBpsEl);
  }


  if (!districts.length && !facilities.length && !designations.length) {
    console.warn("[HRMIS][FILTER] No relevant fields found.");
    return;
  }

  console.info("[HRMIS][FILTER] init", {
    districts: districts.length,
    facilities: facilities.length,
    designations: designations.length,
    bpsInputs: bpsInputs.length,
  });

  function _findNearestFacilityForDistrict(districtSelect) {
    const grid = districtSelect.closest(".hrmis-form__grid");
    const box = districtSelect.closest(".js-status-box");
    const ctx = _getCtx(districtSelect, form);
    const scope = grid || box || ctx || form;

    return (
      _qs(
        scope,
        [
          "select.js-hrmis-facility",
          "select.js-current-facility",
          "select.js-suspension-facility",
          "select.js-onleave-facility",
          'select[name="facility_id"]',
          'select[name="frontend_reporting_facility_id"]',
          'select[name="frontend_onleave_facility_id"]',
          'select[name="posting_facility_id[]"]',
          'select[name="allowed_facility_id"]',
        ].join(", "),
      ) || null
    );
  }

  function _findDesignationFor(ctxRoot) {
    return (
      _qs(
        ctxRoot,
        [
          "select.js-designation-select",
          'select[name="hrmis_designation"]',
          'select[name="designation_id"]',
          'select[name="posting_designation_id[]"]',
          'select[name="allowed_designation_id"]',
          'select[name="frontend_reporting_designation_id"]',
          'select[name="frontend_onleave_designation_id"]',
        ].join(", "),
      ) || null
    );
  }

  function _findBpsFor(ctxRoot) {
    // Prefer a local BPS inside the same section/row (posting history, etc.)
    // IMPORTANT: we intentionally do NOT look for name="hrmis_bps" inside ctxRoot here,
    // because BPS was removed from some sections and must always come from the top BPS.
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
        ].join(", "),
      ) || null;

    return local || topBpsEl || null;
  }


  function filterFacilities(districtSelect, facilitySelect) {
    if (!districtSelect || !facilitySelect) return;

    const selectedDistrictId = _norm(districtSelect.value);
    let visibleCount = 0;
    let totalReal = 0;

    Array.from(facilitySelect.options).forEach((option, idx) => {
      if (idx === 0 || _isOther(option.value)) {
        _setOptionVisible(option, true);
        return;
      }

      totalReal += 1;
      const districtId = _norm(option.dataset.districtId);
      const visible = !selectedDistrictId || districtId === selectedDistrictId;

      _setOptionVisible(option, visible);
      if (visible) visibleCount += 1;
    });

    // Reset if selected facility got hidden (unless __other__)
    const selOpt = facilitySelect.selectedOptions?.[0];
    if (selOpt && _isHiddenOption(selOpt) && !_isOther(facilitySelect.value)) {
      console.warn("[HRMIS][FILTER][FAC] reset (hidden after district filter)", {
        name: facilitySelect.name,
        old: facilitySelect.value,
        district: selectedDistrictId,
      });
      facilitySelect.value = "";
      facilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (typeof facilitySelect._hrmisRefreshCombobox === "function") {
      facilitySelect._hrmisRefreshCombobox();
    }

    console.info("[HRMIS][FILTER][FAC] done", {
      district: selectedDistrictId,
      totalRealOptions: totalReal,
      visibleCount,
      name: facilitySelect.name,
    });
  }

  function filterDesignationsByBps(designationSelect, bpsInput) {
    if (!designationSelect) return;

    const bpsValueRaw = bpsInput ? _norm(bpsInput.value) : "";
    const bpsValue = _canonBps(bpsValueRaw);

    let visibleCount = 0;
    let totalReal = 0;

    // NOTE: Your XML puts BPS in option.dataset.bps via t-att-data-bps="des_bps"
    Array.from(designationSelect.options).forEach((option, idx) => {
      if (idx === 0 || _isOther(option.value)) {
        _setOptionVisible(option, true);
        return;
      }

      totalReal += 1;

      // Your XML uses data-bps. Some older/other templates may use data-bps-id.
      const optBpsRaw = _norm(option.dataset.bps || option.dataset.bpsId);
      const optBps = _canonBps(optBpsRaw);

      // If BPS empty => show all
      // Else show only exact match
      // If an option has no bps metadata, keep it visible (avoid "only Other" situations)
      const visible = !bpsValue || !optBps || optBps === bpsValue;

      _setOptionVisible(option, visible);
      if (visible) visibleCount += 1;
    });

    // Reset if selected designation got hidden (unless __other__)
    const selOpt = designationSelect.selectedOptions?.[0];
    if (selOpt && _isHiddenOption(selOpt) && !_isOther(designationSelect.value)) {
      console.warn("[HRMIS][FILTER][DESIG] reset (hidden after BPS filter)", {
        name: designationSelect.name,
        old: designationSelect.value,
        bps: bpsValue,
      });
      designationSelect.value = "";
      designationSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (typeof designationSelect._hrmisRefreshCombobox === "function") {
      designationSelect._hrmisRefreshCombobox();
    }

    console.info("[HRMIS][FILTER][DESIG] done", {
      bps: bpsValue,
      bpsRaw: bpsValueRaw,
      totalRealOptions: totalReal,
      visibleCount,
      name: designationSelect.name,
    });
  }

  function runBpsDesignation(ctxRoot) {
    const ds = _findDesignationFor(ctxRoot);
    const bps = _findBpsFor(ctxRoot);
    if (ds) filterDesignationsByBps(ds, bps);
  }

  // Initial run
  // - For each designation select, run filtering within its ctx (important for repeatables)
  designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));

  // Facility initial run: best-effort on existing selected districts
  // (keeps your existing behavior but avoids overpairing)
  districts.forEach((dsel) => {
    const fac = _findNearestFacilityForDistrict(dsel);
    if (fac) filterFacilities(dsel, fac);
  });

  // Event delegation
  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    // District change => filter nearest facility
    if (
      t.matches(
        [
          "select.js-hrmis-district",
          "select.js-current-district",
          "select.js-post-district",
          "select.js-suspension-district",
          "select.js-onleave-district",
          'select[name="district_id"]',
          'select[name="frontend_reporting_district_id"]',
          'select[name="frontend_onleave_district_id"]',
          'select[name="posting_district_id[]"]',
          'select[name="allowed_district_id"]',
        ].join(", "),
      )
    ) {
      console.info("[HRMIS][FILTER] district changed", { name: t.name, value: t.value });

      const fac = _findNearestFacilityForDistrict(t);
      if (!fac) {
        console.warn("[HRMIS][FILTER][FAC] no facility found near district", { districtName: t.name });
        return;
      }
      filterFacilities(t, fac);
      return;
    }

    // BPS change => filter designation in same ctx
    if (
      t.matches(
        [
          ".js-hrmis-bps",
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
        ].join(", "),
      )
    ) {
      console.info("[HRMIS][FILTER] bps changed", { name: t.getAttribute("name"), value: t.value });
      if (_isTopBps(t)) {
        console.info("[HRMIS][FILTER][BPS] top BPS changed => refresh all designations");
        designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));
        return;
      }
      runBpsDesignation(_getCtx(t, form));
      return;
    }
  });

  // BPS typing (input event)
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
        ].join(", "),
      )
    ) {
      if (_isTopBps(t)) {
        designations.forEach((ds) => runBpsDesignation(_getCtx(ds, form)));
      } else {
        runBpsDesignation(_getCtx(t, form));
      }
    }
  });

  // If some sections are hidden on load (Suspended / On Leave), your searchable-combobox
  // enhancer may initialize later (on first focus/click). In that case, we must re-apply
  // the BPS filter right before the user opens the dropdown.
  // This fixes cases where those dropdowns appear unfiltered even though top BPS exists.
  form.addEventListener(
    "focusin",
    (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;

      // If the searchable combobox enhancer is used, focus will land on the input,
      // not the underlying <select>. Map back to the wrapped select.
      let sel = null;
      if (t.matches && t.matches(".hrmis-combobox input")) {
        const wrap = t.closest(".hrmis-combobox");
        sel = wrap ? _qs(wrap, "select") : null;
      } else if (t.matches && t.matches("select")) {
        sel = t;
      }

      if (!sel) return;

      if (
        sel.matches(
          [
            "select.js-designation-select",
            "select.js-suspension-designation",
            "select.js-onleave-designation",
            'select[name="hrmis_designation"]',
            'select[name="designation_id"]',
            'select[name="posting_designation_id[]"]',
            'select[name="allowed_designation_id"]',
            'select[name="frontend_reporting_designation_id"]',
            'select[name="frontend_onleave_designation_id"]',
          ].join(", "),
        )
      ) {
        // Filter this designation select using local BPS (if any) else TOP BPS.
        filterDesignationsByBps(sel, _findBpsFor(_getCtx(sel, form)));
      }
    },
    true,
  );


  // Dynamic rows support
  const obs = new MutationObserver((muts) => {
    let hit = false;
    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (!(n instanceof Element)) continue;

        const hasRelevant =
          n.matches?.('select[name="hrmis_designation"], input[name="hrmis_bps"], select.js-current-facility, select.js-current-district') ||
          n.querySelector?.('select[name="hrmis_designation"], input[name="hrmis_bps"], select.js-current-facility, select.js-current-district');

        if (hasRelevant) {
          hit = true;
          const ctx = _getCtx(n, form);
          runBpsDesignation(ctx);

          // If a district appears, attempt facility filter too
          const dsel =
            n.matches?.("select") && n.matches("select.js-current-district, select.js-post-district, select[name='district_id']")
              ? n
              : _qs(ctx, "select.js-current-district, select.js-post-district, select[name='district_id']");
          if (dsel) {
            const fac = _findNearestFacilityForDistrict(dsel);
            if (fac) filterFacilities(dsel, fac);
          }
        }
      }
    }
    if (hit) console.info("[HRMIS][FILTER] mutation refresh");
  });
  obs.observe(form, { childList: true, subtree: true });
}

function _initFilters() {
  _filterFacilityAndDesignation();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initFilters);
} else {
  _initFilters();
}

window.addEventListener("pageshow", _initFilters);