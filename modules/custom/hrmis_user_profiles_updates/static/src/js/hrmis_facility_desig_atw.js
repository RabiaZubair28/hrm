/** @odoo-module **/

// HRMIS:
// Allowed To Work + Suspension
// Facility -> Designation filtering
// Match facility by NAME
// Debug-heavy logs for API data, XML data, normalization, matching,
// fallback, and designation filtering for both sections.

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _norm(v) {
  return (v || "").toString().trim();
}

function _canonLoc(v) {
  return _norm(v)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function _normFacilityName(v) {
  return _norm(v)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[;,]/g, " ")
    .replace(/[._\-\/()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _isOther(v) {
  return _norm(v) === "__other__";
}

function _isHiddenOption(opt) {
  return !!(opt && (opt.hidden === true || opt.style.display === "none"));
}

function _setOptionVisible(opt, visible) {
  if (!opt) return;
  opt.hidden = !visible;
  opt.style.display = visible ? "" : "none";
}

function _safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[HRMIS][ATW_SUSP] JSON parse failed:", e);
    console.error("[HRMIS][ATW_SUSP] Raw JSON preview:", (text || "").slice(0, 1000));
    return fallback;
  }
}

function _readFacilitiesJson(form) {
  

  const scriptEl = _qs(form, "#hrmis_facilities_json");
  if (!scriptEl) {
    console.warn("[HRMIS][ATW_SUSP] #hrmis_facilities_json not found.");
    return [];
  }

  const raw = scriptEl.textContent || scriptEl.innerText || "[]";
  const data = _safeJsonParse(raw, []);
  const facilities = Array.isArray(data) ? data : [];



  return facilities;
}

function _getSelectedFacilityMeta(facilitySelect) {
  if (!facilitySelect) {
    console.warn("[HRMIS][ATW_SUSP] _getSelectedFacilityMeta called without select");
    return null;
  }

  const selectedOption =
    facilitySelect.selectedOptions && facilitySelect.selectedOptions.length
      ? facilitySelect.selectedOptions[0]
      : facilitySelect.options[facilitySelect.selectedIndex] || null;

  if (!selectedOption) {
    console.warn("[HRMIS][ATW_SUSP] No selected option found in facility select");
    return null;
  }

  const value = _norm(selectedOption.value || "");
  const dataName = _norm(selectedOption.dataset.name || "");
  const textName = _norm(selectedOption.textContent || "");
  const finalName = dataName || textName;
  const optionLoc = _canonLoc(selectedOption.dataset.levelOfCare || "");


  if (!finalName || finalName.toLowerCase() === "select facility" || value === "") {
    console.info("[HRMIS][ATW_SUSP] Placeholder facility option selected");
  }

  return {
    value,
    dataName,
    textName,
    finalName,
    normalizedName: _normFacilityName(finalName),
    optionLevelOfCare: optionLoc,
    selectedOption,
  };
}

function _findFacilityByName(facilities, facilityMeta) {
  const wanted = facilityMeta?.normalizedName || "";
  if (!wanted) {
    console.warn("[HRMIS][ATW_SUSP] _findFacilityByName called with empty normalizedName");
    return null;
  }

 

  const exactMatch =
    facilities.find((f) => _normFacilityName(f?.name || "") === wanted) || null;

  if (exactMatch) {

    return exactMatch;
  }

  const containsMatch =
    facilities.find((f) => {
      const apiName = _normFacilityName(f?.name || "");
      return apiName.includes(wanted) || wanted.includes(apiName);
    }) || null;

  if (containsMatch) {
   
    return containsMatch;
  }

  return null;
}

function _extractFacilityLevelOfCare(facility, facilityMeta) {
  const apiLoc = _canonLoc(facility?.level_of_care || facility?.levelOfCare || "");
  const xmlLoc = _canonLoc(facilityMeta?.optionLevelOfCare || "");


  if (apiLoc) {

    return apiLoc;
  }

  if (xmlLoc) {

    return xmlLoc;
  }

  return "";
}

function _filterDesignationByFacilityAndLevel(designationSelect, facilityName, levelOfCare, label) {
  if (!designationSelect) {
    console.warn("[HRMIS][ATW_SUSP] designationSelect missing in _filterDesignationByFacilityAndLevel");
    return;
  }


  const requiredLoc = _canonLoc(levelOfCare);
  const requiredFacilityName = _normFacilityName(facilityName);
  const skipFacilityMatch = requiredLoc === "primary" || requiredLoc === "secondary";

  let visibleCount = 0;
  let totalReal = 0;

  Array.from(designationSelect.options).forEach((option, idx) => {
    if (idx === 0 || _isOther(option.value)) {
      _setOptionVisible(option, true);
      return;
    }

    totalReal += 1;

    const optionLoc = _canonLoc(option.dataset.levelOfCare || "");
    const optionFacilityName = _normFacilityName(option.dataset.facilityName || "");

    let visible = true;

    if (!skipFacilityMatch && requiredFacilityName) {
      visible = visible && optionFacilityName === requiredFacilityName;
    }

    if (requiredLoc) {
      visible = visible && optionLoc === requiredLoc;
    }

    _setOptionVisible(option, visible);


    if (visible) {
      visibleCount += 1;
    }
  });

  const selectedOption = designationSelect.selectedOptions?.[0];
  const selectedValue = _norm(designationSelect.value);

  const selectedIsHidden =
    selectedValue &&
    selectedOption &&
    _isHiddenOption(selectedOption) &&
    !_isOther(selectedValue);

  if (selectedIsHidden) {


    designationSelect.value = "";
    designationSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (typeof designationSelect._hrmisRefreshCombobox === "function") {
    designationSelect._hrmisRefreshCombobox();
  }

}

function _hideAllDesignationsExceptDefault(designationSelect) {
  if (!designationSelect) {
    console.warn("[HRMIS][LOC] designationSelect missing in _hideAllDesignationsExceptDefault");
    return;
  }

  let visibleCount = 0;

  Array.from(designationSelect.options).forEach((option, idx) => {
    const keepVisible = idx === 0 || _isOther(option.value);
    _setOptionVisible(option, keepVisible);
    if (keepVisible) visibleCount += 1;
  });

  const selectedOption = designationSelect.selectedOptions?.[0];
  const selectedValue = _norm(designationSelect.value);

  const selectedIsHidden =
    selectedValue &&
    selectedOption &&
    _isHiddenOption(selectedOption) &&
    !_isOther(selectedValue);

  if (selectedIsHidden) {
    console.warn("[HRMIS][LOC] Selected designation hidden because facility is not selected, clearing it", {
      selectedValue,
      selectedText: _norm(selectedOption.textContent || ""),
    });

    designationSelect.value = "";
    designationSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (typeof designationSelect._hrmisRefreshCombobox === "function") {
    designationSelect._hrmisRefreshCombobox();
  }

  console.log("[HRMIS][LOC] No facility selected -> designation list collapsed", {
    visibleCount,
    totalOptions: designationSelect.options.length,
  });
}

function _showAllUniqueDesignations(designationSelect) {
  if (!designationSelect) {
    console.warn("[HRMIS][ATW_SUSP] designationSelect missing in _showAllUniqueDesignations");
    return;
  }

  const seen = new Set();

  Array.from(designationSelect.options).forEach((option, idx) => {
    if (idx === 0 || _isOther(option.value)) {
      _setOptionVisible(option, true);
      return;
    }

    const textKey = _norm(option.textContent || "").toLowerCase();

    if (!textKey) {
      _setOptionVisible(option, false);
      return;
    }

    if (seen.has(textKey)) {
      _setOptionVisible(option, false);
      return;
    }

    seen.add(textKey);
    _setOptionVisible(option, true);
  });

  if (typeof designationSelect._hrmisRefreshCombobox === "function") {
    designationSelect._hrmisRefreshCombobox();
  }

  console.log("[HRMIS][ATW_SUSP] Reporting to Health Department -> showing all unique designations");
}

function _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, sourceLabel, opts) {
  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][ATW_SUSP] Missing facility/designation pair", {
      sourceLabel,
      facilityFound: !!facilitySelect,
      designationFound: !!designationSelect,
    });
    return;
  }

  opts = opts || {};

  if (opts.reportingTo === "health_department") {
    console.info("[HRMIS][ATW_SUSP] reporting_to=health_department, skipping facility filter");
    _showAllUniqueDesignations(designationSelect);
    return;
  }

  const facilityValue = _norm(facilitySelect.value);
  const facilityMeta = _getSelectedFacilityMeta(facilitySelect);

  if (!facilityValue || _isOther(facilityValue) || !facilityMeta || !facilityMeta.finalName) {
    console.info("[HRMIS][ATW_SUSP] No facility selected, hiding all designation options");
    _hideAllDesignationsExceptDefault(designationSelect);
    return;
  }

  const matchedFacility = _findFacilityByName(facilities, facilityMeta);
  const levelOfCare = _extractFacilityLevelOfCare(matchedFacility, facilityMeta);

  _filterDesignationByFacilityAndLevel(
    designationSelect,
    facilityMeta.finalName,
    levelOfCare,
    sourceLabel
  );
}

function _bindFacilityDesignationPair(facilitySelect, designationSelect, facilities, label) {
  if (!facilitySelect || !designationSelect) {
    return;
  }


  _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:initial`);

  if (facilitySelect.dataset.hrmisAtwSuspBound !== "1") {
    facilitySelect.dataset.hrmisAtwSuspBound = "1";

    facilitySelect.addEventListener("change", function () {
      _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:change`);
    });
  }

  if (designationSelect.dataset.hrmisAtwSuspFocusBound !== "1") {
    designationSelect.dataset.hrmisAtwSuspFocusBound = "1";

    designationSelect.addEventListener("focus", function () {
      _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:focus`);
    });
  }

}

function _bindAllowedToWork(form, facilities) {

  const box = _qs(form, "#allowed_to_work_box");
  if (!box) {
    return;
  }

  const facilitySelect = _qs(box, 'select[name="allowed_facility_id"]');
  const designationSelect = _qs(box, 'select[name="allowed_designation_id"]');

  _bindFacilityDesignationPair(
    facilitySelect,
    designationSelect,
    facilities,
    "allowed_to_work"
  );

}

function _bindSuspension(form, facilities) {
  const box = _qs(form, "#suspension_box");
  if (!box) {
    return;
  }

  const facilitySelect = _qs(box, 'select[name="frontend_reporting_facility_id"]');
  const designationSelect = _qs(box, 'select[name="hrmis_designation"]');
  const reportingToSelect = _qs(box, 'select[name="frontend_reporting_to"]');

  if (!facilitySelect || !designationSelect) {
    return;
  }

  function run(source) {
    const reportingTo = _norm(reportingToSelect?.value || "");
    _runFacilityDesignationFilter(
      facilitySelect,
      designationSelect,
      facilities,
      `suspension:${source}`,
      { reportingTo }
    );
  }

  run("initial");

  if (facilitySelect.dataset.hrmisAtwSuspBound !== "1") {
    facilitySelect.dataset.hrmisAtwSuspBound = "1";
    facilitySelect.addEventListener("change", function () {
      run("facility_change");
    });
  }

  if (designationSelect.dataset.hrmisAtwSuspFocusBound !== "1") {
    designationSelect.dataset.hrmisAtwSuspFocusBound = "1";
    designationSelect.addEventListener("focus", function () {
      run("designation_focus");
    });
  }

  if (reportingToSelect && reportingToSelect.dataset.hrmisAtwSuspReportingBound !== "1") {
    reportingToSelect.dataset.hrmisAtwSuspReportingBound = "1";
    reportingToSelect.addEventListener("change", function () {
      run("reporting_change");
    });
  }
}

    function _bindFocusRefresh(form, facilities) {
    if (!form || !form.dataset) {
        return;
    }

    if (form.dataset.hrmisAtwSuspFocusinBound === "1") {
        return;
    }
    form.dataset.hrmisAtwSuspFocusinBound = "1";

  form.addEventListener(
    "focusin",
    function (ev) {
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

      const allowedBox = _qs(form, "#allowed_to_work_box");
      const suspensionBox = _qs(form, "#suspension_box");

      const allowedDesignation = allowedBox
        ? _qs(allowedBox, 'select[name="allowed_designation_id"]')
        : null;

      const suspensionDesignation = suspensionBox
        ? _qs(suspensionBox, 'select[name="hrmis_designation"]')
        : null;

      const allowedFacility = allowedBox
        ? _qs(allowedBox, 'select[name="allowed_facility_id"]')
        : null;

      const suspensionFacility = suspensionBox
        ? _qs(suspensionBox, 'select[name="frontend_reporting_facility_id"]')
        : null;

      if (sel === allowedDesignation && allowedFacility) {
       
        _runFacilityDesignationFilter(
          allowedFacility,
          allowedDesignation,
          facilities,
          "allowed_to_work:focusin"
        );
      }

      const suspensionReportingTo = suspensionBox
  ? _qs(suspensionBox, 'select[name="frontend_reporting_to"]')
  : null;

        if (sel === suspensionDesignation && suspensionFacility) {
        _runFacilityDesignationFilter(
            suspensionFacility,
            suspensionDesignation,
            facilities,
            "suspension:focusin",
            { reportingTo: _norm(suspensionReportingTo?.value || "") }
        );
        }
    },
    true
  );
}

function _initAllowedToWorkAndSuspensionFacilityDesignationFilter() {

  const form = _qs(document, "#profile_update_form") || document;
  const isSubmittedView = !!form?.classList?.contains?.("is-submitted");

  if (isSubmittedView) {

    return;
  }

  if (form && form.dataset && form.dataset.hrmisAtwSuspFilterInit === "1") {

    return;
  }

  if (form && form.dataset) {
    form.dataset.hrmisAtwSuspFilterInit = "1";
  }

  const facilities = _readFacilitiesJson(form);

  _bindAllowedToWork(form, facilities);
  _bindSuspension(form, facilities);
  _bindFocusRefresh(form, facilities);

}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initAllowedToWorkAndSuspensionFacilityDesignationFilter);
} else {
  _initAllowedToWorkAndSuspensionFacilityDesignationFilter();
}

window.addEventListener("pageshow", _initAllowedToWorkAndSuspensionFacilityDesignationFilter);