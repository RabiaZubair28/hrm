/** @odoo-module **/

// HRMIS: Searchable Combobox (Bootstrap 5-ish UI)
// - Enhances any <select class="js-search-combobox"> into a searchable dropdown
// - Keeps original <select> in DOM (hidden) so form submit still works
// - Supports: search typing, click select, keyboard nav (↑ ↓ Enter Esc), optional clear button
// - OPTIONAL: auto-submit form when selection changes
//
// Usage in QWeb:
// <form id="tvFiltersForm" method="get">...</form>
//
// <select class="form-select js-search-combobox"
//         name="district_id"
//         data-placeholder="Search district..."
//         data-allow-clear="1"
//         data-auto-submit="1"
//         data-submit-form="#tvFiltersForm">
//   <option value="">All Districts</option>
//   ...
// </select>

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
    return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s == null ? "" : String(s);
    return div.innerHTML;
}

function _setStyle(el, cssText) {
    if (!el) return;
    el.style.cssText += ";" + cssText;
}

function _getFormForSelect(selectEl) {
    // Allow explicit selector OR fallback to closest form
    const formSel = (selectEl.dataset.submitForm || "").trim();
    if (formSel) {
        return _qs(document, formSel);
    }
    return selectEl.closest("form");
}

function _autoSubmitIfEnabled(selectEl) {
    const enabled = (selectEl.dataset.autoSubmit || "0") === "1";
    if (!enabled) return;

    const form = _getFormForSelect(selectEl);
    if (!form) return;

    // Debounce + prevent submit storms
    if (form.dataset.scbSubmitting === "1") return;
    form.dataset.scbSubmitting = "1";

    // Small timeout to let DOM/state settle (also avoids double triggers)
    window.setTimeout(() => {
        try {
            form.submit();
        } finally {
            // Release lock in case browser blocks submit or validation stops it
            window.setTimeout(() => {
                form.dataset.scbSubmitting = "0";
            }, 500);
        }
    }, 0);
}

function _buildCombobox(selectEl) {
    // Prevent double init
    if (!selectEl || selectEl.dataset.scbInit === "1") return;
    selectEl.dataset.scbInit = "1";

    // Read config from data-*
    const placeholder = selectEl.dataset.placeholder || "Select...";
    const allowClear = (selectEl.dataset.allowClear || "1") === "1";

    // Collect options from select
    const rawOptions = _qsa(selectEl, "option").map((o, i) => {
        const value = o.value;
        const label = (o.textContent || "").trim();
        const disabled = !!o.disabled;
        const isPlaceholder = value === "" && i === 0;
        return { value, label, disabled, isPlaceholder };
    });

    // Hide original select (keep for submit)
    selectEl.classList.add("d-none");

    // Wrapper
    const wrapper = document.createElement("div");
    wrapper.className = "scb position-relative";

    // Input group (Bootstrap 5)
    const inputGroup = document.createElement("div");
    inputGroup.className = "input-group input-group-sm";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "form-control scb-input";
    input.placeholder = placeholder;
    input.autocomplete = "off";
    input.setAttribute("aria-label", placeholder);

    // Optional clear button
    let clearBtn = null;
    if (allowClear) {
        const clearWrap = document.createElement("span");
        clearWrap.className = "input-group-text p-0";

        clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.className = "btn btn-sm btn-outline-secondary border-0 rounded-0 scb-clear";
        clearBtn.style.width = "38px";
        clearBtn.textContent = "×";
        clearBtn.setAttribute("aria-label", "Clear");

        clearWrap.appendChild(clearBtn);
        inputGroup.appendChild(clearWrap);
    }

    // Toggle button
    const toggleWrap = document.createElement("span");
    toggleWrap.className = "input-group-text p-0";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn btn-sm btn-outline-secondary border-0 rounded-0 scb-toggle";
    toggleBtn.style.width = "38px";
    toggleBtn.textContent = "▾";
    toggleBtn.setAttribute("aria-label", "Toggle");

    toggleWrap.appendChild(toggleBtn);

    inputGroup.appendChild(input);
    inputGroup.appendChild(toggleWrap);

    // Menu (Bootstrap dropdown-menu style)
    const menu = document.createElement("div");
    menu.className = "dropdown-menu w-100 scb-menu";

    // Important: ensure visibility & stacking
    _setStyle(menu, "max-height:240px; overflow-y:auto; z-index: 1051;");
    _setStyle(wrapper, "display:block;");
    _setStyle(menu, "position:absolute; left:0; right:0; top:100%;");

    wrapper.appendChild(inputGroup);
    wrapper.appendChild(menu);

    // Insert combobox right after select
    selectEl.parentNode.insertBefore(wrapper, selectEl.nextSibling);

    // State
    let isOpen = false;
    let filtered = rawOptions.slice();
    let activeIndex = -1;

    function _selectedLabel() {
        const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
        return opt ? (opt.textContent || "").trim() : "";
    }

    function _selectedValue() {
        return selectEl.value || "";
    }

    function _syncFromSelect() {
        // If placeholder selected (value empty), keep input blank
        if (clearBtn) {
            const hasValue = !!(selectEl.value || "");
            clearBtn.style.display = hasValue ? "" : "none";
        }

        const v = _selectedValue();
        input.value = v ? _selectedLabel() : "";
    }

    function _renderMenu() {
        const html = filtered.map((o, idx) => {
            const classes = ["dropdown-item", "scb-item"];
            if (o.disabled) classes.push("disabled");

            const labelHtml = o.isPlaceholder
                ? `<span class="text-muted">${_escapeHtml(o.label || "Select...")}</span>`
                : _escapeHtml(o.label);

            return `
                <button type="button"
                    class="${classes.join(" ")}"
                    data-scb-value="${_escapeHtml(o.value)}"
                    data-scb-idx="${idx}"
                    aria-disabled="${o.disabled ? "true" : "false"}"
                >${labelHtml}</button>
            `;
        }).join("");

        menu.innerHTML = html || `<div class="px-3 py-2 text-muted small">No results</div>`;
        _updateActiveUI(false);
    }

    function _open() {
        if (isOpen) return;
        isOpen = true;
        menu.classList.add("show");
    }

    function _close() {
        if (!isOpen) return;
        isOpen = false;
        menu.classList.remove("show");
        activeIndex = -1;
        _updateActiveUI(false);
    }

    function _filter(q) {
        const query = (q || "").toLowerCase();
        filtered = rawOptions.filter((o) => {
            if (o.isPlaceholder) return query === "";
            return o.label.toLowerCase().includes(query);
        });
        activeIndex = -1;
        _renderMenu();
    }

    function _updateActiveUI(scrollIntoView) {
        const items = _qsa(menu, ".scb-item");
        items.forEach((el) => el.classList.remove("active"));

        if (activeIndex >= 0) {
            const active = _qs(menu, `[data-scb-idx="${activeIndex}"]`);
            if (active) {
                active.classList.add("active");
                if (scrollIntoView) {
                    active.scrollIntoView({ block: "nearest" });
                }
            }
        }
    }

    function _moveActive(delta) {
        if (!filtered.length) return;

        let next = activeIndex;
        for (let i = 0; i < filtered.length + 1; i++) {
            next = next + delta;
            if (next < 0) next = filtered.length - 1;
            if (next >= filtered.length) next = 0;

            const opt = filtered[next];
            if (opt && !opt.disabled) {
                activeIndex = next;
                break;
            }
        }
        _updateActiveUI(true);
    }

    function _setSelectValue(value) {
        // Only fire if actual change (prevents double submit)
        const oldVal = selectEl.value || "";
        const newVal = value || "";
        if (oldVal === newVal) {
            _syncFromSelect();
            return;
        }

        selectEl.value = newVal;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        _syncFromSelect();

        // ✅ Auto submit (if enabled)
        _autoSubmitIfEnabled(selectEl);
    }

    function _selectActive() {
        if (activeIndex < 0) return;
        const opt = filtered[activeIndex];
        if (!opt || opt.disabled) return;
        _setSelectValue(opt.value);
        _close();
    }

    // Initial render + sync
    _renderMenu();
    _syncFromSelect();
    _close();

    // -----------------------
    // Event bindings
    // -----------------------

    // Click outside closes
    document.addEventListener("click", (e) => {
        if (!wrapper.contains(e.target)) {
            _close();
        }
    });

    // Toggle open/close
    toggleBtn.addEventListener("click", () => {
        isOpen ? _close() : _open();
        input.focus();
    });

    // Clear selection
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            input.value = "";
            _filter("");
            _setSelectValue("");
            _close();
        });
    }

    // Typing filters + opens dropdown
    input.addEventListener("input", () => {
        _filter((input.value || "").trim());
        _open();
    });

    // Keyboard navigation
    input.addEventListener("keydown", (e) => {
        if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            _open();
        }
        if (!isOpen) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            _moveActive(1);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            _moveActive(-1);
        } else if (e.key === "Enter") {
            e.preventDefault();
            _selectActive();
        } else if (e.key === "Escape") {
            e.preventDefault();
            _close();
        }
    });

    // Click menu item
    menu.addEventListener("click", (e) => {
        const item = e.target.closest("[data-scb-value]");
        if (!item) return;
        if (item.getAttribute("aria-disabled") === "true") return;

        const value = item.getAttribute("data-scb-value");
        _setSelectValue(value);
        _close();
    });

    // If someone changes select directly, keep UI in sync
    selectEl.addEventListener("change", () => {
        _syncFromSelect();
        // Optional: if you want native select changes to submit too:
        // _autoSubmitIfEnabled(selectEl);
    });

    selectEl._scb = {
    refresh: function () {
        // Re-read select options + rebuild menu
        rawOptions.length = 0;
        _qsa(selectEl, "option").forEach((o, i) => {
            rawOptions.push({
                value: o.value,
                label: (o.textContent || "").trim(),
                disabled: !!o.disabled,
                isPlaceholder: o.value === "" && i === 0,
            });
        });
        _filter((input.value || "").trim());
        _syncFromSelect();
    }
};
}

function _initSearchComboBoxes() {
    const selects = _qsa(document, "select.js-search-combobox");
    if (!selects.length) return;
    selects.forEach((sel) => _buildCombobox(sel));
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initSearchComboBoxes);
} else {
    _initSearchComboBoxes();
}

window.addEventListener("pageshow", _initSearchComboBoxes);
