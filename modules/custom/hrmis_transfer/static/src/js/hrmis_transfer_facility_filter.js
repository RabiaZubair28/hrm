/** @odoo-module **/

function _safeJsonParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function fetchEligibleDestinations(employeeId) {
  if (!employeeId) return { ok: false, error: "missing_employee_id" };
  const url = `/hrmis/api/transfer/eligible_destinations?employee_id=${encodeURIComponent(employeeId)}`;
  const res = await fetch(url, { method: "GET", credentials: "same-origin" });
  // Odoo endpoints may return 200 with ok:false payload; treat non-200 as failure too.
  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }
  return await res.json();
}

function clearSelect(selectEl, placeholderText) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholderText || "Select";
  selectEl.appendChild(opt);
}

function populateDistricts(selectEl, districts) {
  clearSelect(selectEl, "Select district");
  (districts || []).forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.id);
    opt.textContent = d.name;
    selectEl.appendChild(opt);
  });
}

function populateFacilities(selectEl, facilities) {
  clearSelect(selectEl, "Select facility");
  (facilities || []).forEach((f) => {
    const opt = document.createElement("option");
    opt.value = String(f.id);
    const hasVacancy = typeof f.vacant !== "undefined" && f.vacant !== null;
    opt.textContent = hasVacancy ? `${f.name} (Vacant: ${f.vacant})` : f.name;
    opt.setAttribute("data-district-id", String(f.district_id || ""));
    opt.setAttribute("data-vacant", String(f.vacant ?? 0));
    opt.setAttribute("data-occupied", String(f.occupied ?? 0));
    opt.setAttribute("data-total", String(f.total ?? 0));
    opt.setAttribute("data-facility-name", String(f.name || ""));
    opt.setAttribute("data-facility-code", String(f.code || ""));
    opt.setAttribute("data-district-name", String(f.district_name || ""));
    selectEl.appendChild(opt);
  });
}

function populateDesignationOptions(selectEl, designations) {
  clearSelect(selectEl, "Select required designation");
  (designations || []).forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.value || "");
    opt.textContent = d.label || d.value || "";
    selectEl.appendChild(opt);
  });
}

function filterFacilities(districtSelect, facilitySelect) {
  if (!districtSelect || !facilitySelect) return;

  const districtId = districtSelect.value || "";
  const options = Array.from(facilitySelect.querySelectorAll("option"));

  // Always keep the placeholder visible
  options.forEach((opt, idx) => {
    if (idx === 0) {
      opt.hidden = false;
      opt.disabled = false;
      opt.style.display = "";
      return;
    }

    const optDistrictId = opt.getAttribute("data-district-id") || "";
    const visible = !districtId || optDistrictId === districtId;
    // `option.hidden` works in many browsers but is inconsistent in some
    // embedded/webview scenarios. Use display as the primary mechanism.
    opt.style.display = visible ? "" : "none";
    opt.hidden = !visible;
    opt.disabled = !visible;
  });

  // If currently selected facility is not in selected district, clear selection.
  const selected = facilitySelect.options[facilitySelect.selectedIndex];
  if (selected && selected.value) {
    const selectedDistrictId = selected.getAttribute("data-district-id") || "";
    if (districtId && selectedDistrictId !== districtId) {
      facilitySelect.value = "";
    }
  }
}

function initPair(groupName) {
  const district = document.querySelector(
    `select[data-hrmis-transfer-group="${groupName}"][name$="_district_id"]`,
  );
  const facility = document.querySelector(
    `select[data-hrmis-transfer-group="${groupName}"][name$="_facility_id"]`,
  );
  if (!district || !facility) return;

  // Initial filter (supports pre-filled district)
  filterFacilities(district, facility);
  district.addEventListener("change", () =>
    filterFacilities(district, facility),
  );
}

function initTransferForm() {
  const form = document.querySelector("form.hrmis-transfer-request-form");
  if (!form) return;

  const employeeId = form.getAttribute("data-employee-id") || "";
  const locationsUrl =
    form.getAttribute("data-transfer-locations-url") ||
    "/hrmis/api/transfer/emr_locations";
  const currentDistrict = document.querySelector(".js-hrmis-current-district");
  const currentFacility = document.querySelector(".js-hrmis-current-facility");
  const requiredDistrict = document.querySelector(".js-hrmis-required-district");
  const requiredFacility = document.querySelector(".js-hrmis-required-facility");
  const requiredDesignation = document.querySelector(
    ".js-hrmis-required-designation",
  );
  const msgEl = document.querySelector(".js-hrmis-transfer-eligibility-msg");
  const vacancyEl = document.querySelector(".js-hrmis-transfer-vacancy");
  const currentDistrictHidden = document.querySelector(
    'input[type="hidden"][name="current_emr_district_id"]',
  );
  const currentFacilityHidden = document.querySelector(
    'input[type="hidden"][name="current_emr_facility_id"]',
  );
  const requiredDistrictHidden = document.querySelector(
    'input[type="hidden"][name="required_emr_district_id"]',
  );
  const requiredFacilityHidden = document.querySelector(
    'input[type="hidden"][name="required_emr_facility_id"]',
  );

  if (!currentDistrict || !currentFacility || !requiredDistrict || !requiredFacility) {
    return;
  }

  const syncSelectValue = (selectEl, hiddenEl) => {
    if (hiddenEl) hiddenEl.value = selectEl?.value || "";
  };

  const renderFacilitiesForDistrict = (
    districtSelect,
    facilitySelect,
    allFacilities,
    selectedValue,
  ) => {
    const districtId = districtSelect.value || "";
    const facs = districtId
      ? (allFacilities || []).filter(
          (f) => String(f.district_id || "") === String(districtId),
        )
      : [];
    populateFacilities(facilitySelect, facs);
    if (
      selectedValue &&
      [...facilitySelect.options].some((opt) => opt.value === String(selectedValue))
    ) {
      facilitySelect.value = String(selectedValue);
    }
  };

  const updateVacancy = async () => {
    const opt = requiredFacility.options[requiredFacility.selectedIndex];
    if (!opt || !opt.value) {
      if (vacancyEl) vacancyEl.style.display = "none";
      return;
    }

    let payload;
    try {
      payload = await fetchEligibleDestinations(employeeId);
    } catch {
      payload = null;
    }

    if (!payload?.ok) {
      if (vacancyEl) vacancyEl.style.display = "none";
      return;
    }

    const eligible = (payload.facilities || []).find(
      (f) => String(f.id || "") === String(opt.value),
    );
    if (!eligible) {
      if (vacancyEl) vacancyEl.style.display = "none";
      return;
    }
    opt.setAttribute("data-vacant", String(eligible.vacant ?? 0));
    opt.setAttribute("data-occupied", String(eligible.occupied ?? 0));
    opt.setAttribute("data-total", String(eligible.total ?? 0));
    if (vacancyEl) {
      vacancyEl.textContent = `Vacant posts for your designation (BPS ${payload.employee_bps || ""}): ${eligible.vacant ?? 0} / ${eligible.total ?? 0} (Occupied: ${eligible.occupied ?? 0})`;
      vacancyEl.style.display = "";
    }
  };

  fetch(
    `${locationsUrl}?employee_id=${encodeURIComponent(employeeId)}`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    },
  )
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((payload) => {
      if (!payload?.ok) {
        if (msgEl) {
          msgEl.textContent =
            payload?.error ||
            "Could not load EMR districts and facilities. Please refresh.";
          msgEl.style.display = "";
        }
        return;
      }

      const emrDistricts = payload.districts || [];
      const emrFacilities = payload.facilities || [];
      const currentDistrictId = String(payload.current_district_id || "");
      const currentFacilityId = String(payload.current_facility_id || "");

      populateDistricts(currentDistrict, emrDistricts);
      populateDistricts(requiredDistrict, emrDistricts);
      populateFacilities(currentFacility, []);
      populateFacilities(requiredFacility, []);
      if (requiredDesignation && requiredDesignation.options.length <= 1) {
        populateDesignationOptions(requiredDesignation, []);
      }

      currentDistrict.addEventListener("change", () => {
        renderFacilitiesForDistrict(
          currentDistrict,
          currentFacility,
          emrFacilities,
        );
        syncSelectValue(currentDistrict, currentDistrictHidden);
        syncSelectValue(currentFacility, currentFacilityHidden);
      });
      currentFacility.addEventListener("change", () => {
        syncSelectValue(currentFacility, currentFacilityHidden);
      });
      requiredDistrict.addEventListener("change", () => {
        renderFacilitiesForDistrict(
          requiredDistrict,
          requiredFacility,
          emrFacilities,
        );
        syncSelectValue(requiredDistrict, requiredDistrictHidden);
        syncSelectValue(requiredFacility, requiredFacilityHidden);
        updateVacancy();
      });
      requiredFacility.addEventListener("change", () => {
        syncSelectValue(requiredFacility, requiredFacilityHidden);
        updateVacancy();
      });

      if (currentDistrictId) {
        currentDistrict.value = currentDistrictId;
        renderFacilitiesForDistrict(
          currentDistrict,
          currentFacility,
          emrFacilities,
          currentFacilityId,
        );
      }

      syncSelectValue(currentDistrict, currentDistrictHidden);
      syncSelectValue(currentFacility, currentFacilityHidden);
      syncSelectValue(requiredDistrict, requiredDistrictHidden);
      syncSelectValue(requiredFacility, requiredFacilityHidden);

      if (msgEl) {
        msgEl.textContent = "Districts and facilities are loaded from the EMR API.";
        msgEl.style.display = "";
        msgEl.style.color = "#444";
        msgEl.style.fontWeight = "600";
      }
    })
    .catch(() => {
      if (msgEl) {
        msgEl.textContent =
          "Could not load EMR districts and facilities. Please refresh.";
        msgEl.style.display = "";
      }
    });
}

function init() {
  initTransferForm();
}

// In some Odoo pages, assets can load after DOMContentLoaded.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Handle browser back/forward cache (page restored without a full reload).
window.addEventListener("pageshow", init);
