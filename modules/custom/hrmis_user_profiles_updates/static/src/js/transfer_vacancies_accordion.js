/** @odoo-module **/

// HRMIS: Transfer Vacancies (Accordion) client-side filters
// - District filters Facility options STRICTLY by data-district-id
// - After hiding options, refresh SearchComboBox menu
// - Filters accordion items with smooth animation

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
    return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _animateHide(el) {
    if (!el) return;
    el.classList.add("tv-acc-hidden");
    el.classList.remove("tv-acc-visible");
}

function _animateShow(el) {
    if (!el) return;
    el.classList.remove("tv-acc-hidden");
    el.classList.add("tv-acc-visible");
}

function _filterFacilityOptionsByDistrict(facilitySelect, districtId) {
    if (!facilitySelect) return;

    const opts = Array.from(facilitySelect.options || []);
    opts.forEach((opt, idx) => {
        if (idx === 0) {
            opt.style.display = "";
            return;
        }

        // STRICT match by district id (no name contains nonsense)
        const dId = (opt.dataset.districtId || "").trim();
        const visible = !districtId || (dId && dId === districtId);
        opt.style.display = visible ? "" : "none";
    });

    // If selected facility is hidden now, reset it
    const selOpt = facilitySelect.selectedOptions && facilitySelect.selectedOptions[0];
    if (selOpt && selOpt.style.display === "none") {
        facilitySelect.value = "";
        facilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // IMPORTANT: refresh combobox menu UI (because it was rendered from old options)
    if (facilitySelect._scb && typeof facilitySelect._scb.refresh === "function") {
        facilitySelect._scb.refresh();
    }
}

function _filterAccordions(districtId, facilityId) {
    const items = _qsa(document, ".js-tv-acc-item");
    items.forEach((it) => {
        const itDistrict = (it.dataset.district || "").trim();
        const itFacility = (it.dataset.facility || "").trim();

        const districtOk = !districtId || itDistrict === districtId;
        const facilityOk = !facilityId || itFacility === facilityId;

        if (districtOk && facilityOk) _animateShow(it);
        else _animateHide(it);
    });
}

function _initTvAccordionFilters() {
    const districtSelect = _qs(document, ".js-tv-acc-district");
    const facilitySelect = _qs(document, ".js-tv-acc-facility");
    const resetBtn = _qs(document, ".js-tv-acc-reset");

    if (!districtSelect || !facilitySelect) return;

    function run() {
        const districtId = districtSelect.value || "";
        const facilityId = facilitySelect.value || "";

        _filterFacilityOptionsByDistrict(facilitySelect, districtId);
        _filterAccordions(districtId, facilityId);
    }

    districtSelect.addEventListener("change", () => {
        // When district changes, clear facility selection
        facilitySelect.value = "";
        facilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
        run();
    });

    facilitySelect.addEventListener("change", () => {
        run();
    });

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            districtSelect.value = "";
            facilitySelect.value = "";
            districtSelect.dispatchEvent(new Event("change", { bubbles: true }));
            facilitySelect.dispatchEvent(new Event("change", { bubbles: true }));
            run();
        });
    }

    run();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initTvAccordionFilters);
} else {
    _initTvAccordionFilters();
}

window.addEventListener("pageshow", _initTvAccordionFilters);
