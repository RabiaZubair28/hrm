/** @odoo-module **/

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

let _draftMsgTimer = null;

function _setMsg(text, isError) {
    const el = document.getElementById("draft_save_msg");
    if (!el) {
        console.warn("[HRMIS_DRAFT_SAVE] #draft_save_msg not found");
        return;
    }

    el.style.display = "block";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "10px";
    el.style.fontWeight = "600";
    el.style.marginTop = "10px";

    if (isError) {
        el.style.background = "#fff1f2";
        el.style.border = "1px solid #fecdd3";
        el.style.color = "#9f1239";
    } else {
        el.style.background = "#ecfdf5";
        el.style.border = "1px solid #a7f3d0";
        el.style.color = "#065f46";
    }

    el.textContent = text || "";

    // ✅ AUTO HIDE (reset previous timer)
    if (_draftMsgTimer) clearTimeout(_draftMsgTimer);
        const timeout = isError ? 20000 : 10000;

        _draftMsgTimer = setTimeout(() => {
            el.style.display = "none";
            el.textContent = "";
        }, timeout);
}

function _applyHrmisDraftSave() {

    const form = _qs(document, "#profile_update_form");
    if (!form) {
        console.warn("[HRMIS_DRAFT_SAVE] #profile_update_form not found");
        return;
    }

    const btn = _qs(form, "#btn_save_draft") || _qs(document, "#btn_save_draft");
    if (!btn) {
        console.warn("[HRMIS_DRAFT_SAVE] #btn_save_draft not found (draft save disabled)");
        return;
    }

    // Prevent double-binding when pageshow/DOMContentLoaded fires multiple times
    if (btn.dataset.hrmisDraftSaveBound === "1") {
        console.log("[HRMIS_DRAFT_SAVE] already bound, skipping");
        return;
    }
    btn.dataset.hrmisDraftSaveBound = "1";

    btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // Basic sanity check: required route
        const url = "/hrmis/profile/request/save";
        btn.disabled = true;

        try {
            const fd = new FormData(form);

            // Optional: log a few known fields (don’t log sensitive values)
            const res = await fetch(url, {
                method: "POST",
                body: fd,
                credentials: "same-origin",
            });

            let payload = null;
            try {
                payload = await res.json();
            } catch (e) {
                console.warn("[HRMIS_DRAFT_SAVE] response not JSON / parse failed", e);
                payload = null;
            }

            if (!res.ok) {
                const errMsg =
                    (payload && (payload.error || payload.message)) ||
                    `Save failed (HTTP ${res.status}).`;
                console.warn("[HRMIS_DRAFT_SAVE] save failed:", errMsg);
                _setMsg(errMsg, true);
                return;
            }

            const okMsg = (payload && payload.message) || "Draft saved.";
            _setMsg(okMsg, false);
        } catch (e) {
            console.error("[HRMIS_DRAFT_SAVE] exception:", e);
            _setMsg("Save failed due to a network/server error.", true);
        } finally {
            btn.disabled = false;
        }
    });
}

/* INIT — exactly like your working file */
function _initHrmisDraftSave() {
    _applyHrmisDraftSave();
    const serverMsg = document.querySelector(".hrmis_server_msg");
if (serverMsg) {
    const msgText = (serverMsg.textContent || "").trim();
    const msgType = serverMsg.dataset.type; // "success" or "error"
    if (msgText) {
        _setMsg(msgText, msgType === "error");
    }
    // serverMsg.remove(); // ✅ prevents showing again on pageshow

}
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initHrmisDraftSave);
} else {
    _initHrmisDraftSave();
}

// for BFCache + refresh-like restores
window.addEventListener("pageshow", _initHrmisDraftSave);