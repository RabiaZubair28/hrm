/** @odoo-module **/

function _qs(root, sel) {
    return root ? root.querySelector(sel) : null;
}

function _initHrmisEmployeesPage() {
    const page = _qs(document, ".hrmis-employees-page");
    if (!page) {
        return;
    }

    // bind events here
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _initHrmisEmployeesPage);
} else {
    _initHrmisEmployeesPage();
}

window.addEventListener("pageshow", _initHrmisEmployeesPage);