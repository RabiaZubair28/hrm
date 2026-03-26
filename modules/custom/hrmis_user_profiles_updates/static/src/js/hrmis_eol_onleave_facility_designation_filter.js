/** @odoo-module **/

// HRMIS:
// EOL PGship + On Leave
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
    console.error("[HRMIS][EOL_ONLEAVE] JSON parse failed:", e);
    console.error("[HRMIS][EOL_ONLEAVE] Raw JSON preview:", (text || "").slice(0, 1000));
    return fallback;
  }
}

function _readFacilitiesJson(form) {
  console.group("[HRMIS][EOL_ONLEAVE] Read facilities JSON");

  const scriptEl = _qs(form, "#hrmis_facilities_json");
  if (!scriptEl) {
    console.warn("[HRMIS][EOL_ONLEAVE] #hrmis_facilities_json not found.");
    console.groupEnd();
    return [];
  }

  const raw = scriptEl.textContent || scriptEl.innerText || "[]";
  const data = _safeJsonParse(raw, []);
  const facilities = Array.isArray(data) ? data : [];

  console.log("[HRMIS][EOL_ONLEAVE] facilities count:", facilities.length);
  console.log("[HRMIS][EOL_ONLEAVE] sample facilities:", facilities.slice(0, 10));

  console.groupEnd();
  return facilities;
}

function _getSelectedFacilityMeta(facilitySelect) {
  if (!facilitySelect) {
    console.warn("[HRMIS][EOL_ONLEAVE] _getSelectedFacilityMeta called without select");
    return null;
  }

  const selectedOption =
    facilitySelect.selectedOptions && facilitySelect.selectedOptions.length
      ? facilitySelect.selectedOptions[0]
      : facilitySelect.options[facilitySelect.selectedIndex] || null;

  if (!selectedOption) {
    console.warn("[HRMIS][EOL_ONLEAVE] No selected option found in facility select");
    return null;
  }

  const value = _norm(selectedOption.value || "");
  const dataName = _norm(selectedOption.dataset.name || "");
  const textName = _norm(selectedOption.textContent || "");
  const finalName = dataName || textName;
  const optionLoc = _canonLoc(selectedOption.dataset.levelOfCare || "");

  console.log("[HRMIS][EOL_ONLEAVE] Selected facility option:", {
    value,
    dataName,
    textName,
    finalName,
    optionLoc,
  });

  if (!finalName || finalName.toLowerCase() === "select facility" || value === "") {
    console.info("[HRMIS][EOL_ONLEAVE] Placeholder facility option selected");
    return {
      value,
      dataName,
      textName,
      finalName: "",
      normalizedName: "",
      optionLevelOfCare: optionLoc,
      selectedOption,
    };
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
    console.warn("[HRMIS][EOL_ONLEAVE] _findFacilityByName called with empty normalizedName");
    return null;
  }

  console.group("[HRMIS][EOL_ONLEAVE] Facility matching");
  console.log("wanted raw name:", facilityMeta.finalName);
  console.log("wanted normalized:", wanted);

  const exactMatch =
    facilities.find((f) => _normFacilityName(f?.name || "") === wanted) || null;

  if (exactMatch) {
    console.log("[HRMIS][EOL_ONLEAVE] Exact match found:", {
      id: exactMatch.id,
      name: exactMatch.name,
      normalized: _normFacilityName(exactMatch.name || ""),
      level_of_care: exactMatch.level_of_care || exactMatch.levelOfCare || "",
    });
    console.groupEnd();
    return exactMatch;
  }

  const containsMatch =
    facilities.find((f) => {
      const apiName = _normFacilityName(f?.name || "");
      return apiName.includes(wanted) || wanted.includes(apiName);
    }) || null;

  if (containsMatch) {
    console.warn("[HRMIS][EOL_ONLEAVE] Exact match failed; contains-match used:", {
      id: containsMatch.id,
      name: containsMatch.name,
      normalized: _normFacilityName(containsMatch.name || ""),
      level_of_care: containsMatch.level_of_care || containsMatch.levelOfCare || "",
    });
    console.groupEnd();
    return containsMatch;
  }

  console.warn("[HRMIS][EOL_ONLEAVE] No match found in API for facility name", {
    wanted,
    rawWanted: facilityMeta.finalName,
    sampleFacilities: facilities.slice(0, 20).map((f) => ({
      name: f?.name || "",
      normalized: _normFacilityName(f?.name || ""),
      level_of_care: f?.level_of_care || f?.levelOfCare || "",
    })),
  });

  console.groupEnd();
  return null;
}

function _extractFacilityLevelOfCare(facility, facilityMeta) {
  const apiLoc = _canonLoc(facility?.level_of_care || facility?.levelOfCare || "");
  const xmlLoc = _canonLoc(facilityMeta?.optionLevelOfCare || "");

  console.group("[HRMIS][EOL_ONLEAVE] Extracting facility level_of_care");
  console.log("API facility:", facility);
  console.log("API level_of_care:", apiLoc);
  console.log("XML option level_of_care:", xmlLoc);

  if (apiLoc) {
    console.log("[HRMIS][EOL_ONLEAVE] Using API level_of_care");
    console.groupEnd();
    return apiLoc;
  }

  if (xmlLoc) {
    console.warn("[HRMIS][EOL_ONLEAVE] API level_of_care missing; using XML option fallback");
    console.groupEnd();
    return xmlLoc;
  }

  console.warn("[HRMIS][EOL_ONLEAVE] No level_of_care available from API or XML");
  console.groupEnd();
  return "";
}

function _filterDesignationByFacilityAndLevel(designationSelect, facilityName, levelOfCare, label) {
  if (!designationSelect) {
    console.warn("[HRMIS][EOL_ONLEAVE] designationSelect missing in _filterDesignationByFacilityAndLevel");
    return;
  }

  console.group(`[HRMIS][EOL_ONLEAVE] Filter designation :: ${label || "unknown"}`);

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

    console.log("[HRMIS][EOL_ONLEAVE] designation option check:", {
      optionValue: option.value,
      optionText: _norm(option.textContent || ""),
      optionFacilityName,
      optionLoc,
      requiredFacilityName,
      requiredLoc,
      visible,
    });

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
    console.warn("[HRMIS][EOL_ONLEAVE] Selected designation no longer matches filter, clearing it", {
      selectedValue,
      selectedText: _norm(selectedOption.textContent || ""),
      requiredFacilityName,
      requiredLoc,
      skipFacilityMatch,
    });

    designationSelect.value = "";
    designationSelect.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (typeof designationSelect._hrmisRefreshCombobox === "function") {
    console.log("[HRMIS][EOL_ONLEAVE] Refreshing designation combobox");
    designationSelect._hrmisRefreshCombobox();
  }

  console.log("[HRMIS][EOL_ONLEAVE] filter summary:", {
    visibleCount,
    totalReal,
    requiredFacilityName,
    requiredLoc,
    skipFacilityMatch,
  });

  console.groupEnd();
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
    console.warn("[HRMIS][EOL_ONLEAVE] designationSelect missing in _showAllUniqueDesignations");
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

  console.log("[HRMIS][EOL_ONLEAVE] Reporting to Health Department -> showing all unique designations");
}

function _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, sourceLabel, opts) {
  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][EOL_ONLEAVE] Missing facility/designation pair", {
      sourceLabel,
      facilityFound: !!facilitySelect,
      designationFound: !!designationSelect,
    });
    return;
  }

  opts = opts || {};

  console.group(`[HRMIS][EOL_ONLEAVE] runFilter :: ${sourceLabel || "unknown"}`);

  // NEW: reporting_to = health_department => show all unique designations
  if (opts.reportingTo === "health_department") {
    console.info("[HRMIS][EOL_ONLEAVE] reporting_to=health_department, skipping facility filter");
    _showAllUniqueDesignations(designationSelect);
    console.groupEnd();
    return;
  }

  const facilityValue = _norm(facilitySelect.value);
  const facilityMeta = _getSelectedFacilityMeta(facilitySelect);

  console.log("facility field:", facilitySelect.name);
  console.log("designation field:", designationSelect.name);
  console.log("facilityValue:", facilityValue);
  console.log("facilityMeta:", facilityMeta);

  if (!facilityValue || _isOther(facilityValue) || !facilityMeta || !facilityMeta.finalName) {
    console.info("[HRMIS][EOL_ONLEAVE] No facility selected, hiding all designation options");
    _hideAllDesignationsExceptDefault(designationSelect);
    console.groupEnd();
    return;
  }

  const matchedFacility = _findFacilityByName(facilities, facilityMeta);
  const levelOfCare = _extractFacilityLevelOfCare(matchedFacility, facilityMeta);

  console.log("matchedFacility:", matchedFacility);
  console.log("final levelOfCare used for filtering:", levelOfCare);

  _filterDesignationByFacilityAndLevel(
    designationSelect,
    facilityMeta.finalName,
    levelOfCare,
    sourceLabel
  );

  console.groupEnd();
}

function _bindFacilityDesignationPair(facilitySelect, designationSelect, facilities, label) {
  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][EOL_ONLEAVE] pair not found", {
      label,
      facilityFound: !!facilitySelect,
      designationFound: !!designationSelect,
    });
    return;
  }

  console.group(`[HRMIS][EOL_ONLEAVE] Bind pair :: ${label}`);
  console.log("facility select:", facilitySelect);
  console.log("designation select:", designationSelect);

  _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:initial`);

  if (facilitySelect.dataset.hrmisEolOnleaveBound !== "1") {
    facilitySelect.dataset.hrmisEolOnleaveBound = "1";

    facilitySelect.addEventListener("change", function () {
      console.log("[HRMIS][EOL_ONLEAVE] facility changed", {
        label,
        facilityName: facilitySelect.name,
        facilityValue: facilitySelect.value,
      });
      _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:change`);
    });
  }

  if (designationSelect.dataset.hrmisEolOnleaveFocusBound !== "1") {
    designationSelect.dataset.hrmisEolOnleaveFocusBound = "1";

    designationSelect.addEventListener("focus", function () {
      console.log("[HRMIS][EOL_ONLEAVE] designation focused", {
        label,
        designationName: designationSelect.name,
      });
      _runFacilityDesignationFilter(facilitySelect, designationSelect, facilities, `${label}:focus`);
    });
  }

  console.groupEnd();
}

function _bindEolBox(form, facilities) {
  console.group("[HRMIS][EOL_ONLEAVE] Bind EOL PGship");

  const box = _qs(form, "#eol_box");
  if (!box) {
    console.warn("[HRMIS][EOL_ONLEAVE] #eol_box not found");
    console.groupEnd();
    return;
  }

  const facilitySelect = _qs(box, 'select[name="facility_id"]');
  const designationSelect = _qs(box, 'select[name="hrmis_designation"]');

  console.log("eol facility select found:", !!facilitySelect);
  console.log("eol designation select found:", !!designationSelect);

  _bindFacilityDesignationPair(
    facilitySelect,
    designationSelect,
    facilities,
    "eol_pgship"
  );

  console.groupEnd();
}

function _bindOnLeaveBox(form, facilities) {
  console.group("[HRMIS][EOL_ONLEAVE] Bind On Leave");

  const box = _qs(form, "#on_leave_box");
  if (!box) {
    console.warn("[HRMIS][EOL_ONLEAVE] #on_leave_box not found");
    console.groupEnd();
    return;
  }

  const facilitySelect = _qs(box, 'select[name="frontend_onleave_facility_id"]');
  const designationSelect = _qs(box, 'select[name="hrmis_designation"]');
  const reportingToSelect = _qs(box, 'select[name="frontend_onleave_reporting_to"]');

  console.log("on_leave facility select found:", !!facilitySelect);
  console.log("on_leave designation select found:", !!designationSelect);
  console.log("on_leave reporting_to select found:", !!reportingToSelect);

  if (!facilitySelect || !designationSelect) {
    console.groupEnd();
    return;
  }

  function run(source) {
    const reportingTo = _norm(reportingToSelect?.value || "");
    _runFacilityDesignationFilter(
      facilitySelect,
      designationSelect,
      facilities,
      `on_leave:${source}`,
      { reportingTo }
    );
  }

  run("initial");

  if (facilitySelect.dataset.hrmisEolOnleaveBound !== "1") {
    facilitySelect.dataset.hrmisEolOnleaveBound = "1";
    facilitySelect.addEventListener("change", function () {
      run("facility_change");
    });
  }

  if (designationSelect.dataset.hrmisEolOnleaveFocusBound !== "1") {
    designationSelect.dataset.hrmisEolOnleaveFocusBound = "1";
    designationSelect.addEventListener("focus", function () {
      run("designation_focus");
    });
  }

  if (reportingToSelect && reportingToSelect.dataset.hrmisEolOnleaveReportingBound !== "1") {
    reportingToSelect.dataset.hrmisEolOnleaveReportingBound = "1";
    reportingToSelect.addEventListener("change", function () {
      run("reporting_change");
    });
  }

  console.groupEnd();
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

      const eolBox = _qs(form, "#eol_box");
      const onLeaveBox = _qs(form, "#on_leave_box");

      const eolDesignation = eolBox
        ? _qs(eolBox, 'select[name="hrmis_designation"]')
        : null;
      const eolFacility = eolBox
        ? _qs(eolBox, 'select[name="facility_id"]')
        : null;

      const onLeaveDesignation = onLeaveBox
        ? _qs(onLeaveBox, 'select[name="hrmis_designation"]')
        : null;
      const onLeaveFacility = onLeaveBox
        ? _qs(onLeaveBox, 'select[name="frontend_onleave_facility_id"]')
        : null;

      if (sel === eolDesignation && eolFacility) {
        console.info("[HRMIS][EOL_ONLEAVE] eol designation focusin -> rerun filter");
        _runFacilityDesignationFilter(
          eolFacility,
          eolDesignation,
          facilities,
          "eol_pgship:focusin"
        );
      }

      const onLeaveReportingTo = onLeaveBox
        ? _qs(onLeaveBox, 'select[name="frontend_onleave_reporting_to"]')
        : null;

    if (sel === onLeaveDesignation && onLeaveFacility) {
    console.info("[HRMIS][EOL_ONLEAVE] on_leave designation focusin -> rerun filter");
    _runFacilityDesignationFilter(
        onLeaveFacility,
        onLeaveDesignation,
        facilities,
        "on_leave:focusin",
        { reportingTo: _norm(onLeaveReportingTo?.value || "") }
    );
    }
    },
    true
  );
}

function _initEolAndOnLeaveFacilityDesignationFilter() {
  console.group("[HRMIS][EOL_ONLEAVE] Init");

  const form = _qs(document, "#profile_update_form") || document;
  const isSubmittedView = !!form?.classList?.contains?.("is-submitted");

  if (isSubmittedView) {
    console.info("[HRMIS][EOL_ONLEAVE] Submitted/read-only view detected. Skipping.");
    console.groupEnd();
    return;
  }

  if (form && form.dataset && form.dataset.hrmisEolOnleaveFilterInit === "1") {
    console.info("[HRMIS][EOL_ONLEAVE] already initialized, skipping");
    console.groupEnd();
    return;
  }

  if (form && form.dataset) {
    form.dataset.hrmisEolOnleaveFilterInit = "1";
  }

  const facilities = _readFacilitiesJson(form);

  _bindEolBox(form, facilities);
  _bindOnLeaveBox(form, facilities);
  _bindFocusRefresh(form, facilities);

  console.info("[HRMIS][EOL_ONLEAVE] EOL PGship + On Leave filter initialized successfully");
  console.groupEnd();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initEolAndOnLeaveFacilityDesignationFilter);
} else {
  _initEolAndOnLeaveFacilityDesignationFilter();
}

window.addEventListener("pageshow", _initEolAndOnLeaveFacilityDesignationFilter);