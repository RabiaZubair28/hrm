/** @odoo-module **/

// HRMIS:
// Reported to Health Department
// Make designation dropdown options unique only

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _norm(v) {
  return (v || "").toString().trim();
}

function _makeReportedToHdDesignationUnique() {
  console.group("[HRMIS][REPORTED_HD] Unique designation init");

  const form = _qs(document, "#profile_update_form") || document;
  const box = _qs(form, "#reported_to_hd_box");

  if (!box) {
    console.warn("[HRMIS][REPORTED_HD] #reported_to_hd_box not found");
    console.groupEnd();
    return;
  }

  const select = _qs(box, 'select[name="hrmis_designation"]');
  if (!select) {
    console.warn("[HRMIS][REPORTED_HD] designation select not found");
    console.groupEnd();
    return;
  }

  if (select.dataset.hrmisUniqueDone === "1") {
    console.info("[HRMIS][REPORTED_HD] uniqueness already applied");
    console.groupEnd();
    return;
  }

  const selectedValue = _norm(select.value);
  const seen = new Set();
  const toRemove = [];

  Array.from(select.options).forEach((opt, idx) => {
    const value = _norm(opt.value);
    const text = _norm(opt.textContent);

    // keep placeholder and Other always
    if (idx === 0 || value === "__other__" || value === "") {
      return;
    }

    // uniqueness by designation text
    const key = text.toLowerCase();

    if (seen.has(key)) {
      toRemove.push(opt);
      console.log("[HRMIS][REPORTED_HD] removing duplicate option:", {
        value,
        text,
      });
    } else {
      seen.add(key);
    }
  });

  toRemove.forEach((opt) => opt.remove());

  // restore selection if still present
  if (selectedValue) {
    select.value = selectedValue;
  }

  if (typeof select._hrmisRefreshCombobox === "function") {
    select._hrmisRefreshCombobox();
  }

  select.dataset.hrmisUniqueDone = "1";

  console.log("[HRMIS][REPORTED_HD] unique designation applied", {
    removedCount: toRemove.length,
    finalCount: select.options.length,
  });

  console.groupEnd();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _makeReportedToHdDesignationUnique);
} else {
  _makeReportedToHdDesignationUnique();
}

window.addEventListener("pageshow", _makeReportedToHdDesignationUnique);