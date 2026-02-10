/** @odoo-module **/

// HRMIS: Confirmation modal (NO bootstrap dependency)
// - Opens modal on "Submit Request" click
// - Builds summary table from current form values
// - On confirm, submits the form
// - Odoo-style init pattern like your filter script

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _getSelectedText(selectEl) {
  if (!selectEl) return "";
  const opt = selectEl.options[selectEl.selectedIndex];
  return opt ? (opt.textContent || "").trim() : "";
}

function _addRow(tbody, label, value) {
  const safeValue =
    value === null || value === undefined || value === "" ? "-" : value;
  const tr = document.createElement("tr");
  tr.innerHTML = `
        <th style="width: 35%;">${label}</th>
        <td>${String(safeValue)}</td>
    `;
  tbody.appendChild(tr);
}

function _buildSummary(form, tbody) {
  tbody.innerHTML = "";

  const employeeId = _qs(
    form,
    'input[name="hrmis_employee_id"]',
  )?.value?.trim();
  const cnic = _qs(form, 'input[name="hrmis_cnic"]')?.value?.trim();
  const father = _qs(form, 'input[name="hrmis_father_name"]')?.value?.trim();
  const birthday = _qs(form, 'input[name="birthday"]')?.value?.trim();
  const commission = _qs(
    form,
    'input[name="hrmis_commission_date"]',
  )?.value?.trim();
  const joining = _qs(form, 'input[name="hrmis_joining_date"]')?.value?.trim();
  const bps = _qs(form, 'input[name="hrmis_bps"]')?.value?.trim();
  const leaves = _qs(form, 'input[name="hrmis_leaves_taken"]')?.value?.trim();
  const contact = _qs(form, 'input[name="hrmis_contact_info"]')?.value?.trim();

  const genderSel = _qs(form, 'select[name="gender"]');
  const districtSel = _qs(form, 'select[name="district_id"]');
  const facilitySel = _qs(form, 'select[name="facility_id"]');
  const cadreSel = _qs(form, 'select[name="hrmis_cadre"]');
  const designationSel = _qs(form, 'select[name="hrmis_designation"]');

  _addRow(tbody, "Employee ID / Service No", employeeId);
  _addRow(tbody, "CNIC", cnic);
  _addRow(tbody, "Father Name", father);
  _addRow(tbody, "Gender", _getSelectedText(genderSel));
  _addRow(tbody, "Date of Birth", birthday);
  _addRow(tbody, "Commission Date", commission);
  _addRow(tbody, "Joining Date", joining);
  _addRow(tbody, "District", _getSelectedText(districtSel));
  _addRow(tbody, "Facility", _getSelectedText(facilitySel));
  _addRow(tbody, "BPS", bps);
  _addRow(tbody, "Cadre", _getSelectedText(cadreSel));
  _addRow(tbody, "Designation", _getSelectedText(designationSel));
  _addRow(tbody, "Total Leaves Taken", leaves);
  _addRow(tbody, "Contact Number", contact);
}

function _showModal(modalEl) {
  // Create backdrop
  let backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop fade show";
  backdrop.dataset.hrmisBackdrop = "1";

  // Show modal (bootstrap-like)
  modalEl.style.display = "block";
  modalEl.classList.add("show");
  modalEl.removeAttribute("aria-hidden");
  modalEl.setAttribute("aria-modal", "true");
  modalEl.setAttribute("role", "dialog");
  document.body.classList.add("modal-open");
  document.body.appendChild(backdrop);

  console.log("[HRMIS ConfirmModal] modal shown");
}

function _hideModal(modalEl) {
  modalEl.classList.remove("show");
  modalEl.style.display = "none";
  modalEl.setAttribute("aria-hidden", "true");
  modalEl.removeAttribute("aria-modal");

  document.body.classList.remove("modal-open");

  // Remove backdrop
  const backdrop = document.querySelector(
    'div.modal-backdrop[data-hrmis-backdrop], div.modal-backdrop[data-hrmisBackdrop="1"]',
  );
  if (backdrop) backdrop.remove();

  console.log("[HRMIS ConfirmModal] modal hidden");
}

function _initConfirmModal() {
  console.log("[HRMIS ConfirmModal] init start");

  // IMPORTANT: don’t run on other pages (like login)
  const panel = _qs(document, ".hrmis-panel");
  if (!panel) {
    console.log(
      "[HRMIS ConfirmModal] .hrmis-panel not found; skipping on this page",
    );
    return;
  }

  const form = _qs(document, "#profile_update_form");
  const openBtn = _qs(document, "#btn_open_confirm_modal");
  const confirmBtn = _qs(document, "#btn_confirm_submit");
  const modalEl = _qs(document, "#confirmSubmitModal");
  const tbody = _qs(document, "#confirm_table_body");

  console.log("[HRMIS ConfirmModal] elements:", {
    form: !!form,
    openBtn: !!openBtn,
    confirmBtn: !!confirmBtn,
    modalEl: !!modalEl,
    tbody: !!tbody,
  });

  if (!form || !openBtn || !confirmBtn || !modalEl || !tbody) {
    console.warn(
      "[HRMIS ConfirmModal] missing required DOM elements; check IDs in template.",
    );
    return;
  }

  // Prevent rebinding on pageshow
  if (openBtn.dataset.hrmiscfmBound === "1") {
    console.log("[HRMIS ConfirmModal] already bound; skipping");
    return;
  }
  openBtn.dataset.hrmiscfmBound = "1";

  // Close buttons inside modal (btn-close, [data-bs-dismiss], etc.)
  const closeBtn = modalEl.querySelector(".btn-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => _hideModal(modalEl));
  }
  modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach((el) => {
    el.addEventListener("click", () => _hideModal(modalEl));
  });

  // Click backdrop area to close (optional)
  modalEl.addEventListener("click", (ev) => {
    if (ev.target === modalEl) {
      _hideModal(modalEl);
    }
  });

  openBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("[HRMIS ConfirmModal] openBtn clicked");

    if (!form.reportValidity()) {
      console.warn("[HRMIS ConfirmModal] form validation failed");
      return;
    }

    _buildSummary(form, tbody);
    _showModal(modalEl);
  });

  confirmBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("[HRMIS ConfirmModal] confirm clicked -> submitting");
    confirmBtn.disabled = true;
    form.submit();
  });

  console.log("[HRMIS ConfirmModal] init complete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initConfirmModal);
} else {
  _initConfirmModal();
}

window.addEventListener("pageshow", _initConfirmModal);
