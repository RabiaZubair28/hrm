/** @odoo-module **/

// HRMIS: filter facility dropdown based on selected district
// + filter designation dropdown based on entered BPS (BPS-only)
// + make designation list unique (by designation name)
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
  // Try to scope filtering to the same row/section for repeatables
  return (
    el.closest(".hrmis-repeatable-row") ||
    el.closest(".hrmis-repeat-row") ||      // your XML commonly uses this
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

  const districts = _qsa(form, "select.js-hrmis-district");
  const facilities = _qsa(form, "select.js-hrmis-facility");
  const designations = _qsa(form, "select.js-designation-select");
  const bpsInputs = _qsa(form, "input.js-hrmis-bps, select.js-hrmis-bps, .js-hrmis-bps");

  if (!districts.length && !facilities.length && !designations.length) {
    console.warn("[HRMIS][FILTER] No relevant selects found (district/facility/designation).");
    return;
  }

  console.info("[HRMIS][FILTER] init", {
    districts: districts.length,
    facilities: facilities.length,
    designations: designations.length,
    bpsInputs: bpsInputs.length,
  });

  function _findDistrictFor(ctxRoot) {
    // Prefer district inside same ctx, otherwise fallback to first in form
    return _qs(ctxRoot, "select.js-hrmis-district") || districts[0] || null;
  }

  function _findFacilityFor(ctxRoot) {
    return _qs(ctxRoot, "select.js-hrmis-facility") || null;
  }

  function _findDesignationFor(ctxRoot) {
    return _qs(ctxRoot, "select.js-designation-select") || null;
  }

  function _findBpsFor(ctxRoot) {
    return (
      _qs(ctxRoot, ".js-hrmis-bps") ||
      _qs(ctxRoot, "input.js-hrmis-bps") ||
      _qs(ctxRoot, "select.js-hrmis-bps") ||
      bpsInputs[0] ||
      null
    );
  }

  function filterFacilities(ctxRoot, districtSelect, facilitySelect) {
    if (!districtSelect || !facilitySelect) return;

    const selectedDistrictId = _norm(districtSelect.value);
    let visibleCount = 0;
    let totalReal = 0;

    Array.from(facilitySelect.options).forEach((option, idx) => {
      // Keep placeholder + other always visible
      if (idx === 0 || _isOther(option.value)) {
        _setOptionVisible(option, true);
        return;
      }

      totalReal += 1;

      const districtId = _norm(option.dataset.districtId);

      // strict match: if district selected => show only matching
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

    console.info("[HRMIS][FILTER][FAC] done", {
      district: selectedDistrictId,
      totalRealOptions: totalReal,
      visibleCount,
      name: facilitySelect.name,
    });
  }

  // BPS-only designation filter (facility is ignored by design)
  function filterDesignations(ctxRoot, designationSelect, bpsInput) {
    if (!designationSelect) return;

    const bpsValue = bpsInput ? _norm(bpsInput.value) : "";

    console.groupCollapsed("[HRMIS][FILTER][DESIG] start", {
      name: designationSelect.name,
      bps: bpsValue,
      ctx: ctxRoot === document ? "document" : (ctxRoot?.className || "ctx"),
    });

    const seenNames = new Set();
    let visibleCount = 0;
    let totalReal = 0;
    let missingBpsCount = 0;
    let bpsMatchCount = 0;

    Array.from(designationSelect.options).forEach((option, idx) => {
      // Keep placeholder + other always visible
      if (idx === 0 || _isOther(option.value)) {
        _setOptionVisible(option, true);
        return;
      }

      totalReal += 1;

      const optBps = _norm(option.dataset.bps);
      if (!optBps) missingBpsCount += 1;

      // If BPS is empty => show all
      const bpsOk = !bpsValue || optBps === bpsValue;
      if (bpsOk) bpsMatchCount += 1;

      let visible = bpsOk;

      // uniqueness by designation name (after filtering)
      if (visible) {
        const nameKey = (_norm(option.textContent) || "").toLowerCase();
        if (nameKey) {
          if (seenNames.has(nameKey)) {
            visible = false;
          } else {
            seenNames.add(nameKey);
          }
        }
      }

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

    console.info("[HRMIS][FILTER][DESIG] summary", {
      bps: bpsValue,
      totalRealOptions: totalReal,
      missingBpsCount,
      bpsMatchCount,
      visibleCount,
      select: designationSelect.name,
    });

    if (bpsValue && visibleCount === 0) {
      console.warn("[HRMIS][FILTER][DESIG] no matches for BPS", {
        bps: bpsValue,
        select: designationSelect.name,
      });
    }

    console.groupEnd();
  }

  function runAllFilters(ctxRoot) {
    const districtSelect = _findDistrictFor(ctxRoot);
    const facilitySelect = _findFacilityFor(ctxRoot);
    const designationSelect = _findDesignationFor(ctxRoot);
    const bpsInput = _findBpsFor(ctxRoot);

    if (districtSelect && facilitySelect) {
      filterFacilities(ctxRoot, districtSelect, facilitySelect);
    }
    if (designationSelect) {
      filterDesignations(ctxRoot, designationSelect, bpsInput);
    }
  }

  // Initial run (entire form + each ctx that has a facility/designation select)
  runAllFilters(form);
  facilities.forEach((fs) => runAllFilters(_getCtx(fs, form)));
  designations.forEach((ds) => runAllFilters(_getCtx(ds, form)));

  // Event delegation for the whole form
  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    if (t.matches("select.js-hrmis-district")) {
      console.info("[HRMIS][FILTER] district changed", { name: t.name, value: t.value });
      runAllFilters(_getCtx(t, form));
      return;
    }

    if (t.matches("select.js-hrmis-facility")) {
      console.info("[HRMIS][FILTER] facility changed", { name: t.name, value: t.value });
      runAllFilters(_getCtx(t, form));
      return;
    }

    if (t.matches(".js-hrmis-bps")) {
      console.info("[HRMIS][FILTER] bps changed", { name: t.getAttribute("name"), value: t.value });
      runAllFilters(_getCtx(t, form));
      return;
    }
  });

  // BPS typing
  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    if (t.matches(".js-hrmis-bps")) {
      runAllFilters(_getCtx(t, form));
    }
  });

  // Dynamic rows support
  const obs = new MutationObserver((muts) => {
    let hit = false;
    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (!(n instanceof Element)) continue;

        const hasRelevant =
          n.matches?.("select.js-hrmis-facility, select.js-designation-select, select.js-hrmis-district, .js-hrmis-bps") ||
          n.querySelector?.("select.js-hrmis-facility, select.js-designation-select, select.js-hrmis-district, .js-hrmis-bps");

        if (hasRelevant) {
          hit = true;
          runAllFilters(_getCtx(n, form));
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