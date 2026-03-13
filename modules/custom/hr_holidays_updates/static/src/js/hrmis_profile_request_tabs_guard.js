/** @odoo-module **/

/**
 * HRMIS Profile Request Tabs Guard
 *
 * Includes separate validations on "Submit Request" click:
 *
 * 1) Employee Information tab validation
 * 2) Current Posting Status tab validation
 * 3) Previous Postings tab validation
 * 4) Qualification History tab validation
 * 5) Promotion History tab validation
 * 6) Leave History tab validation
 */

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

/* =========================================================
 * Shared helpers
 * =======================================================*/

function _showTab(tabSelector, paneSelector) {
  const tab = _qs(document, tabSelector);
  const pane = _qs(document, paneSelector);

  if (!tab || !pane) return false;

  try {
    if (window.bootstrap && window.bootstrap.Tab) {
      window.bootstrap.Tab.getOrCreateInstance(tab).show();
      return true;
    }
  } catch {
    // ignore
  }

  document.querySelectorAll(".hrmis-tabs--profile .hrmis-tab").forEach((t) => {
    t.classList.remove("active");
    t.classList.remove("is-active");
    t.setAttribute("aria-selected", "false");
  });

  tab.classList.add("active");
  tab.classList.add("is-active");
  tab.setAttribute("aria-selected", "true");

  document.querySelectorAll(".tab-content > .tab-pane").forEach((p) => {
    p.classList.remove("active");
    p.classList.remove("show");
  });

  pane.classList.add("active");
  pane.classList.add("show");

  return true;
}

function _markInvalid(el, borderKey, shadowKey) {
  if (!(el instanceof HTMLElement)) return;

  if (!el.dataset[borderKey]) {
    el.dataset[borderKey] = el.style.border || "";
  }
  if (!el.dataset[shadowKey]) {
    el.dataset[shadowKey] = el.style.boxShadow || "";
  }

  el.style.border = "1px solid #dc2626";
  el.style.boxShadow = "0 0 0 3px rgba(220, 38, 38, 0.12)";
  el.style.borderColor = "#dc2626";

  const wrap = el.closest(".hrmis-field");
  if (wrap instanceof HTMLElement) {
    if (!wrap.dataset.hrmisWrapOriginalBorder) {
      wrap.dataset.hrmisWrapOriginalBorder = wrap.style.border || "";
    }
    if (!wrap.dataset.hrmisWrapOriginalBorderRadius) {
      wrap.dataset.hrmisWrapOriginalBorderRadius = wrap.style.borderRadius || "";
    }
    if (!wrap.dataset.hrmisWrapOriginalPadding) {
      wrap.dataset.hrmisWrapOriginalPadding = wrap.style.padding || "";
    }
    if (!wrap.dataset.hrmisWrapOriginalBackground) {
      wrap.dataset.hrmisWrapOriginalBackground = wrap.style.background || "";
    }

    wrap.style.border = "1px solid #dc2626";
    wrap.style.borderRadius = "10px";
    wrap.style.padding = "6px";
    wrap.style.background = "#fff7f7";
  }

  window.setTimeout(() => {
    if (el instanceof HTMLElement) {
      el.style.border = el.dataset[borderKey] || "";
      el.style.boxShadow = el.dataset[shadowKey] || "";
      el.style.borderColor = "";
    }

    if (wrap instanceof HTMLElement) {
      wrap.style.border = wrap.dataset.hrmisWrapOriginalBorder || "";
      wrap.style.borderRadius = wrap.dataset.hrmisWrapOriginalBorderRadius || "";
      wrap.style.padding = wrap.dataset.hrmisWrapOriginalPadding || "";
      wrap.style.background = wrap.dataset.hrmisWrapOriginalBackground || "";
    }
  }, 5000);
}

function _clearInvalid(el, borderKey, shadowKey) {
  if (!(el instanceof HTMLElement)) return;

  el.style.border = el.dataset[borderKey] || "";
  el.style.boxShadow = el.dataset[shadowKey] || "";
  el.style.borderColor = "";

  const wrap = el.closest(".hrmis-field");
  if (wrap instanceof HTMLElement) {
    wrap.style.border = wrap.dataset.hrmisWrapOriginalBorder || "";
    wrap.style.borderRadius = wrap.dataset.hrmisWrapOriginalBorderRadius || "";
    wrap.style.padding = wrap.dataset.hrmisWrapOriginalPadding || "";
    wrap.style.background = wrap.dataset.hrmisWrapOriginalBackground || "";
  }
}

function _isEmpty(el) {
  if (!el) return true;

  if (el instanceof HTMLInputElement && el.type === "file") {
    return !el.files || el.files.length === 0;
  }

  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    return !el.checked;
  }

  return String(el.value || "").trim() === "";
}

/* =========================================================
 * Employee Information validation
 * =======================================================*/

function _removeEmployeeInfoErrorBox() {
  const oldBox = document.getElementById("hrmis_employee_info_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInEmployeeInfo(message) {
  const pane = _qs(document, "#hrmis_pr_employee_info");
  if (!pane) return;

  _removeEmployeeInfoErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_employee_info_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activateEmployeeInfoTab() {
  return _showTab("#hrmis_pr_tab_employee_info", "#hrmis_pr_employee_info");
}

function _markEmployeeInvalid(el) {
  _markInvalid(el, "hrmisOriginalBorder", "hrmisOriginalBoxShadow");
}

function _clearEmployeeInvalid(el) {
  _clearInvalid(el, "hrmisOriginalBorder", "hrmisOriginalBoxShadow");
}

function _getCadreText(form) {
  const select = _qs(form, 'select[name="hrmis_cadre"]');
  if (!select) return "";

  const value = (select.value || "").trim();
  if (!value) return "";

  if (value === "__other__") {
    const otherInput = _qs(form, 'input[name="hrmis_cadre_other_name"]');
    return ((otherInput && otherInput.value) || "").trim().toLowerCase();
  }

  const option = select.options[select.selectedIndex];
  const text = option ? option.text : "";
  return (text || "").trim().toLowerCase();
}

function _cadreNeedsPMDC(form) {
  const cadreText = _getCadreText(form);
  return (
    cadreText === "general" ||
    cadreText === "specialist" ||
    cadreText === "health management"
  );
}

function _validateEmployeeField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markEmployeeInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markEmployeeInvalid(el);
    return false;
  }

  _clearEmployeeInvalid(el);
  return true;
}

function _getEmployeeFieldsToValidate(form) {
  const fields = [];

  const cnic = _qs(form, 'input[name="hrmis_cnic"]');
  const fatherName = _qs(form, 'input[name="hrmis_father_name"]');
  const gender = _qs(form, 'select[name="gender"]');
  const dob = _qs(form, 'input[name="birthday"]');
  const domicile = _qs(form, 'select[name="hrmis_domicile"]');
  const commissionDate = _qs(form, 'input[name="hrmis_commission_date"]');
  const meritNumber = _qs(form, 'input[name="hrmis_merit_number"]');
  const joiningDate = _qs(form, 'input[name="hrmis_joining_date"]');
  const cadre = _qs(form, 'select[name="hrmis_cadre"]');
  const cadreOther = _qs(form, 'input[name="hrmis_cadre_other_name"]');
  const bps = _qs(form, 'input[name="hrmis_bps"]');
  const contactNo = _qs(form, 'input[name="hrmis_contact_info"]');
  const pmdcNo = _qs(form, 'input[name="hrmis_pmdc_no"]');
  const pmdcIssue = _qs(form, 'input[name="hrmis_pmdc_issue_date"]');
  const pmdcExpiry = _qs(form, 'input[name="hrmis_pmdc_expiry_date"]');
  const email = _qs(form, 'input[name="hrmis_email"]');
  const address = _qs(form, 'input[name="hrmis_address"]');
  const cnicFront = _qs(form, 'input[name="hrmis_cnic_front"]');
  const cnicBack = _qs(form, 'input[name="hrmis_cnic_back"]');

  fields.push(cnic);
  fields.push(fatherName);
  fields.push(gender);
  fields.push(dob);
  fields.push(domicile);
  fields.push(commissionDate);
  fields.push(meritNumber);
  fields.push(joiningDate);
  fields.push(cadre);

  if (cadre && cadre.value === "__other__") {
    fields.push(cadreOther);
  }

  fields.push(bps);
  fields.push(contactNo);

  if (_cadreNeedsPMDC(form)) {
    fields.push(pmdcNo);
    fields.push(pmdcIssue);
    fields.push(pmdcExpiry);
  }

  fields.push(email);
  fields.push(address);
  fields.push(cnicFront);
  fields.push(cnicBack);

  return fields.filter(Boolean);
}

function _findFirstInvalidEmployeeField(form) {
  const fields = _getEmployeeFieldsToValidate(form);

  for (const field of fields) {
    if (!_validateEmployeeField(field)) {
      return field;
    }
  }

  return null;
}

function _bindEmployeeClearOnInput(form) {
  const watched = [
    'input[name="hrmis_cnic"]',
    'input[name="hrmis_father_name"]',
    'select[name="gender"]',
    'input[name="birthday"]',
    'select[name="hrmis_domicile"]',
    'input[name="hrmis_commission_date"]',
    'input[name="hrmis_merit_number"]',
    'input[name="hrmis_joining_date"]',
    'select[name="hrmis_cadre"]',
    'input[name="hrmis_cadre_other_name"]',
    'input[name="hrmis_bps"]',
    'input[name="hrmis_contact_info"]',
    'input[name="hrmis_pmdc_no"]',
    'input[name="hrmis_pmdc_issue_date"]',
    'input[name="hrmis_pmdc_expiry_date"]',
    'input[name="hrmis_email"]',
    'input[name="hrmis_address"]',
    'input[name="hrmis_cnic_front"]',
    'input[name="hrmis_cnic_back"]',
  ];

  watched.forEach((sel) => {
    const el = _qs(form, sel);
    if (!el) return;
    if (el.dataset.hrmisClearBound === "1") return;
    el.dataset.hrmisClearBound = "1";

    const handler = () => {
      _clearEmployeeInvalid(el);
      _removeEmployeeInfoErrorBox();
    };

    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });
}

/* =========================================================
 * Current Posting validation
 * =======================================================*/

function _removeCurrentPostingErrorBox() {
  const oldBox = document.getElementById("hrmis_current_posting_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInCurrentPosting(message) {
  const pane = _qs(document, "#hrmis_pr_current_posting");
  if (!pane) return;

  _removeCurrentPostingErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_current_posting_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activateCurrentPostingTab() {
  return _showTab(
    "#hrmis_pr_tab_current_posting",
    "#hrmis_pr_current_posting",
  );
}

function _markCurrentPostingInvalid(el) {
  _markInvalid(el, "hrmisCpOriginalBorder", "hrmisCpOriginalBoxShadow");
}

function _clearCurrentPostingInvalid(el) {
  _clearInvalid(el, "hrmisCpOriginalBorder", "hrmisCpOriginalBoxShadow");
}

function _validateCurrentPostingField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markCurrentPostingInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markCurrentPostingInvalid(el);
    return false;
  }

  _clearCurrentPostingInvalid(el);
  return true;
}

function _getCurrentPostingStatus(form) {
  const statusEl = _qs(form, 'select[name="hrmis_current_status_frontend"]');
  return statusEl ? String(statusEl.value || "").trim() : "";
}

function _isAllowedToWorkChecked(form) {
  const checkbox =
    _qs(form, '#current_posting_box input[name="allowed_to_work"]') ||
    _qs(form, '#eol_box input[name="allowed_to_work"]') ||
    _qs(form, 'input[name="allowed_to_work"]');

  return !!(checkbox && checkbox.checked);
}

function _getCurrentPostingFieldsToValidate(form) {
  const fields = [];
  const status = _getCurrentPostingStatus(form);

  const statusEl = _qs(form, 'select[name="hrmis_current_status_frontend"]');
  fields.push(statusEl);

  if (!status) {
    return fields.filter(Boolean);
  }

  if (status === "currently_posted") {
    const currentPostingBox = _qs(form, "#current_posting_box");
    if (!currentPostingBox) {
      return fields.filter(Boolean);
    }

    const district = _qs(currentPostingBox, 'select[name="district_id"]');
    const facility = _qs(currentPostingBox, 'select[name="posting_facility_id"]');
    const designation = _qs(currentPostingBox, 'select[name="hrmis_designation"]');
    const startMonth = _qs(currentPostingBox, 'input[name="current_posting_start"]');

    fields.push(district, facility, designation, startMonth);

    if (_isAllowedToWorkChecked(form)) {
      const allowedBox = _qs(form, "#allowed_to_work_box");
      if (allowedBox) {
        const allowedDistrict = _qs(allowedBox, 'select[name="allowed_district_id"]');
        const allowedFacility = _qs(allowedBox, 'select[name="allowed_facility_id"]');
        const allowedDesignation = _qs(allowedBox, 'select[name="allowed_designation_id"]');
        const allowedStartMonth = _qs(allowedBox, 'input[name="allowed_start_month"]');

        fields.push(allowedDistrict, allowedFacility, allowedDesignation, allowedStartMonth);
      }
    }

    return fields.filter(Boolean);
  }

  if (status === "suspended") {
    const suspensionBox = _qs(form, "#suspension_box");
    if (!suspensionBox) {
      return fields.filter(Boolean);
    }

    const suspensionDate = _qs(
      suspensionBox,
      'input[name="frontend_suspension_date"]',
    );
    const designation = _qs(
      suspensionBox,
      'select[name="hrmis_designation"]',
    );
    const reportingTo = _qs(
      suspensionBox,
      'select[name="frontend_reporting_to"]',
    );

    fields.push(suspensionDate, designation);

    if (reportingTo && String(reportingTo.value || "").trim() === "facility") {
      const district = _qs(
        suspensionBox,
        'select[name="frontend_reporting_district_id"]',
      );
      const facility = _qs(
        suspensionBox,
        'select[name="frontend_reporting_facility_id"]',
      );

      fields.push(district, facility);
    }

    return fields.filter(Boolean);
  }

  if (status === "on_leave") {
    const onLeaveBox = _qs(form, "#on_leave_box");
    if (!onLeaveBox) {
      return fields.filter(Boolean);
    }

    const leaveType = _qs(
      onLeaveBox,
      'select[name="frontend_onleave_type"]',
    );
    const startDate = _qs(
      onLeaveBox,
      'input[name="frontend_onleave_start"]',
    );
    const endDate = _qs(
      onLeaveBox,
      'input[name="frontend_onleave_end"]',
    );
    const designation = _qs(
      onLeaveBox,
      'select[name="hrmis_designation"]',
    );
    const reportingTo = _qs(
      onLeaveBox,
      'select[name="frontend_onleave_reporting_to"]',
    );

    fields.push(leaveType, startDate, endDate, designation);

    if (reportingTo && String(reportingTo.value || "").trim() === "facility") {
      const district = _qs(
        onLeaveBox,
        'select[name="frontend_onleave_district_id"]',
      );
      const facility = _qs(
        onLeaveBox,
        'select[name="frontend_onleave_facility_id"]',
      );

      fields.push(district, facility);
    }

    return fields.filter(Boolean);
  }

  if (status === "eol_pgship") {
    const eolBox = _qs(form, "#eol_box");
    if (!eolBox) {
      return fields.filter(Boolean);
    }

    const degree = _qs(
      eolBox,
      'select[name="frontend_eol_degree"]',
    );
    const district = _qs(
      eolBox,
      'select[name="district_id"]',
    );
    const facility = _qs(
      eolBox,
      'select[name="facility_id"]',
    );
    const designation = _qs(
      eolBox,
      'select[name="hrmis_designation"]',
    );
    const startMonth = _qs(
      eolBox,
      'input[name="current_posting_start"]',
    );
    const status = _qs(
      eolBox,
      'input[name="frontend_eol_status"]',
    );

    

    fields.push(degree, district, facility, designation, startMonth, status);

    if (_isAllowedToWorkChecked(form)) {
      const allowedBox = _qs(form, "#allowed_to_work_box");
      if (allowedBox) {
        const allowedDistrict = _qs(allowedBox, 'select[name="allowed_district_id"]');
        const allowedFacility = _qs(allowedBox, 'select[name="allowed_facility_id"]');
        const allowedDesignation = _qs(allowedBox, 'select[name="allowed_designation_id"]');
        const allowedStartMonth = _qs(allowedBox, 'input[name="allowed_start_month"]');

        fields.push(allowedDistrict, allowedFacility, allowedDesignation, allowedStartMonth);
      }
    }

    return fields.filter(Boolean);
  }
  if (status === "deputation") {
    const deputationBox = _qs(form, "#deputation_box");
    if (!deputationBox) {
      return fields.filter(Boolean);
    }

    const district = _qs(
      deputationBox,
      'select[name="frontend_deputation_district_id"]',
    );
    const department = _qs(
      deputationBox,
      'input[name="frontend_deputation_department"]',
    );
    const designation = _qs(
      deputationBox,
      'input[name="frontend_deputation_designation"]',
    );
    const startMonth = _qs(
      deputationBox,
      'input[name="frontend_deputation_start"]',
    );

    fields.push(district, department, designation, startMonth);

    return fields.filter(Boolean);
  }

  if (status === "reported_to_health_department") {
    const reportedBox = _qs(form, "#reported_to_hd_box");
    if (!reportedBox) {
      return fields.filter(Boolean);
    }

    const designation = _qs(
      reportedBox,
      'select[name="hrmis_designation"]',
    );

    fields.push(designation);

    return fields.filter(Boolean);
  }

  return fields.filter(Boolean);
}

function _findFirstInvalidCurrentPostingField(form) {
  const fields = _getCurrentPostingFieldsToValidate(form);

  for (const field of fields) {
    if (!_validateCurrentPostingField(field)) {
      return field;
    }
  }

  return null;
}

function _bindCurrentPostingClearHandlers(form) {
  const selectors = [
    'select[name="hrmis_current_status_frontend"]',
    '#current_posting_box select[name="district_id"]',
    '#current_posting_box select[name="posting_facility_id"]',
    '#current_posting_box select[name="hrmis_designation"]',
    '#current_posting_box input[name="current_posting_start"]',
    '#deputation_box select[name="frontend_deputation_district_id"]',
    '#deputation_box input[name="frontend_deputation_department"]',
    '#deputation_box input[name="frontend_deputation_designation"]',
    '#deputation_box input[name="frontend_deputation_start"]',
    '#allowed_to_work_box select[name="allowed_district_id"]',
    '#allowed_to_work_box select[name="allowed_facility_id"]',
    '#allowed_to_work_box select[name="allowed_designation_id"]',
    '#allowed_to_work_box input[name="allowed_start_month"]',
    'input[name="allowed_to_work"]',
  ];

  selectors.forEach((sel) => {
    const elements = _qsa(form, sel);
    elements.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (el.dataset.hrmisCpClearBound === "1") return;
      el.dataset.hrmisCpClearBound = "1";

      const handler = () => {
        _clearCurrentPostingInvalid(el);
        _removeCurrentPostingErrorBox();
      };

      el.addEventListener("input", handler);
      el.addEventListener("change", handler);
    });
  });
}

/* =========================================================
 * Previous Postings validation
 * =======================================================*/

function _removePreviousPostingErrorBox() {
  const oldBox = document.getElementById("hrmis_previous_posting_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInPreviousPosting(message) {
  const pane = _qs(document, "#hrmis_pr_posting_history");
  if (!pane) return;

  _removePreviousPostingErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_previous_posting_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activatePreviousPostingTab() {
  return _showTab(
    "#hrmis_pr_tab_posting_history",
    "#hrmis_pr_posting_history",
  );
}

function _markPreviousPostingInvalid(el) {
  _markInvalid(el, "hrmisPpOriginalBorder", "hrmisPpOriginalBoxShadow");
}

function _clearPreviousPostingInvalid(el) {
  _clearInvalid(el, "hrmisPpOriginalBorder", "hrmisPpOriginalBoxShadow");
}

function _validatePreviousPostingField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markPreviousPostingInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markPreviousPostingInvalid(el);
    return false;
  }

  _clearPreviousPostingInvalid(el);
  return true;
}

function _getPreviousPostingRows(form) {
  return _qsa(form, '#prev_post_rows .hrmis-repeat-row[data-row="prev_post"]');
}

function _getPreviousPostingFieldsForRow(row) {
  const fields = [];

  const district = _qs(row, 'select[name="posting_district_id[]"]');
  const facility = _qs(row, 'select[name="posting_facility_id[]"]');
  const facilityOther = _qs(row, 'input[name="posting_facility_other_name[]"]');
  const bps = _qs(row, 'input[name="posting_bps[]"]');
  const designation = _qs(row, 'select[name="posting_designation_id[]"]');
  const designationOther = _qs(row, 'input[name="posting_designation_other_name[]"]');
  const start = _qs(row, 'input[name="posting_start[]"]');
  const end = _qs(row, 'input[name="posting_end[]"]');

  fields.push(district);
  fields.push(facility);

  if (facility && String(facility.value || "").trim() === "__other__") {
    fields.push(facilityOther);
  }

  fields.push(bps);
  fields.push(designation);

  if (designation && String(designation.value || "").trim() === "__other__") {
    fields.push(designationOther);
  }

  fields.push(start);
  fields.push(end);

  return fields.filter(Boolean);
}

function _findFirstInvalidPreviousPostingField(form) {
  const rows = _getPreviousPostingRows(form);

  for (const row of rows) {
    const fields = _getPreviousPostingFieldsForRow(row);

    for (const field of fields) {
      if (!_validatePreviousPostingField(field)) {
        return field;
      }
    }
  }

  return null;
}

function _bindPreviousPostingClearHandlers(form) {
  if (form.dataset.hrmisPrevPostingClearBound === "1") return;
  form.dataset.hrmisPrevPostingClearBound = "1";

  const handler = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('.hrmis-repeat-row[data-row="prev_post"]');
    if (!row) return;

    const isWatched =
      target.matches('select[name="posting_district_id[]"]') ||
      target.matches('select[name="posting_facility_id[]"]') ||
      target.matches('input[name="posting_facility_other_name[]"]') ||
      target.matches('input[name="posting_bps[]"]') ||
      target.matches('select[name="posting_designation_id[]"]') ||
      target.matches('input[name="posting_designation_other_name[]"]') ||
      target.matches('input[name="posting_start[]"]') ||
      target.matches('input[name="posting_end[]"]');

    if (!isWatched) return;

    _clearPreviousPostingInvalid(target);
    _removePreviousPostingErrorBox();
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

/* =========================================================
 * Qualification History validation
 * =======================================================*/

function _removeQualificationErrorBox() {
  const oldBox = document.getElementById("hrmis_qualification_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInQualification(message) {
  const pane = _qs(document, "#hrmis_pr_qualification_history");
  if (!pane) return;

  _removeQualificationErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_qualification_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activateQualificationTab() {
  return _showTab(
    "#hrmis_pr_tab_qualification",
    "#hrmis_pr_qualification_history",
  );
}

function _markQualificationInvalid(el) {
  _markInvalid(el, "hrmisQualOriginalBorder", "hrmisQualOriginalBoxShadow");
}

function _clearQualificationInvalid(el) {
  _clearInvalid(el, "hrmisQualOriginalBorder", "hrmisQualOriginalBoxShadow");
}

function _validateQualificationField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markQualificationInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markQualificationInvalid(el);
    return false;
  }

  _clearQualificationInvalid(el);
  return true;
}

function _getQualificationRows(form) {
  return _qsa(form, '#qual_rows .hrmis-repeat-row[data-row="qual"]');
}

function _getQualificationFieldsForRow(row) {
  const fields = [];

  const degree = _qs(row, 'select[name="qualification_degree[]"]');
  const degreeOther = _qs(row, 'input[name="qualification_degree_other[]"]');
  const start = _qs(row, 'input[name="qualification_start[]"]');

  fields.push(degree);

  if (degree && String(degree.value || "").trim() === "__other__") {
    fields.push(degreeOther);
  }

  fields.push(start);

  return fields.filter(Boolean);
}

function _findFirstInvalidQualificationField(form) {
  const rows = _getQualificationRows(form);

  for (const row of rows) {
    const fields = _getQualificationFieldsForRow(row);

    for (const field of fields) {
      if (!_validateQualificationField(field)) {
        return field;
      }
    }
  }

  return null;
}

function _bindQualificationClearHandlers(form) {
  if (form.dataset.hrmisQualificationClearBound === "1") return;
  form.dataset.hrmisQualificationClearBound = "1";

  const handler = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('.hrmis-repeat-row[data-row="qual"]');
    if (!row) return;

    const isWatched =
      target.matches('select[name="qualification_degree[]"]') ||
      target.matches('input[name="qualification_degree_other[]"]') ||
      target.matches('input[name="qualification_start[]"]');

    if (!isWatched) return;

    _clearQualificationInvalid(target);
    _removeQualificationErrorBox();
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

/* =========================================================
 * Promotion History validation
 * =======================================================*/

function _removePromotionErrorBox() {
  const oldBox = document.getElementById("hrmis_promotion_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInPromotion(message) {
  const pane = _qs(document, "#hrmis_pr_promotion_history");
  if (!pane) return;

  _removePromotionErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_promotion_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activatePromotionTab() {
  return _showTab(
    "#hrmis_pr_tab_promotion",
    "#hrmis_pr_promotion_history",
  );
}

function _markPromotionInvalid(el) {
  _markInvalid(el, "hrmisPromoOriginalBorder", "hrmisPromoOriginalBoxShadow");
}

function _clearPromotionInvalid(el) {
  _clearInvalid(el, "hrmisPromoOriginalBorder", "hrmisPromoOriginalBoxShadow");
}

function _validatePromotionField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markPromotionInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markPromotionInvalid(el);
    return false;
  }

  _clearPromotionInvalid(el);
  return true;
}

function _getPromotionRows(form) {
  return _qsa(form, '#promo_rows .hrmis-repeat-row[data-row="promo"]');
}

function _getPromotionFieldsForRow(row) {
  const fields = [];

  const bpsFrom = _qs(row, 'input[name="promotion_bps_from[]"]');
  const bpsTo = _qs(row, 'input[name="promotion_bps_to[]"]');
  const promoDate = _qs(row, 'input[name="promotion_date[]"]');

  fields.push(bpsFrom, bpsTo, promoDate);

  return fields.filter(Boolean);
}

function _findFirstInvalidPromotionField(form) {
  const rows = _getPromotionRows(form);

  for (const row of rows) {
    const fields = _getPromotionFieldsForRow(row);

    for (const field of fields) {
      if (!_validatePromotionField(field)) {
        return field;
      }
    }
  }

  return null;
}

function _bindPromotionClearHandlers(form) {
  if (form.dataset.hrmisPromotionClearBound === "1") return;
  form.dataset.hrmisPromotionClearBound = "1";

  const handler = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('.hrmis-repeat-row[data-row="promo"]');
    if (!row) return;

    const isWatched =
      target.matches('input[name="promotion_bps_from[]"]') ||
      target.matches('input[name="promotion_bps_to[]"]') ||
      target.matches('input[name="promotion_date[]"]');

    if (!isWatched) return;

    _clearPromotionInvalid(target);
    _removePromotionErrorBox();
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

/* =========================================================
 * Leave History validation
 * =======================================================*/

function _removeLeaveErrorBox() {
  const oldBox = document.getElementById("hrmis_leave_error_box");
  if (oldBox) oldBox.remove();
}

function _showErrorInLeave(message) {
  const pane = _qs(document, "#hrmis_pr_leave_history");
  if (!pane) return;

  _removeLeaveErrorBox();

  const box = document.createElement("div");
  box.id = "hrmis_leave_error_box";
  box.className = "alert alert-danger";
  box.style.margin = "0 0 12px 0";
  box.style.borderRadius = "10px";
  box.style.padding = "10px 12px";
  box.style.fontWeight = "600";
  box.textContent = message;

  const panelBody =
    _qs(pane, ".px-3.pt-1.pb-1") ||
    _qs(pane, ".hrmis-panel") ||
    pane;

  panelBody.prepend(box);
}

function _activateLeaveTab() {
  return _showTab(
    "#hrmis_pr_tab_leave",
    "#hrmis_pr_leave_history",
  );
}

function _markLeaveInvalid(el) {
  _markInvalid(el, "hrmisLeaveOriginalBorder", "hrmisLeaveOriginalBoxShadow");
}

function _clearLeaveInvalid(el) {
  _clearInvalid(el, "hrmisLeaveOriginalBorder", "hrmisLeaveOriginalBoxShadow");
}

function _validateLeaveField(el) {
  if (!el) return true;

  if (_isEmpty(el)) {
    _markLeaveInvalid(el);
    return false;
  }

  if (typeof el.checkValidity === "function" && !el.checkValidity()) {
    _markLeaveInvalid(el);
    return false;
  }

  _clearLeaveInvalid(el);
  return true;
}

function _getLeaveRows(form) {
  return _qsa(form, '#leave_rows .hrmis-repeat-row[data-row="leave"]');
}

function _getLeaveFieldsForRow(row) {
  const fields = [];

  const leaveType = _qs(row, 'select[name="leave_type_id[]"]');
  const leaveStart = _qs(row, 'input[name="leave_start[]"]');
  const leaveEnd = _qs(row, 'input[name="leave_end[]"]');

  fields.push(leaveType, leaveStart, leaveEnd);

  return fields.filter(Boolean);
}

function _findFirstInvalidLeaveField(form) {
  const rows = _getLeaveRows(form);

  for (const row of rows) {
    const fields = _getLeaveFieldsForRow(row);

    for (const field of fields) {
      if (!_validateLeaveField(field)) {
        return field;
      }
    }
  }

  return null;
}

function _bindLeaveClearHandlers(form) {
  if (form.dataset.hrmisLeaveClearBound === "1") return;
  form.dataset.hrmisLeaveClearBound = "1";

  const handler = (ev) => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    const row = target.closest('.hrmis-repeat-row[data-row="leave"]');
    if (!row) return;

    const isWatched =
      target.matches('select[name="leave_type_id[]"]') ||
      target.matches('input[name="leave_start[]"]') ||
      target.matches('input[name="leave_end[]"]');

    if (!isWatched) return;

    _clearLeaveInvalid(target);
    _removeLeaveErrorBox();
  };

  form.addEventListener("input", handler);
  form.addEventListener("change", handler);
}

/* =========================================================
 * Main bind
 * =======================================================*/

function _bind() {
  const form = _qs(document, "#profile_update_form");
  const btn = _qs(document, "#btn_open_confirm_modal");
  if (!form || !btn) return;

  if (btn.dataset.hrmisFullGuardBound === "1") return;
  btn.dataset.hrmisFullGuardBound = "1";

  _bindEmployeeClearOnInput(form);
  _bindCurrentPostingClearHandlers(form);
  _bindPreviousPostingClearHandlers(form);
  _bindQualificationClearHandlers(form);
  _bindPromotionClearHandlers(form);
  _bindLeaveClearHandlers(form);

  btn.addEventListener(
    "click",
    (ev) => {
      _removeEmployeeInfoErrorBox();
      _removeCurrentPostingErrorBox();
      _removePreviousPostingErrorBox();
      _removeQualificationErrorBox();
      _removePromotionErrorBox();
      _removeLeaveErrorBox();

      const firstInvalidEmployee = _findFirstInvalidEmployeeField(form);
      if (firstInvalidEmployee) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activateEmployeeInfoTab();
        _showErrorInEmployeeInfo("Please fill the required fields with correct validations.");

        try {
          firstInvalidEmployee.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidEmployee.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }

      const firstInvalidCurrentPosting =
        _findFirstInvalidCurrentPostingField(form);

      if (firstInvalidCurrentPosting) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activateCurrentPostingTab();
        _showErrorInCurrentPosting("Please fill the required fields.");

        try {
          firstInvalidCurrentPosting.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidCurrentPosting.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }

      const firstInvalidPreviousPosting =
        _findFirstInvalidPreviousPostingField(form);

      if (firstInvalidPreviousPosting) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activatePreviousPostingTab();
        _showErrorInPreviousPosting("Please fill the required fields.");

        try {
          firstInvalidPreviousPosting.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidPreviousPosting.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }

      const firstInvalidQualification =
        _findFirstInvalidQualificationField(form);

      if (firstInvalidQualification) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activateQualificationTab();
        _showErrorInQualification("Please fill the required fields.");

        try {
          firstInvalidQualification.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidQualification.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }

      const firstInvalidPromotion =
        _findFirstInvalidPromotionField(form);

      if (firstInvalidPromotion) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activatePromotionTab();
        _showErrorInPromotion("Please fill the required fields.");

        try {
          firstInvalidPromotion.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidPromotion.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }

      const firstInvalidLeave =
        _findFirstInvalidLeaveField(form);

      if (firstInvalidLeave) {
        ev.preventDefault();
        ev.stopImmediatePropagation();

        _activateLeaveTab();
        _showErrorInLeave("Please fill the required fields.");

        try {
          firstInvalidLeave.focus();
        } catch {
          // ignore
        }

        try {
          firstInvalidLeave.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } catch {
          // ignore
        }

        return;
      }
    },
    true,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bind);
} else {
  _bind();
}

window.addEventListener("pageshow", _bind);