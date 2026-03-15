/** @odoo-module **/

/**
 * HRMIS Current Posting Status Reset
 *
 * Purpose:
 * - When CURRENT STATUS changes, reset fields from all non-selected status boxes
 * - Supports:
 *   - Currently Posted
 *   - Suspended
 *   - On Leave
 *   - EOL (PGship)
 *   - Reported to Health Department
 *   - Allowed To Work box
 *
 * Behavior:
 * - On status change:
 *   - hide all supported status boxes
 *   - reset all fields inside the non-selected boxes
 *   - reset allowed-to-work box as well when leaving statuses that use it
 *   - show the selected box
 *
 * Reset means:
 * - empty text/date/month/number/etc. inputs
 * - uncheck checkboxes/radios
 * - reset selects to placeholder/default
 * - hide "Other" input wrappers and clear their values
 * - hide conditional wrappers like district/facility/end-date/allowed-to-work
 */

function _qs(root, sel) {
  return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
  return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _resetSelect(select) {
  if (!(select instanceof HTMLSelectElement)) return;

  const placeholder =
    Array.from(select.options).find((opt) => opt.value === "") ||
    Array.from(select.options).find((opt) => opt.hidden) ||
    Array.from(select.options).find((opt) => opt.disabled);

  if (placeholder) {
    select.selectedIndex = placeholder.index;
  } else {
    select.selectedIndex = 0;
  }

  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function _resetField(field) {
  if (!(field instanceof HTMLElement)) return;

  if (field instanceof HTMLInputElement) {
    const type = (field.type || "").toLowerCase();

    if (type === "checkbox" || type === "radio") {
      field.checked = false;
    } else {
      field.value = "";
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  if (field instanceof HTMLSelectElement) {
    _resetSelect(field);
    return;
  }

  if (field instanceof HTMLTextAreaElement) {
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function _hideElement(el) {
  if (el instanceof HTMLElement) {
    el.style.display = "none";
  }
}

function _showElement(el) {
  if (el instanceof HTMLElement) {
    el.style.display = "";
  }
}

function _resetOtherWraps(container) {
  _qsa(container, ".js-other-wrap").forEach((wrap) => {
    wrap.style.display = "none";

    _qsa(wrap, "input, select, textarea").forEach((field) => {
      _resetField(field);
      field.disabled = true;
    });
  });
}

function _resetConditionalWraps(container) {
  [
    "#frontend_reporting_district_wrap",
    "#frontend_reporting_facility_wrap",
    "#frontend_onleave_district_wrap",
    "#frontend_onleave_facility_wrap",
    "#frontend_eol_end_wrap",
  ].forEach((sel) => {
    const el = _qs(container, sel);
    if (el) el.style.display = "none";
  });
}

function _resetStatusBox(box) {
  if (!(box instanceof HTMLElement)) return;

  _qsa(box, "input, select, textarea").forEach((field) => {
    _resetField(field);
  });

  _resetOtherWraps(box);
  _resetConditionalWraps(box);
}

function _resetAllowedToWork() {
  const allowedBox = _qs(document, "#allowed_to_work_box");
  if (!allowedBox) return;

  _qsa(allowedBox, "input, select, textarea").forEach((field) => {
    _resetField(field);
  });

  _resetOtherWraps(allowedBox);
  _hideElement(allowedBox);

  // IMPORTANT:
  // uncheck toggles WITHOUT dispatching change again,
  // otherwise it creates a recursive loop.
  _qsa(document, ".js-allowed-to-work-toggle").forEach((checkbox) => {
    if (checkbox instanceof HTMLInputElement) {
      checkbox.checked = false;
    }
  });
}

function _bindAllowedToWorkToggle() {
  const toggles = _qsa(document, ".js-allowed-to-work-toggle");
  if (!toggles.length) return;

  toggles.forEach((toggle) => {
    if (!(toggle instanceof HTMLInputElement)) return;
    if (toggle.dataset.hrmisAllowedToggleBound === "1") return;

    toggle.dataset.hrmisAllowedToggleBound = "1";

    toggle.addEventListener("change", () => {
      const targetSel = toggle.dataset.target || "#allowed_to_work_box";
      const target = _qs(document, targetSel);
      if (!target) return;

      if (toggle.checked) {
        _showElement(target);
      } else {
        // only reset the target box directly, no recursive event firing
        _qsa(target, "input, select, textarea").forEach((field) => {
          _resetField(field);
        });
        _resetOtherWraps(target);
        _hideElement(target);
      }
    });
  });
}

function _bind() {
  const form = _qs(document, "#profile_update_form");
  if (form && form.classList.contains("is-submitted")) {
    return;
  }

  const statusSelect = _qs(
    document,
    'select[name="hrmis_current_status_frontend"]',
  );
  if (!statusSelect) return;

  _bindAllowedToWorkToggle();

  if (statusSelect.dataset.hrmisStatusResetBound === "1") return;
  statusSelect.dataset.hrmisStatusResetBound = "1";

  const statusBoxes = {
    currently_posted: _qs(document, "#current_posting_box"),
    deputation: _qs(document, "#deputation_box"),
    suspended: _qs(document, "#suspension_box"),
    deputation: _qs(document, "#deputation_box"),
    on_leave: _qs(document, "#on_leave_box"),
    eol_pgship: _qs(document, "#eol_box"),
    reported_to_health_department: _qs(document, "#reported_to_hd_box"),
  };

  const statusesUsingAllowedToWork = new Set([
    "currently_posted",
    "eol_pgship",
  ]);

  const supportedStatuses = Object.keys(statusBoxes);

  const handleStatusChange = () => {
    const selectedStatus = statusSelect.value || "";

    supportedStatuses.forEach((status) => {
      const box = statusBoxes[status];
      if (!box) return;

      if (status === selectedStatus) {
        _showElement(box);
      } else {
        _resetStatusBox(box);
        _hideElement(box);
      }
    });

    if (!statusesUsingAllowedToWork.has(selectedStatus)) {
      _resetAllowedToWork();
    } else {
      const allowedBox = _qs(document, "#allowed_to_work_box");
      const activeToggle = _qsa(document, ".js-allowed-to-work-toggle").find(
        (cb) => cb instanceof HTMLInputElement && cb.checked,
      );

      if (allowedBox) {
        if (activeToggle) {
          _showElement(allowedBox);
        } else {
          _hideElement(allowedBox);
        }
      }
    }
  };

  statusSelect.addEventListener("change", handleStatusChange);
  handleStatusChange();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", _bind);
} else {
  _bind();
}

window.addEventListener("pageshow", _bind);