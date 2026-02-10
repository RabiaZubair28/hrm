/** @odoo-module **/

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

function _qsa(root, sel) {
    return root ? Array.from(root.querySelectorAll(sel)) : [];
}

function _initTransferVacanciesPagination(root) {
    const tbody = _qs(root, "#tvTbody");
    const pageInfo = _qs(root, "#tvPageInfo");
    const pagination = _qs(root, "#tvPagination");
    const pageSizeSelect = _qs(root, "#tvPageSize");

    if (!tbody || !pageInfo || !pagination || !pageSizeSelect) {
        return;
    }

    const rows = _qsa(tbody, "tr.tv-row");
    if (!rows.length) {
        pageInfo.textContent = "Showing 0-0 of 0";
        pagination.innerHTML = "";
        return;
    }

    let currentPage = 1;
    let pageSize = parseInt(pageSizeSelect.value || "10", 10);

    function totalPages() {
        return Math.max(1, Math.ceil(rows.length / pageSize));
    }

    function clampPage(p) {
        const tp = totalPages();
        return Math.min(tp, Math.max(1, p));
    }

    function buildPageItem(label, page, disabled, active) {
        const li = document.createElement("li");
        li.className = "page-item" + (disabled ? " disabled" : "") + (active ? " active" : "");

        const a = document.createElement("a");
        a.className = "page-link";
        a.href = "#";
        a.textContent = label;

        a.addEventListener("click", function (e) {
            e.preventDefault();
            if (disabled) return;
            renderPage(page);
        });

        li.appendChild(a);
        return li;
    }

    function renderPagination() {
        pagination.innerHTML = "";

        const tp = totalPages();

        // Prev
        pagination.appendChild(
            buildPageItem("«", currentPage - 1, currentPage === 1, false)
        );

        // Page numbers window
        const windowSize = 5;
        let start = Math.max(1, currentPage - Math.floor(windowSize / 2));
        let end = Math.min(tp, start + windowSize - 1);
        start = Math.max(1, end - windowSize + 1);

        for (let p = start; p <= end; p++) {
            pagination.appendChild(
                buildPageItem(String(p), p, false, p === currentPage)
            );
        }

        // Next
        pagination.appendChild(
            buildPageItem("»", currentPage + 1, currentPage === tp, false)
        );
    }

    function renderPage(page) {
        currentPage = clampPage(page);

        const startIdx = (currentPage - 1) * pageSize;
        const endIdx = startIdx + pageSize;

        rows.forEach((tr, idx) => {
            tr.style.display = (idx >= startIdx && idx < endIdx) ? "" : "none";
        });

        const shownFrom = rows.length ? (startIdx + 1) : 0;
        const shownTo = Math.min(endIdx, rows.length);
        pageInfo.textContent = `Showing ${shownFrom}–${shownTo} of ${rows.length}`;

        renderPagination();
    }

    // events
    pageSizeSelect.addEventListener("change", function () {
        pageSize = parseInt(pageSizeSelect.value || "10", 10);
        renderPage(1);
    });

    // initial render
    renderPage(1);
}

function _init() {
    // Scope init to the transfer vacancies block (prevents collisions)
    const container = document.getElementById("tvContainer") || document;
    _initTransferVacanciesPagination(container);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _init);
} else {
    _init();
}

// For browser back/forward cache
window.addEventListener("pageshow", _init);
