/** @odoo-module **/

// HRMIS:
// Filter facility dropdown based on selected district
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

function _initFacilityFilter() {
  const form = _qs(document, "#profile_update_form") || document;

  if (form && form.dataset && form.dataset.hrmisFacilityFilterBound === "1") {
    console.info("[HRMIS][FAC] already bound, skipping rebind");
    return;
  }
  if (form && form.dataset) form.dataset.hrmisFacilityFilterBound = "1";

  const districtSelector = [
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
  ].join(", ");

  const facilitySelector = [
    "select.js-hrmis-facility",
    "select.js-current-facility",
    "select.js-suspension-facility",
    "select.js-onleave-facility",
    'select[name="facility_id"]',
    'select[name="frontend_reporting_facility_id"]',
    'select[name="frontend_onleave_facility_id"]',
    'select[name="posting_facility_id[]"]',
    'select[name="allowed_facility_id"]',
  ].join(", ");

  const districts = _qsa(form, districtSelector);
  const facilities = _qsa(form, facilitySelector);

  if (!districts.length && !facilities.length) {
    console.warn("[HRMIS][FAC] No district/facility fields found.");
    return;
  }


  function _findNearestFacilityForDistrict(districtSelect) {
    const grid = districtSelect.closest(".hrmis-form__grid");
    const box = districtSelect.closest(".js-status-box");
    const ctx = _getCtx(districtSelect, form);
    const scope = grid || box || ctx || form;

    return _qs(scope, facilitySelector) || null;
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

      const districtId =
        _norm(option.dataset.districtId) ||
        _norm(option.getAttribute("data-district-id"));

      const visible = !selectedDistrictId || districtId === selectedDistrictId;

      _setOptionVisible(option, visible);
      if (visible) visibleCount += 1;
    });

    const selOpt = facilitySelect.selectedOptions?.[0];
    if (selOpt && _isHiddenOption(selOpt) && !_isOther(facilitySelect.value)) {
      facilitySelect.value = "";
      facilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (typeof facilitySelect._hrmisRefreshCombobox === "function") {
      facilitySelect._hrmisRefreshCombobox();
    }

  }

  districts.forEach((dsel) => {
    const fac = _findNearestFacilityForDistrict(dsel);
    if (fac) filterFacilities(dsel, fac);
  });

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;

    if (t.matches(districtSelector)) {

      const fac = _findNearestFacilityForDistrict(t);
      if (!fac) {
        console.warn("[HRMIS][FAC] no facility found near district", {
          districtName: t.name,
        });
        return;
      }

      filterFacilities(t, fac);
    }
  });

  const obs = new MutationObserver((muts) => {
    let hit = false;

    for (const m of muts) {
      for (const n of m.addedNodes || []) {
        if (!(n instanceof Element)) continue;

        const hasRelevant =
          n.matches?.("select.js-current-facility, select.js-current-district, select.js-post-district") ||
          n.querySelector?.("select.js-current-facility, select.js-current-district, select.js-post-district");

        if (hasRelevant) {
          hit = true;

          const ctx = _getCtx(n, form);
          const dsel =
            (n.matches?.("select") && n.matches(districtSelector) ? n : null) ||
            _qs(ctx, districtSelector);

          if (dsel) {
            const fac = _findNearestFacilityForDistrict(dsel);
            if (fac) filterFacilities(dsel, fac);
          }
        }
      }
    }
  });

  obs.observe(form, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initFacilityFilter);
} else {
  _initFacilityFilter();
}

window.addEventListener("pageshow", _initFacilityFilter);