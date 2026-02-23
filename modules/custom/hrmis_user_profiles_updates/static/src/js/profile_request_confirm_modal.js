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

function _fmtMonth(v) {
  return (v || "").trim() || "-";
}

function _fmtDate(v) {
  return (v || "").trim() || "-";
}

function _fmtCheckbox(chk) {
  return chk && chk.checked ? "Yes" : "No";
}

function _fileName(inputEl) {
  if (!inputEl || !inputEl.files || !inputEl.files.length) return "";
  return inputEl.files[0]?.name || "";
}
function _imgPreviewHtml(inputEl) {
  if (!inputEl || !inputEl.files || !inputEl.files.length) return "";
  const f = inputEl.files[0];
  if (!f || !f.type || !f.type.startsWith("image/")) return "";

  const url = URL.createObjectURL(f);

  return `
    <div style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
      <div style="border:1px solid #ddd; border-radius:8px; padding:6px; background:#fff;">
        <img
          src="${url}"
          alt="Selected image"
          style="max-width:220px; max-height:160px; border-radius:6px; display:block;"
        />
        <div style="font-size:12px; color:#666; margin-top:6px;">
          ${String(f.name || "image")}
        </div>
      </div>
    </div>
  `;
}

function _ul(items) {
  if (!items || !items.length) return "-";
  const li = items
    .filter((x) => x && String(x).trim())
    .map((x) => `<li style="margin:2px 0;">${String(x)}</li>`)
    .join("");
  return `<ul class="mb-0" style="padding-left:18px; margin:0;">${li}</ul>`;
}

function _getOtherIfSelected(selectEl, otherInputEl, otherToken) {
  const v = (selectEl && selectEl.value) || "";
  if (!v) return "";
  if (String(v) === String(otherToken)) {
    return (
      (otherInputEl && (otherInputEl.value || "").trim()) ||
      "Other (not specified)"
    );
  }
  return "";
}

function _collectRows(root, rowSelector, buildLineFn) {
  const rows = Array.from(root ? root.querySelectorAll(rowSelector) : []);
  if (!rows.length) return [];
  const out = [];
  rows.forEach((row, idx) => {
    try {
      const line = buildLineFn(row, idx);
      if (line && String(line).trim()) out.push(line);
    } catch (e) {
      console.warn("[HRMIS ConfirmModal] row parse failed", { idx, e });
    }
  });
  return out;
}

function _buildSummary(form, tbody) {
  tbody.innerHTML = "";

  // ============ Employee Information ============
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
  const merit = _qs(form, 'input[name="hrmis_merit_number"]')?.value?.trim();
  const joining = _qs(form, 'input[name="hrmis_joining_date"]')?.value?.trim();
  const bps = _qs(form, 'input[name="hrmis_bps"]')?.value?.trim();
  const leavesTaken = _qs(
    form,
    'input[name="hrmis_leaves_taken"]',
  )?.value?.trim();
  const contact = _qs(form, 'input[name="hrmis_contact_info"]')?.value?.trim();

  const genderSel = _qs(form, 'select[name="gender"]');
  const domicileSel = _qs(form, 'select[name="hrmis_domicile"]');

  const cadreSel = _qs(form, 'select[name="hrmis_cadre"]');

  // CNIC file uploads
  const cnicFrontInput = _qs(form, 'input[name="hrmis_cnic_front"]');
  const cnicBackInput = _qs(form, 'input[name="hrmis_cnic_back"]');
  const cnicFrontName = _fileName(cnicFrontInput);
  const cnicBackName = _fileName(cnicBackInput);

  _addRow(tbody, "Personal No", employeeId);
  _addRow(tbody, "CNIC", cnic);
  _addRow(tbody, "Father Name", father);
  _addRow(tbody, "Gender", _getSelectedText(genderSel));
  _addRow(tbody, "Date of Birth", birthday);
  _addRow(tbody, "Domicile", _getSelectedText(domicileSel));
  _addRow(tbody, "Commission Year", commission);
  _addRow(tbody, "Merit Number", merit);
  _addRow(tbody, "Joining Date", joining);
  _addRow(tbody, "Cadre", _getSelectedText(cadreSel));
  _addRow(tbody, "Contact Number", contact);

  // Show file names + previews if selected
  if (cnicFrontName || cnicBackName) {
    _addRow(
      tbody,
      "CNIC Front Preview",
      _imgPreviewHtml(cnicFrontInput) || "-",
    );

    _addRow(tbody, "CNIC Back Preview", _imgPreviewHtml(cnicBackInput) || "-");
  }

  // ============ Current Posting ============
  const districtSel = _qs(form, 'select[name="district_id"]');
  const facilitySel = _qs(form, 'select[name="facility_id"]');
  const facilityOtherInput = _qs(form, 'input[name="facility_other_name"]');
  const designationSel = _qs(form, 'select[name="hrmis_designation"]');
  const currentPostingStart = _qs(
    form,
    'input[name="current_posting_start"]',
  )?.value?.trim();

  const facilityOtherVal = _getOtherIfSelected(
    facilitySel,
    facilityOtherInput,
    "__other__",
  );

  _addRow(tbody, "Current Posting — District", _getSelectedText(districtSel));
  _addRow(
    tbody,
    "Current Posting — Facility",
    facilityOtherVal
      ? `Other: ${facilityOtherVal}`
      : _getSelectedText(facilitySel),
  );
  _addRow(tbody, "Current Posting — BPS", bps);
  _addRow(
    tbody,
    "Current Posting — Designation",
    _getSelectedText(designationSel),
  );
  _addRow(
    tbody,
    "Current Posting — Start (MM-YYYY)",
    _fmtMonth(currentPostingStart),
  );

  // ============ Qualification History (multiple) ============
  const qualWrap = _qs(document, "#qual_rows");
  const qualItems = _collectRows(
    qualWrap,
    '.hrmis-repeat-row[data-row="qual"]',
    (row, idx) => {
      const degSel = _qs(row, 'select[name="qualification_degree[]"]');
      const spec = _qs(
        row,
        'input[name="qualification_specialization[]"]',
      )?.value?.trim();
      const start = _qs(
        row,
        'input[name="qualification_start[]"]',
      )?.value?.trim();
      const statusSel = _qs(row, 'select[name="qualification_status[]"]');
      const end = _qs(row, 'input[name="qualification_end[]"]')?.value?.trim();

      const degTxt = _getSelectedText(degSel) || "-";
      const specTxt = spec ? ` — ${spec}` : "";
      const status = (statusSel?.value || "").trim() || "ongoing";
      const isCompleted = status === "completed";
      const statusTxt = isCompleted ? "Complete" : "Ongoing";
      const rangeTxt = isCompleted
        ? `${_fmtMonth(start)} → ${_fmtMonth(end)}`
        : `${_fmtMonth(start)} → (ongoing)`;

      return `<b>#${idx + 1}</b> ${degTxt}${specTxt} <span style="color:#666;">(${statusTxt}, ${rangeTxt})</span>`;
    },
  );
  _addRow(tbody, "Qualification History", _ul(qualItems));

  // ============ Previous Posting History (multiple) ============
  const prevWrap = _qs(document, "#prev_post_rows");
  const prevItems = _collectRows(
    prevWrap,
    '.hrmis-repeat-row[data-row="prev_post"]',
    (row, idx) => {
      const dSel = _qs(row, 'select[name="posting_district_id[]"]');
      const fSel = _qs(row, 'select[name="posting_facility_id[]"]');
      const fOther = _qs(row, 'input[name="posting_facility_other_name[]"]');
      const bpsV = _qs(row, 'input[name="posting_bps[]"]')?.value?.trim();
      const desSel = _qs(row, 'select[name="posting_designation_id[]"]');
      const st = _qs(row, 'input[name="posting_start[]"]')?.value?.trim();
      const en = _qs(row, 'input[name="posting_end[]"]')?.value?.trim();

      const facOther = _getOtherIfSelected(fSel, fOther, "__other__");
      const facTxt = facOther ? `Other: ${facOther}` : _getSelectedText(fSel);

      const parts = [
        `<b>#${idx + 1}</b>`,
        _getSelectedText(dSel) || "-",
        facTxt || "-",
        `BPS: ${bpsV || "-"}`,
        _getSelectedText(desSel) || "-",
        `${_fmtMonth(st)} → ${_fmtMonth(en)}`,
      ];

      return parts.join(" — ");
    },
  );
  _addRow(tbody, "Previous Posting History", _ul(prevItems));

  // ============ Promotion History (multiple) ============
  const promoWrap = _qs(document, "#promo_rows");
  const promoItems = _collectRows(
    promoWrap,
    '.hrmis-repeat-row[data-row="promo"]',
    (row, idx) => {
      const from = _qs(
        row,
        'input[name="promotion_bps_from[]"]',
      )?.value?.trim();
      const to = _qs(row, 'input[name="promotion_bps_to[]"]')?.value?.trim();
      const dt = _qs(row, 'input[name="promotion_date[]"]')?.value?.trim();

      return `<b>#${idx + 1}</b> BPS ${from || "-"} → ${to || "-"} <span style="color:#666;">(Date: ${_fmtMonth(dt)})</span>`;
    },
  );
  _addRow(tbody, "Promotion History", _ul(promoItems));

  // ============ Leave History (multiple) ============
  const leaveWrap = _qs(document, "#leave_rows");
  const leaveItems = _collectRows(
    leaveWrap,
    '.hrmis-repeat-row[data-row="leave"]',
    (row, idx) => {
      const tSel = _qs(row, 'select[name="leave_type_id[]"]');
      const st = _qs(row, 'input[name="leave_start[]"]')?.value?.trim();
      const en = _qs(row, 'input[name="leave_end[]"]')?.value?.trim();

      const tTxt = _getSelectedText(tSel) || "-";
      return `<b>#${idx + 1}</b> ${tTxt} <span style="color:#666;">(${_fmtDate(st)} → ${_fmtDate(en)})</span>`;
    },
  );
  _addRow(tbody, "Leave History", _ul(leaveItems));

  // Total leaves taken (auto-calculated field you already had)
  _addRow(tbody, "Total Leaves Taken Since Joining (Days)", leavesTaken);
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
}

function _initConfirmModal() {
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

  if (!form || !openBtn || !confirmBtn || !modalEl || !tbody) {
    console.warn(
      "[HRMIS ConfirmModal] missing required DOM elements; check IDs in template.",
    );
    return;
  }

  // Prevent rebinding on pageshow
  if (openBtn.dataset.hrmiscfmBound === "1") {
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

    if (!form.reportValidity()) {
      console.warn("[HRMIS ConfirmModal] form validation failed");
      return;
    }

    _buildSummary(form, tbody);
    _showModal(modalEl);
  });

  confirmBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    confirmBtn.disabled = true;
    form.submit();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initConfirmModal);
} else {
  _initConfirmModal();
}

window.addEventListener("pageshow", _initConfirmModal);
