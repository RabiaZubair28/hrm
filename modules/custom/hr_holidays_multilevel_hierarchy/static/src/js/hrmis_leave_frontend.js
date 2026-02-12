/** @odoo-module **/

// HRMIS Leave Form Enhancement with BPS-filtered approvers and unique debug logs

(function () {
    function _qs(root, sel) {
        return root ? root.querySelector(sel) : null;
    }

    function _escapeHtml(s) {
        return String(s || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function _normLeaveTypeName(name) {
        return String(name || "")
            .trim()
            .toLowerCase()
            .replace(/[\u2010-\u2015]/g, "-")
            .replace(/[^a-z0-9]+/g, "");
    }

    const _BLOCKED_LEAVE_TYPE_NAMES = new Set(["paidtimeoff", "sicktimeoff"]);

    function _isBlockedLeaveTypeName(name) {
        return _BLOCKED_LEAVE_TYPE_NAMES.has(_normLeaveTypeName(name));
    }

    function _pruneBlockedLeaveTypes(selectEl) {
        if (!selectEl) return;
        Array.from(selectEl.options || []).forEach((opt) => {
            if (!opt || !opt.value) return; // keep placeholder
            if (_isBlockedLeaveTypeName(opt.textContent || "")) opt.remove();
        });
        if (selectEl.value && !Array.from(selectEl.options || []).some((o) => o.value === selectEl.value)) {
            selectEl.value = "";
        }
    }

    function _setSelectOptions(selectEl, options, keepValue) {
        if (!selectEl) return;
        const current = keepValue ? selectEl.value : "";
        const placeholder =
            selectEl.querySelector("option[value='']")?.outerHTML ||
            '<option value="">Select leave type</option>';
        selectEl.innerHTML = placeholder;

        console.log("🟢 [HRMIS] Setting leave type options:", options);

        for (const opt of options || []) {
            if (_isBlockedLeaveTypeName(opt?.name)) continue;
            const o = document.createElement("option");
            o.value = String(opt.id);
            o.textContent = opt.name;
            if (opt.support_document !== undefined) o.dataset.supportDocument = opt.support_document ? "1" : "0";
            if (opt.support_document_note !== undefined) o.dataset.supportDocumentNote = opt.support_document_note || "";
            selectEl.appendChild(o);
        }
        _pruneBlockedLeaveTypes(selectEl);

        if (keepValue && current && [...selectEl.options].some(o => o.value === current)) {
            selectEl.value = current;
        } else {
            selectEl.value = "";
        }
        console.log("🟢 [HRMIS] Leave type selection updated, current value:", selectEl.value);
    }

    function _updateSupportDocUI(formEl) {
        const selectEl = _qs(formEl, ".js-hrmis-leave-type");
        const boxEl = _qs(formEl, ".js-hrmis-support-doc");
        const noteEl = _qs(formEl, ".js-hrmis-support-doc-note");
        const fileEl = _qs(formEl, ".js-hrmis-support-doc-file");
        const requiredMarkEl = _qs(formEl, ".js-hrmis-support-doc-required");
        if (!selectEl || !boxEl || !noteEl || !fileEl) return;

        const opt = selectEl.selectedOptions?.[0];
        const required = opt?.dataset?.supportDocument === "1";
        const note = (opt?.dataset?.supportDocumentNote || "").trim();

        console.log("🟡 [HRMIS] Updating support doc UI:", { required, note });

        if (requiredMarkEl) requiredMarkEl.style.display = required ? "" : "none";
        noteEl.textContent = required ? note || "Please upload the required supporting document." : "Optional.";
        fileEl.required = !!required;
    }

    function _renderApproverSteps(panelEl, steps, employeeBPS = 0) {
        console.log("🔵 [HRMIS] Rendering approvers for BPS", employeeBPS, steps);

        const emptyEl = _qs(panelEl, ".js-hrmis-approver-empty");
        const stepsEl = _qs(panelEl, ".js-hrmis-approver-steps");
        if (!stepsEl) return;

        const filteredSteps = [];
        (steps || []).forEach(st => {
            const approvers = (st.approvers || []).filter(a => {
                const from = a?.bps_from ?? 0;
                const to = a?.bps_to ?? 999;
                const ok = employeeBPS >= from && employeeBPS <= to;
                console.log(`🔹 [HRMIS] Approver ${a.name}: BPS ${from}-${to}, employeeBPS ${employeeBPS}, show?`, ok);
                return ok;
            });
            if (approvers.length) filteredSteps.push({ step: st.step, approvers });
        });

        if (emptyEl) emptyEl.style.display = filteredSteps.length ? "none" : "";
        stepsEl.style.display = filteredSteps.length ? "" : "none";

        if (!filteredSteps.length) {
            stepsEl.innerHTML = "";
            console.log("⚪ [HRMIS] No approvers matched BPS. Cleared UI.");
            return;
        }

        stepsEl.innerHTML = filteredSteps.map(st => `
            <div class="hrmis-approver-step">
                <div class="hrmis-approver-step__title">Step ${_escapeHtml(st.step)}</div>
                <div class="hrmis-approver-step__list">
                    ${st.approvers.map(a => {
                        const name = _escapeHtml(a?.name || "");
                        const seq = _escapeHtml(a?.sequence ?? "");
                        const stype = _escapeHtml(a?.sequence_type || "sequential");
                        const job = _escapeHtml(a?.job_title || "");
                        const dept = _escapeHtml(a?.department || "");
                        const meta = [job, dept].filter(Boolean).join(" • ");
                        return `
                            <div class="hrmis-approver-step__item">
                                <div class="hrmis-approver-step__row">
                                    <div class="hrmis-approver-step__name">${name}</div>
                                    <div class="hrmis-approver-step__badge">${stype}</div>
                                </div>
                                <div class="hrmis-approver-step__sub">Seq: ${seq}${meta ? ` — ${meta}` : ""}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
        console.log("🟢 [HRMIS] UI updated with filtered approvers.");
    }

    async function _refreshApprovers(formEl) {
        const url = formEl?.dataset?.leaveApproversUrl;
        const employeeId = formEl?.dataset?.employeeId;
        const employeeBPS = parseInt(formEl?.dataset?.employeeBps, 10) || 0;
        const leaveTypeEl = _qs(formEl, ".js-hrmis-leave-type");
        const panelEl = _qs(formEl, ".js-hrmis-approver-panel");

        if (!url || !employeeId || !leaveTypeEl || !panelEl) return;

        const leaveTypeId = leaveTypeEl.value;
        if (!leaveTypeId) {
            _renderApproverSteps(panelEl, [], employeeBPS);
            return;
        }

        console.log("🔴 [HRMIS] Fetching approvers for employee", employeeId, "leave type", leaveTypeId);

        try {
            const resp = await fetch(`${url}?employee_id=${employeeId}&leave_type_id=${leaveTypeId}`, {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            });
            const data = await resp.json();
            console.log("🟣 [HRMIS] Approver API response:", data);

            if (!data?.ok || !Array.isArray(data.steps)) {
                _renderApproverSteps(panelEl, [], employeeBPS);
                return;
            }

            _renderApproverSteps(panelEl, data.steps, employeeBPS);
        } catch (err) {
            console.error("❌ [HRMIS] Error fetching approvers:", err);
            _renderApproverSteps(panelEl, [], employeeBPS);
        }
    }

    async function _refreshLeaveTypes(formEl) {
        const url = formEl?.dataset?.leaveTypesUrl;
        const employeeId = formEl?.dataset?.employeeId;
        const dateFromEl = _qs(formEl, ".js-hrmis-date-from");
        const selectEl = _qs(formEl, ".js-hrmis-leave-type");
        if (!url || !employeeId || !dateFromEl || !selectEl) return;

        console.log("🟠 [HRMIS] Fetching leave types for employee", employeeId, "date", dateFromEl.value);

        try {
            const resp = await fetch(`${url}?employee_id=${employeeId}&date_from=${dateFromEl.value || ""}`, {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            });
            const data = await resp.json();
            console.log("🟣 [HRMIS] Leave types API response:", data);

            if (!data?.ok) return;

            _setSelectOptions(selectEl, data.leave_types || [], true);
            _updateSupportDocUI(formEl);

            if (selectEl.value) {
                _refreshApprovers(formEl);
            }
        } catch (err) {
            console.error("❌ [HRMIS] Error fetching leave types:", err);
        }
    }

    function _init() {
        const formEl = document.querySelector(".hrmis-leave-request-form");
        if (!formEl) return;

        console.log("⚡ [HRMIS] Initializing leave request form JS");

        const dateFromEl = _qs(formEl, ".js-hrmis-date-from");
        if (dateFromEl) {
            dateFromEl.addEventListener("change", () => _refreshLeaveTypes(formEl));
            dateFromEl.addEventListener("blur", () => _refreshLeaveTypes(formEl));
        }

        const leaveTypeEl = _qs(formEl, ".js-hrmis-leave-type");
        if (leaveTypeEl) {
            _pruneBlockedLeaveTypes(leaveTypeEl);
            leaveTypeEl.addEventListener("change", () => _refreshApprovers(formEl));
        }

        _updateSupportDocUI(formEl);
        _refreshApprovers(formEl);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", _init);
    } else {
        _init();
    }
})();
