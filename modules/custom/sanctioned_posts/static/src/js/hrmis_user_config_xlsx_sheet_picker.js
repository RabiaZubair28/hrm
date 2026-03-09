/** @odoo-module **/

// HRMIS: User Config (XLSX Sheet Picker)
// - Logs everything to console
// - Fixes "invalid form control is not focusable" by disabling select when hidden
// - Enforces sheet selection before submit
// - Requires SheetJS global XLSX

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

function _clearOptions(selectEl) {
    if (!selectEl) return;
    while (selectEl.options.length > 1) {
        selectEl.remove(1);
    }
}

function _setSelectedSheet(hiddenInput, value) {
    if (!hiddenInput) return;
    hiddenInput.value = value || "";
}

function _setSelectEnabledVisible(selectEl, show) {
    if (!selectEl) return;
    selectEl.style.display = show ? "" : "none";
    // IMPORTANT: disable when hidden so browser doesn't validate/focus it
    selectEl.disabled = !show;
}

function _setHintVisible(hintEl, show) {
    if (!hintEl) return;
    hintEl.style.display = show ? "" : "none";
}

async function _readSheetNamesFromFile(file) {
    if (typeof XLSX === "undefined") {
        throw new Error("SheetJS (XLSX) is not loaded. Add xlsx.full.min.js to assets.");
    }
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: "array" });
    return (wb.SheetNames || []).filter(Boolean);
}

function _initHrmisXlsxSheetPicker() {
    console.log("[HRMIS][SheetPicker] init start");

    const form = _qs(document, ".hrmis-xlsx-upload-form");
    if (!form) {
        console.log("[HRMIS][SheetPicker] no form (.hrmis-xlsx-upload-form) found");
        return;
    }

    const fileInput = _qs(form, ".js-xlsx-file");
    const sheetSelect = _qs(form, ".js-sheet-select");
    const sheetHidden = _qs(form, ".js-sheet-name");
    const hint = _qs(form, ".js-sheet-hint");

    console.log("[HRMIS][SheetPicker] form found", { form, fileInput, sheetSelect, sheetHidden, hint });

    if (!fileInput || !sheetSelect || !sheetHidden) {
        console.warn("[HRMIS][SheetPicker] missing required elements. "
            + "Need .js-xlsx-file, .js-sheet-select, .js-sheet-name");
        return;
    }

    // Reset UI
    _clearOptions(sheetSelect);
    _setSelectedSheet(sheetHidden, "");
    _setSelectEnabledVisible(sheetSelect, false);
    _setHintVisible(hint, false);

    sheetSelect.addEventListener("change", () => {
        console.log("[HRMIS][SheetPicker] sheet changed:", sheetSelect.value);
        _setSelectedSheet(sheetHidden, sheetSelect.value || "");
    });

    fileInput.addEventListener("change", async () => {
        console.log("[HRMIS][SheetPicker] file input changed");

        _clearOptions(sheetSelect);
        _setSelectedSheet(sheetHidden, "");
        _setSelectEnabledVisible(sheetSelect, false);
        _setHintVisible(hint, false);

        const file = fileInput.files && fileInput.files[0];
        console.log("[HRMIS][SheetPicker] selected file:", file);

        if (!file) return;

        try {
            const names = await _readSheetNamesFromFile(file);
            console.log("[HRMIS][SheetPicker] sheet names:", names);

            if (!names.length) {
                console.warn("[HRMIS][SheetPicker] workbook has no sheet names");
                return;
            }

            names.forEach((nm) => {
                const opt = document.createElement("option");
                opt.value = nm;
                opt.textContent = nm;
                sheetSelect.appendChild(opt);
            });

            // Auto-select first sheet
            sheetSelect.value = names[0];
            _setSelectedSheet(sheetHidden, names[0]);

            _setSelectEnabledVisible(sheetSelect, true);
            _setHintVisible(hint, true);

            console.log("[HRMIS][SheetPicker] dropdown shown, selected:", names[0]);
        } catch (e) {
            console.error("[HRMIS][SheetPicker] failed to read workbook", e);
            _clearOptions(sheetSelect);
            _setSelectedSheet(sheetHidden, "");
            _setSelectEnabledVisible(sheetSelect, false);
            _setHintVisible(hint, false);
        }
    });

    form.addEventListener("submit", (ev) => {
        console.log("[HRMIS][SheetPicker] submit", {
            selectVisible: sheetSelect.style.display !== "none",
            selectDisabled: sheetSelect.disabled,
            sheetHidden: sheetHidden.value,
            sheetSelect: sheetSelect.value,
        });

        // if dropdown is visible, enforce sheet selection
        const ddVisible = sheetSelect.style.display !== "none" && !sheetSelect.disabled;
        if (ddVisible && !sheetHidden.value) {
            ev.preventDefault();
            console.warn("[HRMIS][SheetPicker] submit blocked: no sheet selected");
            alert("Please select a sheet.");
            // focus select to avoid generic browser error
            try { sheetSelect.focus(); } catch (_) {}
        }
    });

    console.log("[HRMIS][SheetPicker] init done");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initHrmisXlsxSheetPicker);
} else {
    _initHrmisXlsxSheetPicker();
}

window.addEventListener("pageshow", _initHrmisXlsxSheetPicker);