/** @odoo-module **/

// HRMIS:
// Debug-heavy facility -> designation filtering
// Match facility by NAME
// Logs API data, XML data, normalization, matching, fallback, and designation filtering

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
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
  opt.hidden = !visible;
  opt.style.display = visible ? "" : "none";
}

function _safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("[HRMIS][LOC] JSON parse failed:", e);
    console.error("[HRMIS][LOC] Raw JSON preview:", (text || "").slice(0, 1000));
    return fallback;
  }
}

function _readFacilitiesJson(form) {
  const scriptEl = _qs(form, "#hrmis_facilities_json");
  if (!scriptEl) {
    console.warn("[HRMIS][LOC] #hrmis_facilities_json not found.");
    return [];
  }

  const raw = scriptEl.textContent || scriptEl.innerText || "[]";
  const data = _safeJsonParse(raw, []);
  const facilities = Array.isArray(data) ? data : [];

  console.groupEnd();

  return facilities;
}

function _getCurrentPostingBox(form) {
  return _qs(form, "#current_posting_box");
}

function _getCurrentPostingFacilitySelect(form) {
  const box = _getCurrentPostingBox(form);
  if (!box) {
    console.warn("[HRMIS][LOC] #current_posting_box not found");
    return null;
  }

  const el = _qs(box, 'select[name="posting_facility_id"]');
  if (!el) {
    console.warn("[HRMIS][LOC] Current posting facility select not found");
  }
  return el;
}

function _getCurrentPostingDesignationSelect(form) {
  const box = _getCurrentPostingBox(form);
  if (!box) {
    console.warn("[HRMIS][LOC] #current_posting_box not found for designation");
    return null;
  }

  const el = _qs(box, 'select[name="hrmis_designation"]');
  if (!el) {
    console.warn("[HRMIS][LOC] Current posting designation select not found");
  }
  return el;
}

function _getSelectedFacilityMeta(facilitySelect) {
  if (!facilitySelect) {
    console.warn("[HRMIS][LOC] _getSelectedFacilityMeta called without select");
    return null;
  }

  const selectedOption =
    facilitySelect.selectedOptions && facilitySelect.selectedOptions.length
      ? facilitySelect.selectedOptions[0]
      : facilitySelect.options[facilitySelect.selectedIndex] || null;

  if (!selectedOption) {
    console.warn("[HRMIS][LOC] No selected option found in facility select");
    return null;
  }

  const value = _norm(selectedOption.value || "");
  const dataName = _norm(selectedOption.dataset.name || "");
  const textName = _norm(selectedOption.textContent || "");
  const finalName = dataName || textName;
  const optionLoc = _canonLoc(selectedOption.dataset.levelOfCare || "");



  if (
    !finalName ||
    finalName.toLowerCase() === "select facility" ||
    value === ""
  ) {
    console.info("[HRMIS][LOC] Placeholder facility option selected");
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
    console.warn("[HRMIS][LOC] _findFacilityByName called with empty normalizedName");
    return null;
  }

  console.group("[HRMIS][LOC] Facility matching");
  console.log("wanted raw name:", facilityMeta.finalName);
  console.log("wanted normalized:", wanted);

  const exactMatch =
    facilities.find((f) => _normFacilityName(f?.name || "") === wanted) || null;

  if (exactMatch) {
    console.log("Exact match found:", {
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
    console.warn("Exact match failed; contains-match used:", {
      id: containsMatch.id,
      name: containsMatch.name,
      normalized: _normFacilityName(containsMatch.name || ""),
      level_of_care: containsMatch.level_of_care || containsMatch.levelOfCare || "",
    });
    console.groupEnd();
    return containsMatch;
  }

  console.warn("No match found in API for facility name", {
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

  console.group("[HRMIS][LOC] Extracting facility level_of_care");
  console.log("API facility:", facility);
  console.log("API level_of_care:", apiLoc);
  console.log("XML option level_of_care:", xmlLoc);

  if (apiLoc) {
    console.log("Using API level_of_care");
    console.groupEnd();
    return apiLoc;
  }

  if (xmlLoc) {
    console.warn("API level_of_care missing; using XML option level_of_care fallback");
    console.groupEnd();
    return xmlLoc;
  }

  console.warn("No level_of_care available from API or XML");
  console.groupEnd();
  return "";
}

function _filterDesignationByFacilityAndLevel(designationSelect, facilityName, levelOfCare) {
  if (!designationSelect) {
    console.warn("[HRMIS][LOC] designationSelect missing in _filterDesignationByFacilityAndLevel");
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
    console.warn("[HRMIS][LOC] Selected designation no longer matches filter, clearing it", {
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
    designationSelect._hrmisRefreshCombobox();
  }

  console.log("filter summary:", {
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

function _initFacilityDesignationFilter() {
  const form = _qs(document, "#profile_update_form") || document;
  const isSubmittedView = !!form?.classList?.contains?.("is-submitted");

  if (isSubmittedView) {
    console.info("[HRMIS][LOC] Submitted/read-only view detected. Skipping.");
    return;
  }

  if (form && form.dataset && form.dataset.hrmisLocFilterBound === "1") {
    console.info("[HRMIS][LOC] already bound, skipping rebind");
    return;
  }
  if (form && form.dataset) form.dataset.hrmisLocFilterBound = "1";

  const facilities = _readFacilitiesJson(form);
  const facilitySelect = _getCurrentPostingFacilitySelect(form);
  const designationSelect = _getCurrentPostingDesignationSelect(form);

  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][LOC] facility/designation fields not found.", {
      facilitySelectFound: !!facilitySelect,
      designationSelectFound: !!designationSelect,
    });
    return;
  }

  function runFilter(source) {
    console.group(`[HRMIS][LOC] runFilter :: ${source || "unknown"}`);

    const facilityValue = _norm(facilitySelect.value);
    const facilityMeta = _getSelectedFacilityMeta(facilitySelect);

    console.log("facilityValue:", facilityValue);
    console.log("facilityMeta:", facilityMeta);

    if (!facilityValue || _isOther(facilityValue) || !facilityMeta || !facilityMeta.finalName) {
    console.info("[HRMIS][LOC] No facility selected, hiding all designation options");
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
        levelOfCare
        );

    console.groupEnd();
  }

  runFilter("initial");

  facilitySelect.addEventListener("change", function () {
    console.info("[HRMIS][LOC] facility change event fired");
    runFilter("change");
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

      if (sel === designationSelect) {
        console.info("[HRMIS][LOC] designation focusin -> rerun filter");
        runFilter("focusin");
      }
    },
    true
  );

  console.info("[HRMIS][LOC] Facility designation filter initialized successfully");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initFacilityDesignationFilter);
} else {
  _initFacilityDesignationFilter();
}

window.addEventListener("pageshow", _initFacilityDesignationFilter);