/** @odoo-module **/

// HRMIS: Manage Requests filters (Leave Requests + Leave Status)
// Rebuilt to be bulletproof with existing pager/tab JS.
//
// Key points:
// - Scopes each .hrmis-filters block to the first .hrmis-table AFTER it (closest sibling search, then fallback).
// - Filters ONLY real data rows inside .hrmis-table__body (never the header).
// - Hides rows by toggling a CSS class with `display:none !important` so other scripts can't re-show them.
// - Re-applies filtering automatically when the table body changes (MutationObserver) and on tab clicks.

function _qs(root, sel) {
    return (root || document).querySelector(sel);
}
function _qsa(root, sel) {
    return Array.from((root || document).querySelectorAll(sel));
}
function _norm(v) {
    return (v || "").toString().trim().toLowerCase();
}

const HIDE_CLASS = "hrmis-filter-hidden";



function _findPagerScopeFromTable(table) {
    if (!table) return null;
    // Prefer footer-based scope (matches hrmis_leave_histroy_pager.js behavior)
    const footer = table.parentElement ? table.parentElement.querySelector(".js-hrmis-pager-footer") : null;
    if (footer) {
        return footer.closest(".hrmis-leave-history-ui") || footer.parentElement;
    }
    // Fallback: walk up to find __hrmisPager
    let el = table;
    for (let i = 0; i < 8 && el; i++) {
        if (el.__hrmisPager) return el;
        el = el.parentElement;
    }
    return null;
}

function _pagerReset(table) {
    const scope = _findPagerScopeFromTable(table);
    if (scope && scope.__hrmisPager) {
        if (typeof scope.__hrmisPager.reset === "function") scope.__hrmisPager.reset();
        else if (typeof scope.__hrmisPager.render === "function") scope.__hrmisPager.render(true);
    }
}

function _pagerRender(table) {
    const scope = _findPagerScopeFromTable(table);
    if (scope && scope.__hrmisPager && typeof scope.__hrmisPager.render === "function") {
        scope.__hrmisPager.render(true);
    }
}
function _findTableForFilters(filtersEl) {
    // Prefer the nearest table AFTER the filters element (same tab/panel)
    let cur = filtersEl;
    for (let i = 0; i < 25 && cur; i++) {
        cur = cur.nextElementSibling;
        if (!cur) break;
        if (cur.matches && cur.matches(".hrmis-table")) return cur;
        const inside = _qs(cur, ".hrmis-table");
        if (inside) return inside;
    }
    // Fallback: first table in the closest panel/tab
    const container = filtersEl.closest(".hrmis-panel, .hrmis-tab-pane, section, .hrmis-panel__body, body") || document;
    return _qs(container, ".hrmis-table");
}

function _getRows(table) {
    const body = _qs(table, ".hrmis-table__body") || table;
    // Only body rows; exclude head explicitly
    return _qsa(body, ".hrmis-table__row, .hrmis-manage-table__row, .hrmis-leave-row")
        .filter((r) => !r.classList.contains("hrmis-table__head") && !r.classList.contains("hrmis-pr-table__head"));
}

function _rowStatus(row) {
    const ds = row.getAttribute("data-status");
    if (ds) return _norm(ds);
    const badge = _qs(row, ".hrmis-status");
    if (badge) return _norm(badge.textContent);
    return _norm(row.textContent);
}
function _rowDate(row) {
    // Return a *local* YYYY-MM-DD string.
    // Why: in QWeb we often set data-date to a raw datetime like "2026-03-03 19:00:00"
    // (server/UTC-ish). If we simply slice(0,10), "Today" can mismatch for users
    // in +TZ. So we parse and convert to local date.
    const raw = row.getAttribute("data-date");
    if (raw) {
        const s = raw.toString().trim();

        // If it's already a date, keep it.
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

        // Common Odoo datetime: "YYYY-MM-DD HH:MM:SS" (no tz)
        // Important: this string is already rendered for the user's context (often *local*).
        // Do NOT force UTC ("Z") here, otherwise "Today" can shift by timezone and miss matches.
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
            return s.slice(0, 10);
        }

        // ISO or other parseable format (may include tz)
        const dt = new Date(s);
        if (!Number.isNaN(dt.getTime())) {
            const yyyy = dt.getFullYear();
            const mm = String(dt.getMonth() + 1).padStart(2, "0");
            const dd = String(dt.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
        }

        // Fallback: grab first date-looking part
        const m = s.match(/\d{4}-\d{2}-\d{2}/);
        if (m) return m[0];
    }

    const txt = row.textContent || "";
    const m = txt.match(/\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : "";
}
function _rowSearch(row) {
    const ds = row.getAttribute("data-search");
    return _norm(ds || row.textContent || "");
}

function _statusMatch(filterVal, rowStatus) {
    const fv = _norm(filterVal);
    if (!fv) return true;

    // If dropdown is already Odoo state values
    if (["confirm", "validate1", "validate", "refuse", "cancel"].includes(fv)) {
        if (fv === "confirm") {
            // treat pending as confirm OR validate1
            return rowStatus === "confirm" || rowStatus === "validate1";
        }
        return rowStatus === fv;
    }

    // If dropdown uses UI labels
    if (fv === "pending" || fv === "submitted") return rowStatus === "confirm" || rowStatus === "validate1";
    if (fv === "approved") return rowStatus === "validate";
    if (fv === "rejected") return rowStatus === "refuse";
    if (fv === "cancelled") return rowStatus === "cancel";

    return rowStatus === fv;
}

function _dateMatch(filterVal, rowDate) {
    const fv = _norm(filterVal);
    if (!fv) return true;
    if (!rowDate) return false;

    // direct date in dropdown (if any)
    if (/^\d{4}-\d{2}-\d{2}$/.test(fv)) return rowDate === fv;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const tRow = Date.parse(rowDate);
    const tNow = Date.parse(todayStr);
    if (Number.isNaN(tRow) || Number.isNaN(tNow)) return false;

    const day = 24 * 60 * 60 * 1000;

    if (fv === "today") return rowDate === todayStr;
    if (fv === "2days") return (tRow >= (tNow - 2 * day) && tRow <= tNow);
    if (fv === "week") return (tRow >= (tNow - 7 * day) && tRow <= tNow);

    // unknown option -> don't filter out
    return true;
}

function _apply(filtersEl) {
    const searchEl = _qs(filtersEl, ".hrmis-filter__search");
    const statusEl = _qs(filtersEl, 'select.hrmis-filter__select[data-filter="status"]');
    const dateEl = _qs(filtersEl, 'select.hrmis-filter__select[data-filter="date"]');

    const q = _norm(searchEl ? searchEl.value : "");
    const st = statusEl ? statusEl.value : "";
    const dt = dateEl ? dateEl.value : "";

    const table = _findTableForFilters(filtersEl);
    if (!table) return;

    const rows = _getRows(table);

    rows.forEach((row) => {
        const rowS = _rowStatus(row);
        const rowD = _rowDate(row);
        const rowQ = _rowSearch(row);

        let ok = true;

        // search: min 3 chars (as UI says)
        if (q && q.length >= 3) ok = ok && rowQ.includes(q);

        ok = ok && _statusMatch(st, rowS);
        ok = ok && _dateMatch(dt, rowD);

        if (ok) row.classList.remove(HIDE_CLASS);
        else row.classList.add(HIDE_CLASS);
    });

    _pagerRender(table);
}

function _bind(filtersEl) {
    const searchEl = _qs(filtersEl, ".hrmis-filter__search");
    const statusEl = _qs(filtersEl, 'select.hrmis-filter__select[data-filter="status"]');
    const dateEl = _qs(filtersEl, 'select.hrmis-filter__select[data-filter="date"]');

    const table = _findTableForFilters(filtersEl);
    const body = table ? (_qs(table, ".hrmis-table__body") || table) : null;

    const apply = () => _apply(filtersEl);
    const applyReset = () => { const tableNow = _findTableForFilters(filtersEl); _apply(filtersEl); _pagerReset(tableNow); };

    if (searchEl) searchEl.addEventListener("input", applyReset);
    if (statusEl) statusEl.addEventListener("change", applyReset);
    if (dateEl) dateEl.addEventListener("change", applyReset);

    // Re-apply when rows change (pager, ajax, tab switch)
    if (body && window.MutationObserver) {
        const obs = new MutationObserver(() => apply());
        obs.observe(body, { childList: true, subtree: true });
    }

    // Re-apply after tab clicks
    document.addEventListener("click", (e) => {
        const t = e.target;
        if (!t) return;
        if (t.closest(".hrmis-tabs") || t.closest(".nav-tabs") || t.closest("[data-bs-toggle='tab']")) {
            setTimeout(apply, 60);
        }
    });

    apply();
}

function init() {
    const blocks = _qsa(document, ".hrmis-filters");
    blocks.forEach(_bind);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
 