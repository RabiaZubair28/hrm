/** @odoo-module **/

// HRMIS: Confirmation modal (NO bootstrap dependency)
// - Opens modal on "Submit Request" click
// - Builds summary table from current form values
// - On confirm, submits the form
// - Includes dynamic "Current Status" box fields (Suspended / EOL / On Leave / etc.)
// - Shows Allowed To Work details from #allowed_to_work_box when checked
// - Odoo-friendly logs for debugging

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _visualControlTarget(control) {
  if (control && control.tagName === "SELECT" && control._hrmisComboboxInput)
    return control._hrmisComboboxInput;
  return control;
}

function _showInlineError(control, message) {
  const target = _visualControlTarget(control);
  if (!target) return;

  let error = target.parentElement?.querySelector?.(".hrmis-error");
  if (!error) {
    error = document.createElement("div");
    error.className = "hrmis-error";
    target.parentElement?.appendChild(error);
  }

  error.textContent = message || "Please review this field.";
  target.classList.add("has-error");
  target.style.borderColor = "#dc3545";

  if (target !== control && control) control.classList.add("has-error");
}

function _normalizeValidationText(message) {
  const text = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";
  if (/^please fill out this field\.?$/i.test(text))
    return "This field is required.";
  return text;
}

function _submitSummaryRefs(form) {
  return {
    summary:
      _qs(form, "#profile_submit_error_summary") ||
      _qs(document, "#profile_submit_error_summary"),
    list:
      _qs(form, "#profile_submit_error_list") ||
      _qs(document, "#profile_submit_error_list"),
  };
}

function _clearSubmitSummary(form) {
  const { summary, list } = _submitSummaryRefs(form);
  if (list) list.innerHTML = "";
  if (summary) summary.style.display = "none";
}

function _findSectionTab(paneId) {
  if (!paneId) return null;

  const direct = _qsa(document, ".hrmis-pr-tab").find((tab) => {
    return (
      (tab.getAttribute("href") || "").trim() === `#${paneId}` ||
      (tab.getAttribute("aria-controls") || "").trim() === paneId
    );
  });
  if (direct) return direct;

  try {
    if (window.CSS && CSS.escape) {
      const escaped = CSS.escape(paneId);
      return (
        _qs(document, `.hrmis-pr-tab[href="#${escaped}"]`) ||
        _qs(document, `.hrmis-pr-tab[aria-controls="${escaped}"]`)
      );
    }
  } catch (e) {
    console.warn("[HRMIS ConfirmModal] failed to locate tab", e);
  }

  return null;
}

function _fieldSection(control) {
  const pane = control?.closest?.(".tab-pane[id], .hrmis-section[id]");
  const tab = _findSectionTab(pane?.id || "");
  return ((tab && tab.textContent) || "").replace(/\s+/g, " ").trim();
}

function _fieldLabel(control) {
  const field = control?.closest?.(".hrmis-field");
  const labelText = ((field && _qs(field, "label")?.textContent) || "")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (labelText) return labelText;

  const target = _visualControlTarget(control) || control;
  const aria = (target?.getAttribute?.("aria-label") || "").trim();
  if (aria) return aria;

  const placeholder = (target?.getAttribute?.("placeholder") || "").trim();
  if (placeholder) return placeholder;

  return (control?.name || target?.name || "This field").trim();
}

function _isHiddenStatusControl(control) {
  const box = control?.closest?.(".js-status-box");
  if (!box) return false;

  const style = window.getComputedStyle(box);
  return box.hidden || style.display === "none" || style.visibility === "hidden";
}

function _isRelevantIssueControl(control) {
  if (!control || !control.matches?.("input, select, textarea")) return false;
  if (control.disabled) return false;
  if (_isHiddenStatusControl(control)) return false;
  return true;
}

function _controlErrorMessage(control) {
  const target = _visualControlTarget(control) || control;
  const inlineText = target?.parentElement
    ?.querySelector?.(".hrmis-error")
    ?.textContent?.trim();
  if (inlineText) return _normalizeValidationText(inlineText);

  const validity = control?.validity;
  if (validity) {
    if (validity.valueMissing) return "This field is required.";
    if (validity.typeMismatch) return "Please enter a valid value.";
    if (validity.patternMismatch) {
      return (
        _normalizeValidationText(control.getAttribute("title")) ||
        "Please match the required format."
      );
    }
  }

  return (
    _normalizeValidationText(control?.validationMessage) ||
    "Please review this field."
  );
}

function _collectValidationIssues(form) {
  const issues = [];
  const seen = new Set();

  function addIssue(control, message) {
    if (!_isRelevantIssueControl(control)) return;

    const label = _fieldLabel(control);
    const section = _fieldSection(control);
    const normalizedMessage = _normalizeValidationText(
      message || _controlErrorMessage(control),
    );
    if (!normalizedMessage) return;

    const key = [section, label, normalizedMessage].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ section, label, message: normalizedMessage });
  }

  Array.from(form.elements || []).forEach((control) => {
    if (!_isRelevantIssueControl(control)) return;
    if (typeof control.checkValidity !== "function") return;

    if (!control.checkValidity()) {
      addIssue(control);
      _showInlineError(control, _controlErrorMessage(control));
    }
  });

  _qsa(form, "input.has-error, select.has-error, textarea.has-error").forEach(
    (control) => {
      addIssue(control);
    },
  );

  return issues;
}

function _renderSubmitSummary(form) {
  const { summary, list } = _submitSummaryRefs(form);
  if (!summary || !list) return [];

  const issues = _collectValidationIssues(form);
  if (!issues.length) {
    _clearSubmitSummary(form);
    return issues;
  }

  list.innerHTML = "";

  issues.slice(0, 8).forEach((issue) => {
    const li = document.createElement("li");
    const prefix = issue.section ? `${issue.section}: ` : "";
    li.textContent = `${prefix}${issue.label} — ${issue.message}`;
    list.appendChild(li);
  });

  if (issues.length > 8) {
    const extra = document.createElement("li");
    extra.textContent = `And ${issues.length - 8} more field(s).`;
    list.appendChild(extra);
  }

  summary.style.display = "";
  summary.scrollIntoView({ behavior: "smooth", block: "start" });
  return issues;
}

function _scheduleSubmitSummary(form) {
  if (!form || form._hrmisSubmitSummaryQueued) return;
  form._hrmisSubmitSummaryQueued = true;

  requestAnimationFrame(() => {
    form._hrmisSubmitSummaryQueued = false;
    _renderSubmitSummary(form);
  });
}

function _getSelectedText(selectEl) {
  if (!selectEl) return "";

  const idx = selectEl.selectedIndex;
  const opt = idx >= 0 ? selectEl.options[idx] : null;
  if (!opt) return "";

  const val = (opt.value || "").trim();
  const txt = (opt.textContent || "").trim();

  // If placeholder option (value empty), treat as empty
  if (!val) return "";

  // Extra guard: if someone sets value but still looks like placeholder
  const lower = txt.toLowerCase();
  if (lower.startsWith("select ")) return "";

  return txt;
}

function _escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function _addRow(tbody, label, value) {
  const safeValue =
    value === null || value === undefined || value === "" ? "-" : value;

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <th style="width: 35%;">${_escapeHtml(label)}</th>
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
          ${_escapeHtml(String(f.name || "image"))}
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

// ------------------------------
// Dynamic status-box field collector
// ------------------------------

function _getFieldLabel(fieldEl) {
  const lbl = _qs(fieldEl, "label");
  if (lbl && (lbl.textContent || "").trim()) return (lbl.textContent || "").trim();

  const ctl = _qs(fieldEl, "input, select, textarea");
  if (ctl) {
    const aria = (ctl.getAttribute("aria-label") || "").trim();
    if (aria) return aria;
    const ph = (ctl.getAttribute("placeholder") || "").trim();
    if (ph) return ph;
    const nm = (ctl.getAttribute("name") || "").trim();
    if (nm) return nm;
  }
  return "Field";
}
function _readOtherTextForSelect(selectEl, fieldEl) {
  if (!selectEl) return "";

  const v = (selectEl.value || "").trim();
  if (v !== "__other__") return "";

  // 1) Preferred: data-other-name tells us the input name
  const otherName = (selectEl.getAttribute("data-other-name") || "").trim();
  if (otherName) {
    const otherInputByName =
      _qs(fieldEl, `input[name="${CSS && CSS.escape ? CSS.escape(otherName) : otherName}"]`) ||
      _qs(fieldEl, `textarea[name="${CSS && CSS.escape ? CSS.escape(otherName) : otherName}"]`);
    const val1 = (otherInputByName && (otherInputByName.value || "").trim()) || "";
    if (val1) return val1;
  }

  // 2) Fallback: common pattern in your XML
  const otherInput = _qs(fieldEl, ".js-other-input");
  const val2 = (otherInput && (otherInput.value || "").trim()) || "";
  if (val2) return val2;

  return "Other (not specified)";
}
function _getControlValue(controlEl, fieldEl) {
  if (!controlEl) return "";

  const tag = (controlEl.tagName || "").toLowerCase();
  const type = (controlEl.getAttribute("type") || "").toLowerCase();

  if (tag === "select") {
    // ✅ if Other selected, show typed other value
    const otherVal = _readOtherTextForSelect(controlEl, fieldEl);
    if (otherVal) return otherVal;

    return _getSelectedText(controlEl);
  }

  if (tag === "textarea") return (controlEl.value || "").trim();

  if (tag === "input") {
    if (type === "checkbox") return _fmtCheckbox(controlEl);
    if (type === "radio") return controlEl.checked ? "Yes" : "No";
    if (type === "file") return _fileName(controlEl) || "-";
    return (controlEl.value || "").trim();
  }

  return (controlEl.value || "").trim();
}
function _isSearchHelperInput(el) {
  if (!el) return false;

  // common injected search inputs (select2-like, custom "type to search" etc.)
  const ph = (el.getAttribute("placeholder") || "").toLowerCase();
  if (ph.includes("type to search")) return true;

  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "search") return true;

  const cls = (el.className || "").toLowerCase();
  if (cls.includes("select2-search") || cls.includes("o_searchview") || cls.includes("js-search")) return true;

  // if it has no name and looks like helper input, skip it
  const name = (el.getAttribute("name") || "").trim();
  if (!name && (ph || type === "search")) return true;

  return false;
}

function _looksLikePlaceholderValue(val) {
  const v = (val || "").trim().toLowerCase();
  if (!v) return true;
  if (v.startsWith("select ")) return true; // "Select District", "Select Facility"
  return false;
}

function _collectLabeledFields(containerEl, { includeEmpty = false } = {}) {
  const fields = _qsa(containerEl, ".hrmis-field");
  const pairs = [];

  fields.forEach((fieldEl) => {
    // pick first meaningful control
    const ctl =
      _qs(fieldEl, "select") ||
      _qs(fieldEl, "textarea") ||
      _qs(fieldEl, 'input:not([type="hidden"])');

    if (!ctl) return;

    // ✅ skip injected search helper inputs
    if (_isSearchHelperInput(ctl)) return;

    // Some widgets may inject the search input *inside* same hrmis-field,
    // so also skip if any "type to search" input exists and ctl is not named
    if (!ctl.getAttribute("name") && _qsa(fieldEl, 'input[placeholder*="Type to search"]').length) {
      return;
    }

    const label = _getFieldLabel(fieldEl);
    let val = _getControlValue(ctl, fieldEl);

    // ✅ Convert "Select X" (or empty) into empty so it becomes "-"
    if (typeof val === "string" && _looksLikePlaceholderValue(val)) {
      val = "";
    }

    const isEmpty = !val || String(val).trim() === "-" || String(val).trim() === "";
    if (!includeEmpty && isEmpty) return;

    pairs.push(`${_escapeHtml(label)}: ${_escapeHtml(val || "-")}`);
  });

  return pairs;
}

function _findStatusSelect(form) {
  return (
    _qs(form, 'select[name="hrmis_current_status_frontend"]') ||
    _qs(form, "#hrmis_current_status_frontend") ||
    _qs(form, 'select[name="status"]') ||
    _qs(form, 'select[name="current_status"]') ||
    _qs(form, 'select[name="hrmis_current_status"]')
  );
}

function _findActiveStatusBox(form, statusKey) {
  if (!statusKey) return null;

  try {
    const esc = window.CSS && CSS.escape ? CSS.escape(statusKey) : statusKey.replace(/"/g, '\\"');
    const byData = _qs(form, `.js-status-box[data-status="${esc}"]`);
    if (byData) return byData;
  } catch (e) {
    console.warn("[HRMIS ConfirmModal] CSS.escape failed; fallback", e);
  }

  const byId1 = _qs(form, `#${statusKey}_box`);
  if (byId1) return byId1;

  const visible = _qsa(form, ".js-status-box").find((el) => {
    const st = window.getComputedStyle(el);
    return st && st.display !== "none" && st.visibility !== "hidden" && st.opacity !== "0";
  });
  return visible || null;
}

function _buildSummary(form, tbody) {
  console.log("[HRMIS ConfirmModal] building summary...");
  tbody.innerHTML = "";

  // ============ Employee Information ============
  const employeeId = _qs(form, 'input[name="hrmis_employee_id"]')?.value?.trim();
  const cnic = _qs(form, 'input[name="hrmis_cnic"]')?.value?.trim();
  const father = _qs(form, 'input[name="hrmis_father_name"]')?.value?.trim();
  const birthday = _qs(form, 'input[name="birthday"]')?.value?.trim();
  const commission = _qs(form, 'input[name="hrmis_commission_date"]')?.value?.trim();
  const merit = _qs(form, 'input[name="hrmis_merit_number"]')?.value?.trim();
  const joining = _qs(form, 'input[name="hrmis_joining_date"]')?.value?.trim();
  const leavesTaken = _qs(form, 'input[name="hrmis_leaves_taken"]')?.value?.trim();
  const contact = _qs(form, 'input[name="hrmis_contact_info"]')?.value?.trim();

  const pmdcNo = _qs(form, 'input[name="hrmis_pmdc_no"]')?.value?.trim();
  const pmdcIssue = _qs(form, 'input[name="hrmis_pmdc_issue_date"]')?.value?.trim();
  const pmdcExpiry = _qs(form, 'input[name="hrmis_pmdc_expiry_date"]')?.value?.trim();
  const email = _qs(form, 'input[name="hrmis_email"]')?.value?.trim();
  const address = _qs(form, 'input[name="hrmis_address"]')?.value?.trim();
  const postalCode = _qs(form, 'input[name="hrmis_postal_code"]')?.value?.trim();

  const genderSel = _qs(form, 'select[name="gender"]');
  const domicileSel = _qs(form, 'select[name="hrmis_domicile"]');
  const cadreSel = _qs(form, 'select[name="hrmis_cadre"]');

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

  _addRow(tbody, "PMDC No.", pmdcNo);
  _addRow(tbody, "PMDC Issue Date", _fmtDate(pmdcIssue));
  _addRow(tbody, "PMDC Expiry Date", _fmtDate(pmdcExpiry));
  _addRow(tbody, "Email", email);
  _addRow(tbody, "Address", address);
  _addRow(tbody, "Postal Code", postalCode);

  if (cnicFrontName || cnicBackName) {
    _addRow(tbody, "CNIC Front Preview", _imgPreviewHtml(cnicFrontInput) || "-");
    _addRow(tbody, "CNIC Back Preview", _imgPreviewHtml(cnicBackInput) || "-");
  }

  // ============ Posting Status (ONLY once; no duplicate "Substantive Posting — ..." rows) ============
  const statusSel = _findStatusSelect(form);
  const statusKey = (statusSel?.value || "").trim();
  const statusTxt = _getSelectedText(statusSel) || "-";

  _addRow(tbody, "Posting Status", statusTxt);

  const activeBox = _findActiveStatusBox(form, statusKey);
  if (activeBox) {
    console.log("[HRMIS ConfirmModal] active status box found", {
      statusKey,
      boxId: activeBox.id,
      dataStatus: activeBox.dataset.status,
    });

    const boxPairs = _collectLabeledFields(activeBox);
    _addRow(tbody, "Posting Status Details", boxPairs.length ? _ul(boxPairs) : "-");
  } else {
    console.log("[HRMIS ConfirmModal] no active status box found", { statusKey });
    _addRow(tbody, "Posting Status Details", "-");
  }

  // ============ Allowed To Work Details ============
  // Your checkbox lives inside current_posting_box; detail fields live in #allowed_to_work_box
  const allowedChk = _qs(form, 'input[name="allowed_to_work"]');
  const allowedYes = allowedChk && allowedChk.checked;

  if (allowedYes) {
    const allowedBox = _qs(form, "#allowed_to_work_box");
    if (allowedBox) {
      // Even if hidden (display:none), we can still read values
      const allowedPairs = _collectLabeledFields(allowedBox);
      console.log("[HRMIS ConfirmModal] allowed_to_work checked; details collected", {
        count: allowedPairs.length,
      });
      _addRow(
        tbody,
        "Allowed To Work Details",
        allowedPairs.length ? _ul(allowedPairs) : "-"
      );
    } else {
      console.warn("[HRMIS ConfirmModal] allowed_to_work_box not found in DOM");
      _addRow(tbody, "Allowed To Work Details", "-");
    }
  }

  // ============ Qualification History (multiple) ============
  const qualWrap = _qs(document, "#qual_rows");
  const qualItems = _collectRows(
    qualWrap,
    '.hrmis-repeat-row[data-row="qual"]',
    (row, idx) => {
      const degSel = _qs(row, 'select[name="qualification_degree[]"]');
      const degOther = _qs(row, 'input[name="qualification_degree_other[]"]');

      const specInput = _qs(row, 'input[name="qualification_specialization[]"]');
      const specSel = _qs(row, 'select[name="qualification_specialization[]"]');
      const specOther = _qs(row, 'input[name="qualification_specialization_other[]"]');

      const start = _qs(row, 'input[name="qualification_start[]"]')?.value?.trim();
      const end = _qs(row, 'input[name="qualification_end[]"]')?.value?.trim();

      const completedChk = _qs(row, 'input[name="qualification_completed[]"]');
      const statusSel2 = _qs(row, 'select[name="qualification_status[]"]');
      const completedByStatus =
        (statusSel2 && (statusSel2.value || "").trim() === "completed") || false;
      const isCompleted = (completedChk && completedChk.checked) || completedByStatus;

      const degOtherVal = _getOtherIfSelected(degSel, degOther, "__other__");
      const degTxt = degOtherVal ? `Other: ${degOtherVal}` : (_getSelectedText(degSel) || "-");

      let specTxt = "";
      if (specInput) {
        specTxt = (specInput.value || "").trim();
      } else if (specSel) {
        const specOtherVal = _getOtherIfSelected(specSel, specOther, "__other__");
        specTxt = specOtherVal ? `Other: ${specOtherVal}` : (_getSelectedText(specSel) || "");
      }

      const specPart = specTxt ? ` — ${_escapeHtml(specTxt)}` : "";
      const statusTxt2 = isCompleted ? "Complete" : "Ongoing";
      const rangeTxt = isCompleted
        ? `${_fmtMonth(start)} → ${_fmtMonth(end)}`
        : `${_fmtMonth(start)} → (ongoing)`;

      return `<b>#${idx + 1}</b> ${_escapeHtml(degTxt)}${specPart} <span style="color:#666;">(${statusTxt2}, ${_escapeHtml(rangeTxt)})</span>`;
    }
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
      const desOther = _qs(row, 'input[name="posting_designation_other_name[]"]');

      const st = _qs(row, 'input[name="posting_start[]"]')?.value?.trim();
      const en = _qs(row, 'input[name="posting_end[]"]')?.value?.trim();

      const facOther = _getOtherIfSelected(fSel, fOther, "__other__");
      const facTxt = facOther
        ? `Other: ${_escapeHtml(facOther)}`
        : _escapeHtml(_getSelectedText(fSel) || "-");

      const desOtherVal = _getOtherIfSelected(desSel, desOther, "__other__");
      const desTxt = desOtherVal
        ? `Other: ${_escapeHtml(desOtherVal)}`
        : _escapeHtml(_getSelectedText(desSel) || "-");

      const parts = [
        `<b>#${idx + 1}</b>`,
        _escapeHtml(_getSelectedText(dSel) || "-"),
        facTxt || "-",
        `BPS: ${_escapeHtml(bpsV || "-")}`,
        desTxt || "-",
        `${_escapeHtml(_fmtMonth(st))} → ${_escapeHtml(_fmtMonth(en))}`,
      ];

      return parts.join(" — ");
    }
  );
  _addRow(tbody, "Previous Posting History", _ul(prevItems));

  // ============ Promotion History (multiple) ============
  const promoWrap = _qs(document, "#promo_rows");
  const promoItems = _collectRows(
    promoWrap,
    '.hrmis-repeat-row[data-row="promo"]',
    (row, idx) => {
      const from = _qs(row, 'input[name="promotion_bps_from[]"]')?.value?.trim();
      const to = _qs(row, 'input[name="promotion_bps_to[]"]')?.value?.trim();
      const dt = _qs(row, 'input[name="promotion_date[]"]')?.value?.trim();

      return `<b>#${idx + 1}</b> BPS ${_escapeHtml(from || "-")} → ${_escapeHtml(to || "-")} <span style="color:#666;">(Date: ${_escapeHtml(_fmtMonth(dt))})</span>`;
    }
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
      return `<b>#${idx + 1}</b> ${_escapeHtml(tTxt)} <span style="color:#666;">(${_escapeHtml(_fmtDate(st))} → ${_escapeHtml(_fmtDate(en))})</span>`;
    }
  );
  _addRow(tbody, "Leave History", _ul(leaveItems));

  _addRow(tbody, "Total Leaves Taken Since Joining (Days)", leavesTaken);

  console.log("[HRMIS ConfirmModal] summary ready");
}

function _showModal(modalEl) {
  let backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop fade show";
  backdrop.dataset.hrmisBackdrop = "1";

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

  const backdrop = document.querySelector(
    'div.modal-backdrop[data-hrmis-backdrop], div.modal-backdrop[data-hrmisBackdrop="1"]'
  );
  if (backdrop) backdrop.remove();
}

function _initConfirmModal() {
  const panel = _qs(document, ".hrmis-panel");
  if (!panel) {
    console.log("[HRMIS ConfirmModal] .hrmis-panel not found; skipping on this page");
    return;
  }

  const form = _qs(document, "#profile_update_form");
  const openBtn = _qs(document, "#btn_open_confirm_modal");
  const confirmBtn = _qs(document, "#btn_confirm_submit");
  const modalEl = _qs(document, "#confirmSubmitModal");
  const tbody = _qs(document, "#confirm_table_body");

  if (!form || !openBtn || !confirmBtn || !modalEl || !tbody) {
    console.warn("[HRMIS ConfirmModal] missing required DOM elements; check IDs in template.", {
      form: !!form,
      openBtn: !!openBtn,
      confirmBtn: !!confirmBtn,
      modalEl: !!modalEl,
      tbody: !!tbody,
    });
    return;
  }

  if (openBtn.dataset.hrmiscfmBound === "1") {
    console.log("[HRMIS ConfirmModal] already bound; skipping rebind");
    return;
  }
  openBtn.dataset.hrmiscfmBound = "1";

  console.log("[HRMIS ConfirmModal] init bound", {
    formId: form.id,
    modalId: modalEl.id,
  });

  const closeBtn = modalEl.querySelector(".btn-close");
  if (closeBtn) closeBtn.addEventListener("click", () => _hideModal(modalEl));

  modalEl.querySelectorAll('[data-bs-dismiss="modal"]').forEach((el) => {
    el.addEventListener("click", () => _hideModal(modalEl));
  });

  modalEl.addEventListener("click", (ev) => {
    if (ev.target === modalEl) _hideModal(modalEl);
  });

  form.addEventListener(
    "invalid",
    () => {
      _scheduleSubmitSummary(form);
    },
    true,
  );

  form.addEventListener("submit", (ev) => {
    if (ev.defaultPrevented) {
      _scheduleSubmitSummary(form);
      return;
    }

    _clearSubmitSummary(form);
  });

  const clearIfResolved = () => {
    requestAnimationFrame(() => {
      if (!_collectValidationIssues(form).length) _clearSubmitSummary(form);
    });
  };

  form.addEventListener("input", clearIfResolved, true);
  form.addEventListener("change", clearIfResolved, true);

  openBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("[HRMIS ConfirmModal] open clicked");

    _clearSubmitSummary(form);

    const customOk =
      typeof form._hrmisRunSubmitValidation === "function"
        ? form._hrmisRunSubmitValidation()
        : true;
    const nativeOk = form.checkValidity();

    if (!customOk || !nativeOk) {
      console.warn("[HRMIS ConfirmModal] form validation failed");
      _scheduleSubmitSummary(form);
      return;
    }

    _buildSummary(form, tbody);
    _showModal(modalEl);
  });

  confirmBtn.addEventListener("click", (ev) => {
    ev.preventDefault();
    console.log("[HRMIS ConfirmModal] confirm clicked -> submitting form");
    _hideModal(modalEl);
    confirmBtn.disabled = true;

    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();

    window.setTimeout(() => {
      confirmBtn.disabled = false;
    }, 1200);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _initConfirmModal);
} else {
  _initConfirmModal();
}

window.addEventListener("pageshow", _initConfirmModal);