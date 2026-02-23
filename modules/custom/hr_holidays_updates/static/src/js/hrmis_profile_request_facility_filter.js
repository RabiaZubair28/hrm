/** @odoo-module **/

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}
function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}
function _isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

/** Extract numeric BPS like "17", "BPS-17", "17.0" -> "17" */
function _normBps(val) {
  const s = String(val || "").trim();
  const m = s.match(/\d+/);
  return m ? String(parseInt(m[0], 10)) : "";
}

function _optBps(opt) {
  if (!opt) return "";
  const fromAttr = _normBps(opt.getAttribute("data-bps"));
  if (_isEmpty(fromAttr)) return _normBps(opt.textContent);

  if (parseInt(fromAttr, 10) > 22) {
    const fromText = _normBps(opt.textContent);
    return _isEmpty(fromText) ? fromAttr : fromText;
  }
  return fromAttr;
}

/** robust district id reader (supports multiple attribute spellings) */
function _optDistrictId(opt) {
  if (!opt) return "";
  return String(
    opt.getAttribute("data-district-id") ||
      opt.getAttribute("data-district") ||
      opt.getAttribute("data-district_id") ||
      opt.getAttribute("data-districtid") ||
      "",
  ).trim();
}

/** robust facility id reader */
function _optFacilityId(opt) {
  if (!opt) return "";
  return String(
    opt.getAttribute("data-facility-id") ||
      opt.getAttribute("data-facility") ||
      opt.getAttribute("data-facility_id") ||
      opt.getAttribute("data-facilityid") ||
      "",
  ).trim();
}

/**
 * Unhide/Hide safely; always keep placeholder visible.
 * IMPORTANT: do NOT dispatch "change" here (it causes recursion/races).
 */
function _toggleOptions(selectEl, predicateFn) {
  if (!selectEl) return;

  const opts = Array.from(selectEl.options || []);
  opts.forEach((opt, idx) => {
    if (idx === 0) {
      opt.hidden = false;
      opt.style.display = "";
      return;
    }
    const visible = !!predicateFn(opt, idx);
    opt.hidden = !visible;
    opt.style.display = visible ? "" : "none";
  });

  const sel = selectEl.options?.[selectEl.selectedIndex];
  if (sel && (sel.hidden || sel.style.display === "none")) {
    selectEl.selectedIndex = 0;
    if (selectEl.options?.[0]) selectEl.options[0].selected = true;
  }

  if (selectEl._hrmisRefreshCombobox) selectEl._hrmisRefreshCombobox();
}

/* ----------------------------
 * OTHER facility helpers
 * ---------------------------- */
function _isOtherFacilityValue(v) {
  return String(v || "").trim() === "__other__";
}

/**
 * Find "Other Facility" input+wrap robustly (because templates differ).
 */
function _findOtherFacilityUI(scope) {
  const root = scope || document;

  let wrap =
    _qs(root, ".js-current-facility-other-wrap") ||
    _qs(root, ".js-post-facility-other-wrap") ||
    _qs(root, "#facility_other_wrap") ||
    _qs(root, "#other_facility_wrap") ||
    _qs(root, "[data-hrmis-other-facility-wrap]") ||
    null;

  let input =
    _qs(root, ".js-current-facility-other") ||
    _qs(root, ".js-post-facility-other") ||
    _qs(root, 'input[name="facility_other_name"]') ||
    _qs(root, 'input[name="facility_other"]') ||
    _qs(root, 'input[name="other_facility"]') ||
    _qs(root, 'input[name="hrmis_facility_other"]') ||
    _qs(root, 'input[name="posting_facility_other_name[]"]') ||
    _qs(root, 'input[name="posting_facility_other[]"]') ||
    null;

  if (!wrap && input) {
    wrap =
      input.closest(".form-group") ||
      input.closest(".o_form_group") ||
      input.parentElement ||
      null;
  }

  return { wrap, input };
}

/**
 * Toggle "Other facility" UI.
 * - When hidden: disable input so it DOES NOT submit
 * - When shown: enable + required
 */
function _toggleOtherFacilityInScope(scope, facilitySelect) {
  const { wrap, input } = _findOtherFacilityUI(scope);
  if (!wrap || !input || !facilitySelect) return;

  const show = _isOtherFacilityValue(facilitySelect.value);

  wrap.style.display = show ? "" : "none";

  if (show) {
    input.removeAttribute("disabled");
    input.setAttribute("required", "required");
  } else {
    input.setAttribute("disabled", "disabled");
    input.removeAttribute("required");
    input.value = "";
  }
}

/* ----------------------------
 * Facilities (FETCH MODE) for CURRENT posting
 * ---------------------------- */

/**
 * Hard reset facility select to:
 * - placeholder (index 0, not hidden)
 * - Other option
 * and selects placeholder (empties selection).
 */
function _resetFacilitySelect(selectEl) {
  if (!selectEl) return;

  const placeholderText =
    (selectEl.options &&
      selectEl.options[0] &&
      selectEl.options[0].textContent.trim()) ||
    "Select Facility";

  selectEl.innerHTML = "";

  const ph = document.createElement("option");
  ph.value = "";
  ph.disabled = true;
  ph.hidden = false;
  ph.textContent = placeholderText;
  ph.selected = true;

  const other = document.createElement("option");
  other.value = "__other__";
  other.textContent = "Other";

  selectEl.appendChild(ph);
  selectEl.appendChild(other);

  selectEl.selectedIndex = 0;
  selectEl.value = "";

  if (selectEl._hrmisRefreshCombobox) selectEl._hrmisRefreshCombobox();
}

function _appendFacilitiesToSelect(selectEl, facilities) {
  if (!selectEl) return;
  if (!Array.isArray(facilities)) facilities = [];

  const otherOpt =
    Array.from(selectEl.options || []).find(
      (o) => String(o.value || "").trim() === "__other__",
    ) || null;

  for (const f of facilities) {
    if (!f || f.id === undefined || f.id === null) continue;

    const opt = document.createElement("option");
    opt.value = String(f.id);
    opt.textContent = String(f.name || "").trim() || `Facility #${f.id}`;

    if (otherOpt) selectEl.insertBefore(opt, otherOpt);
    else selectEl.appendChild(opt);
  }

  if (selectEl._hrmisRefreshCombobox) selectEl._hrmisRefreshCombobox();
}

async function _fetchFacilities(districtIdRaw) {
  const payload = {
    jsonrpc: "2.0",
    method: "call",
    params: { district_id: districtIdRaw || null },
    id: Date.now(),
  };

  try {
    const resp = await fetch("/hrmis/api/facilities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (data && data.error) return [];

    const result = data && data.result ? data.result : null;
    if (!result || result.ok !== true) return [];

    return Array.isArray(result.facilities) ? result.facilities : [];
  } catch (e) {
    return [];
  }
}

/* ----------------------------
 * CURRENT posting filters
 * ---------------------------- */
function _initCurrentPostingFilters() {
  const districtSelect =
    _qs(document, "select.js-current-district") ||
    _qs(document, 'select[name="district_id"]');

  const facilitySelect =
    _qs(document, "select.js-current-facility") ||
    _qs(document, 'select[name="facility_id"]');

  const designationSelect = _qs(document, 'select[name="hrmis_designation"]');
  const bpsInput = _qs(document, 'input[name="hrmis_bps"]');

  if (!districtSelect || !facilitySelect) return;

  // Ensure "Other facility" starts hidden + disabled based on current selection
  _toggleOtherFacilityInScope(document, facilitySelect);

  function getBps() {
    return _normBps(bpsInput ? bpsInput.value : "");
  }
  function getFacility() {
    return String(facilitySelect.value || "").trim();
  }

  function filterDesignations() {
    if (!designationSelect) return;

    const bps = getBps();
    const facilityId = getFacility();

    if (_isEmpty(bps)) {
      _toggleOptions(designationSelect, () => false);
      return;
    }

    _toggleOptions(designationSelect, (opt, idx) => {
      // keep placeholder visible
      if (idx === 0) return true;

      const val = String(opt.value || "").trim();
      if (_isEmpty(val)) return false;

      const optBps = _optBps(opt);
      const optFacilityId = _optFacilityId(opt);

      // fallback: if no bps tag, allow
      if (_isEmpty(optBps)) return true;

      const bpsOk = optBps === bps;
      if (!bpsOk) return false;

      // no facility selected yet => BPS only
      if (_isEmpty(facilityId)) return true;

      // "Other" selected => ignore facility tag
      if (_isOtherFacilityValue(facilityId)) return true;

      // if tagged, enforce; else allow
      if (!_isEmpty(optFacilityId)) return optFacilityId === facilityId;
      return true;
    });
  }

  async function refreshFacilities() {
    const selectedDistrictId = String(districtSelect.value || "").trim();

    // immediate empty facility to prevent sticky UI
    _resetFacilitySelect(facilitySelect);
    _toggleOtherFacilityInScope(document, facilitySelect);

    // district empty -> no fetch
    if (_isEmpty(selectedDistrictId)) {
      filterDesignations();
      return;
    }

    const facilities = await _fetchFacilities(selectedDistrictId);
    _appendFacilitiesToSelect(facilitySelect, facilities);

    // keep empty after filling
    facilitySelect.selectedIndex = 0;
    facilitySelect.value = "";
    if (facilitySelect.options?.[0]) facilitySelect.options[0].selected = true;

    if (facilitySelect._hrmisRefreshCombobox)
      facilitySelect._hrmisRefreshCombobox();

    _toggleOtherFacilityInScope(document, facilitySelect);
    filterDesignations();
  }

  // initial
  refreshFacilities();

  districtSelect.addEventListener("change", () => {
    refreshFacilities();
  });

  facilitySelect.addEventListener("change", () => {
    _toggleOtherFacilityInScope(document, facilitySelect);
    filterDesignations();
  });

  if (bpsInput) {
    bpsInput.addEventListener("input", filterDesignations);
    bpsInput.addEventListener("change", filterDesignations);
  }
}

/* ----------------------------
 * PREVIOUS posting row filters
 * (DOM-only, as teammate wrote)
 * ---------------------------- */
function _filterFacilitiesInRow(row) {
  const district =
    _qs(row, ".js-post-district") ||
    _qs(row, 'select[name="posting_district_id[]"]');

  const facility =
    _qs(row, ".js-post-facility") ||
    _qs(row, 'select[name="posting_facility_id[]"]');

  if (!district || !facility) return;

  const selectedDistrictId = String(district.value || "").trim();

  _toggleOptions(facility, (opt) => {
    const val = String(opt.value || "").trim();
    if (!val) return false;

    if (val === "__other__") return true;

    const optDistrict = _optDistrictId(opt);
    if (_isEmpty(selectedDistrictId)) return true;

    return !_isEmpty(optDistrict) && optDistrict === selectedDistrictId;
  });

  _toggleOtherFacilityInScope(row, facility);
}

function _initPrevPostingRowFilters() {
  const container = _qs(document, "#prev_post_rows");
  if (!container) return;

  function filterDesignationsInRow(row) {
    const designation = _qs(row, 'select[name="posting_designation_id[]"]');
    const bps = _qs(row, 'input[name="posting_bps[]"]');
    const facility = _qs(row, 'select[name="posting_facility_id[]"]');
    if (!designation) return;

    const bpsVal = _normBps(bps ? bps.value : "");
    const facilityId = String(facility ? facility.value : "").trim();

    if (_isEmpty(bpsVal)) {
      _toggleOptions(designation, () => false);
      return;
    }

    _toggleOptions(designation, (opt, idx) => {
      if (idx === 0) return true;

      const optBps = _optBps(opt);
      const optFacilityId = _optFacilityId(opt);

      if (_isEmpty(optBps)) return true;

      const bpsOk = optBps === bpsVal;
      if (!bpsOk) return false;

      if (_isOtherFacilityValue(facilityId)) return true;

      if (!_isEmpty(facilityId) && !_isEmpty(optFacilityId))
        return optFacilityId === facilityId;

      return true;
    });
  }

  container.addEventListener("change", (e) => {
    const row = e.target?.closest?.(".hrmis-repeat-row");
    if (!row) return;

    if (
      e.target.matches(".js-post-district") ||
      e.target.matches(".js-post-facility") ||
      e.target.matches('select[name="posting_district_id[]"]') ||
      e.target.matches('select[name="posting_facility_id[]"]')
    ) {
      _filterFacilitiesInRow(row);
    }

    if (
      e.target.matches('input[name="posting_bps[]"]') ||
      e.target.matches('select[name="posting_facility_id[]"]')
    ) {
      filterDesignationsInRow(row);
    }
  });

  container.addEventListener("input", (e) => {
    const row = e.target?.closest?.(".hrmis-repeat-row");
    if (!row) return;

    if (e.target.matches('input[name="posting_bps[]"]')) {
      filterDesignationsInRow(row);
    }
  });

  // initial for existing rows
  _qsa(container, ".hrmis-repeat-row").forEach((row) => {
    _filterFacilitiesInRow(row);
    filterDesignationsInRow(row);
  });

  // auto-apply when rows are added dynamically
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes || [])) {
        if (!(node instanceof HTMLElement)) continue;

        const rows = node.classList?.contains("hrmis-repeat-row")
          ? [node]
          : _qsa(node, ".hrmis-repeat-row");

        rows.forEach((r) => {
          _filterFacilitiesInRow(r);
          filterDesignationsInRow(r);
        });
      }
    }
  });
  obs.observe(container, { childList: true, subtree: true });
}

/* ----------------------------
 * Suspension / On-leave: district -> facility (FETCH MODE)
 * ---------------------------- */
function _initStatusBoxFacilityFilters() {
  function bind(districtSel, facilitySel, key) {
    if (!districtSel || !facilitySel) return;

    const bindKey = `hrmisStatusDfBound_${key}`;
    if (districtSel.dataset[bindKey] === "1") return;
    districtSel.dataset[bindKey] = "1";

    function apply() {
      const selectedDistrictId = String(districtSel.value || "").trim();

      // match current-posting UX: no district => no facilities
      if (_isEmpty(selectedDistrictId)) {
        _toggleOptions(facilitySel, () => false);
        return;
      }

      _toggleOptions(facilitySel, (opt) => {
        const val = String(opt.value || "").trim();
        if (!val) return false;
        const optDistrict = _optDistrictId(opt);
        return !_isEmpty(optDistrict) && optDistrict === selectedDistrictId;
      });
    }

    apply();
    districtSel.addEventListener("change", apply);
  }

  // Suspension (Reporting To = Facility)
  bind(
    _qs(document, "select.js-suspension-district"),
    _qs(document, "select.js-suspension-facility"),
    "suspension",
  );

  // On Leave (Reporting To = Facility)
  bind(
    _qs(document, "select.js-onleave-district"),
    _qs(document, "select.js-onleave-facility"),
    "onleave",
  );
}

/* ----------------------------
 * Init
 * ---------------------------- */
let __hrmis_init_done = false;

function _initFilters() {
  // allow re-run safely without duplicating listeners too much
  // (we still guard by __hrmis_init_done for first run)
  _initCurrentPostingFilters();
  _initPrevPostingRowFilters();
  _initStatusBoxFacilityFilters();
}

function _initOnce() {
  if (__hrmis_init_done) return;
  __hrmis_init_done = true;
  _initFilters();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initOnce);
} else {
  _initOnce();
}

window.addEventListener("pageshow", _initOnce);

// re-run after searchable selects wrap the <select>
setTimeout(() => {
  _initFilters();
}, 0);
