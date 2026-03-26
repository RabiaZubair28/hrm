/** @odoo-module **/

// HRMIS:
// Previous Postings -> Facility -> Designation filtering
// Match facility by NAME
// Logs API data, XML data, normalization, matching, fallback,
// row binding, dynamic row detection, and designation filtering

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
    console.error("[HRMIS][PREV_POST] JSON parse failed:", e);
    console.error("[HRMIS][PREV_POST] Raw JSON preview:", (text || "").slice(0, 1000));
    return fallback;
  }
}

function _readFacilitiesJson(form) {
  

  const scriptEl = _qs(form, "#hrmis_facilities_json");
  if (!scriptEl) {
    console.warn("[HRMIS][PREV_POST] #hrmis_facilities_json not found.");
    console.groupEnd();
    return [];
  }

  const raw = scriptEl.textContent || scriptEl.innerText || "[]";
  const data = _safeJsonParse(raw, []);
  const facilities = Array.isArray(data) ? data : [];

 

  return facilities;
}

function _getSelectedFacilityMeta(facilitySelect) {
  if (!facilitySelect) {
    console.warn("[HRMIS][PREV_POST] _getSelectedFacilityMeta called without select");
    return null;
  }

  const selectedOption =
    facilitySelect.selectedOptions && facilitySelect.selectedOptions.length
      ? facilitySelect.selectedOptions[0]
      : facilitySelect.options[facilitySelect.selectedIndex] || null;

  if (!selectedOption) {
    console.warn("[HRMIS][PREV_POST] No selected option found in facility select");
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
    console.warn("[HRMIS][PREV_POST] _findFacilityByName called with empty normalizedName");
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
    console.warn("[HRMIS][PREV_POST] Exact match failed; contains-match used:", {
      id: containsMatch.id,
      name: containsMatch.name,
      normalized: _normFacilityName(containsMatch.name || ""),
      level_of_care: containsMatch.level_of_care || containsMatch.levelOfCare || "",
    });
    console.groupEnd();
    return containsMatch;
  }

  console.warn("[HRMIS][PREV_POST] No match found in API for facility name", {
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

  console.group("[HRMIS][PREV_POST] Extracting facility level_of_care");
  console.log("API facility:", facility);
  console.log("API level_of_care:", apiLoc);
  console.log("XML option level_of_care:", xmlLoc);

  if (apiLoc) {
    console.log("[HRMIS][PREV_POST] Using API level_of_care");
    console.groupEnd();
    return apiLoc;
  }

  if (xmlLoc) {
    console.warn("[HRMIS][PREV_POST] API level_of_care missing; using XML option level_of_care fallback");
    console.groupEnd();
    return xmlLoc;
  }

  console.warn("[HRMIS][PREV_POST] No level_of_care available from API or XML");
  console.groupEnd();
  return "";
}

function _filterDesignationByFacilityAndLevel(designationSelect, facilityName, levelOfCare, label) {
  if (!designationSelect) {
    console.warn("[HRMIS][PREV_POST] designationSelect missing in _filterDesignationByFacilityAndLevel");
    return;
  }

  console.group(`[HRMIS][PREV_POST] Filter designation :: ${label || "unknown"}`);

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

    console.log("[HRMIS][PREV_POST] designation option check:", {
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
    console.warn("[HRMIS][PREV_POST] Selected designation no longer matches filter, clearing it", {
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
    console.log("[HRMIS][PREV_POST] Refreshing designation combobox");
    designationSelect._hrmisRefreshCombobox();
  }

  console.log("[HRMIS][PREV_POST] filter summary:", {
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

function _runPreviousPostingFilter(facilitySelect, designationSelect, facilities, sourceLabel) {
  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][PREV_POST] Missing facility/designation pair", {
      sourceLabel,
      facilityFound: !!facilitySelect,
      designationFound: !!designationSelect,
    });
    return;
  }

  console.group(`[HRMIS][PREV_POST] runFilter :: ${sourceLabel || "unknown"}`);

  const facilityValue = _norm(facilitySelect.value);
  const facilityMeta = _getSelectedFacilityMeta(facilitySelect);

  console.log("facility field:", facilitySelect.name);
  console.log("designation field:", designationSelect.name);
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
    levelOfCare,
    sourceLabel
  );

  console.groupEnd();
}

function _bindPreviousPostingRow(row, facilities, label) {
  if (!row) {
    console.warn("[HRMIS][PREV_POST] Empty row passed for binding", { label });
    return;
  }

  const facilitySelect = _qs(row, 'select[name="posting_facility_id[]"]');
  const designationSelect = _qs(row, 'select[name="posting_designation_id[]"]');

  if (!facilitySelect || !designationSelect) {
    console.warn("[HRMIS][PREV_POST] Row fields not found", {
      label,
      facilityFound: !!facilitySelect,
      designationFound: !!designationSelect,
      row,
    });
    return;
  }

  if (row.dataset.hrmisPrevPostBound === "1") {
    console.info("[HRMIS][PREV_POST] Row already bound, skipping", { label });
    return;
  }

  row.dataset.hrmisPrevPostBound = "1";

  console.group(`[HRMIS][PREV_POST] Bind row :: ${label}`);
  console.log("facility select:", facilitySelect);
  console.log("designation select:", designationSelect);

  _runPreviousPostingFilter(facilitySelect, designationSelect, facilities, `${label}:initial`);

  facilitySelect.addEventListener("change", function () {
    console.log("[HRMIS][PREV_POST] facility changed", {
      label,
      facilityName: facilitySelect.name,
      facilityValue: facilitySelect.value,
    });
    _runPreviousPostingFilter(facilitySelect, designationSelect, facilities, `${label}:change`);
  });

  designationSelect.addEventListener("focus", function () {
    console.log("[HRMIS][PREV_POST] designation focused", {
      label,
      designationName: designationSelect.name,
    });
    _runPreviousPostingFilter(facilitySelect, designationSelect, facilities, `${label}:focus`);
  });

  console.groupEnd();
}

function _bindPreviousPostingRows(form, facilities) {
  const rows = _qsa(form, "#prev_post_rows .hrmis-repeat-row");
  console.log("[HRMIS][PREV_POST] previous posting rows found:", rows.length);

  rows.forEach((row, idx) => {
    _bindPreviousPostingRow(row, facilities, `prev_post_row_${idx}`);
  });
}

function _watchPreviousPostingRows(form, facilities) {
  const container = _qs(form, "#prev_post_rows");
  if (!container) {
    console.warn("[HRMIS][PREV_POST] #prev_post_rows not found, observer not attached");
    return;
  }

  if (container.dataset.hrmisPrevPostObserverBound === "1") {
    console.info("[HRMIS][PREV_POST] observer already bound");
    return;
  }
  container.dataset.hrmisPrevPostObserverBound = "1";

  const observer = new MutationObserver((mutations) => {
    let needsRebind = false;

    mutations.forEach((mutation) => {
      if (mutation.type !== "childList") return;

      if (mutation.addedNodes && mutation.addedNodes.length) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;

          if (
            node.matches?.(".hrmis-repeat-row") ||
            node.querySelector?.('.hrmis-repeat-row') ||
            node.querySelector?.('select[name="posting_facility_id[]"]') ||
            node.querySelector?.('select[name="posting_designation_id[]"]')
          ) {
            needsRebind = true;
          }
        });
      }
    });

    if (needsRebind) {
      console.info("[HRMIS][PREV_POST] New previous posting row detected. Rebinding rows.");
      _bindPreviousPostingRows(form, facilities);
    }
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
  });

  console.info("[HRMIS][PREV_POST] Mutation observer attached on #prev_post_rows");
}

function _initPreviousPostingFacilityDesignationFilter() {
  console.group("[HRMIS][PREV_POST] Init");

  const form = _qs(document, "#profile_update_form") || document;
  const isSubmittedView = !!form?.classList?.contains?.("is-submitted");

  if (isSubmittedView) {
    console.info("[HRMIS][PREV_POST] Submitted/read-only view detected. Skipping.");
    console.groupEnd();
    return;
  }

  if (form && form.dataset && form.dataset.hrmisPrevPostFilterInit === "1") {
    console.info("[HRMIS][PREV_POST] already initialized, rebinding rows only");
    const facilities = _readFacilitiesJson(form);
    _bindPreviousPostingRows(form, facilities);
    console.groupEnd();
    return;
  }

  if (form && form.dataset) {
    form.dataset.hrmisPrevPostFilterInit = "1";
  }

  const facilities = _readFacilitiesJson(form);
  _bindPreviousPostingRows(form, facilities);
  _watchPreviousPostingRows(form, facilities);

  console.info("[HRMIS][PREV_POST] Previous posting facility designation filter initialized successfully");
  console.groupEnd();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initPreviousPostingFacilityDesignationFilter);
} else {
  _initPreviousPostingFacilityDesignationFilter();
}

window.addEventListener("pageshow", _initPreviousPostingFacilityDesignationFilter);