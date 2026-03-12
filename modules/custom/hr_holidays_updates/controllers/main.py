# -*- coding: utf-8 -*-
from __future__ import annotations
import base64

from datetime import date, timedelta
from datetime import datetime, time
import logging
import re
import json
import base64
from urllib.parse import quote_plus, unquote
from odoo.http import Response

from dateutil.relativedelta import relativedelta

from odoo import http, fields
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request

import os
from .helperControllers.emr_profile_data import EmrProfileDataMixin


_MAX_UPLOAD_BYTES = 4 * 1024 * 1024  # 4 MB
_ALLOWED_UPLOAD_EXTS = {"pdf", "jpg", "jpeg", "png", "svg"}
_ALLOWED_UPLOAD_MIMES = {
    "application/pdf",
    "application/x-pdf",
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/svg+xml",
}

def _norm_ext(filename: str) -> str:
    fn = (filename or "").strip().lower()
    _, ext = os.path.splitext(fn)
    return (ext or "").lstrip(".").lower()

def _validate_upload_file(
    file_obj,
    label: str,
    *,
    max_bytes=_MAX_UPLOAD_BYTES,
    allowed_exts=_ALLOWED_UPLOAD_EXTS,
    allowed_mimes=_ALLOWED_UPLOAD_MIMES,
):
    """
    Validates a Werkzeug FileStorage-like object from request.httprequest.files.get(...)

    Rules:
    - Extension must be in allowed_exts
    - MIME type must be in allowed_mimes (if provided by client)
    - File size must be <= max_bytes

    Returns: (ok: bool, error_msg: str, data: bytes)
    """
    if not file_obj:
        return True, "", b""

    filename = getattr(file_obj, "filename", "") or ""
    ext = _norm_ext(filename)

    if ext not in allowed_exts:
        return False, f"{label}: Invalid file type. Allowed: PDF, JPG, JPEG, PNG, SVG.", b""

    # MIME type check (clients sometimes send empty / octet-stream; allow those)
    try:
        mime = (getattr(file_obj, "mimetype", None) or getattr(file_obj, "content_type", None) or "").lower()
    except Exception:
        mime = ""
    allowed_mimes_norm = {m.lower() for m in (allowed_mimes or set())}
    if mime and mime not in allowed_mimes_norm:
        if mime != "application/octet-stream":
            return False, f"{label}: Invalid file format. Allowed: PDF, JPG, JPEG, PNG, SVG.", b""

    # Read once (we need bytes anyway for base64 storage).
    try:
        data = file_obj.read() or b""
    except Exception:
        return False, f"{label}: Could not read uploaded file.", b""

    # Reset stream position just in case something else expects it later (safe).
    try:
        file_obj.stream.seek(0)
    except Exception:
        pass

    if len(data) > max_bytes:
        # show exact limit requested
        return False, f"{label}: File too large. Max allowed size is 4 MB.", b""

    return True, "", data


_logger = logging.getLogger(__name__)

def _safe_int(v, default=None):
    try:
        return int(v)
    except Exception:
        return default


_DATE_DMY_RE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$")
_OVERLAP_ERR_RE = re.compile(r"(overlap|overlapping|already\s+taken|conflict)", re.IGNORECASE)
_OVERLAP_FRIENDLY_MSG = "This leave request is overlapping with existing leave request"
_EXISTING_DAY_MSG = "You cannot take existing day's leave"


def _safe_date(v, default=None):
    """
    Robust date parsing for website forms / query params.

    Why:
    - HTML `<input type="date">` normally submits `YYYY-MM-DD`
    - But on older browsers / polyfills it can fall back to a plain text input
      where users enter `DD/MM/YYYY` (common in this deployment).
    - `fields.Date.to_date()` returns None for unsupported formats; many call sites
      used it in a way that *doesn't* fall back when parsing fails.
    """
    default = default or fields.Date.today()
    if isinstance(v, date):
        return v
    if not v:
        return default

    # Odoo native ISO parsing (YYYY-MM-DD, datetime, etc.)
    try:
        d = fields.Date.to_date(v)
        if d:
            return d
    except Exception:
        pass

    # Try DD/MM/YYYY (or MM/DD/YYYY). Prefer D/M/Y unless the first component
    # is clearly a month (> 12 implies D/M/Y, > 12 in second implies M/D/Y).
    m = _DATE_DMY_RE.match(str(v))
    if m:
        a, b, y = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
        day, month = a, b
        if a <= 12 < b:
            # Looks like MM/DD/YYYY
            month, day = a, b
        try:
            return date(y, month, day)
        except Exception:
            return default

    return default


def _friendly_leave_error(e: Exception) -> str:
    """
    Convert common Odoo errors into short, user-friendly messages for the website UI.
    """
    # Odoo exceptions often carry the user-facing text in `name` or `args[0]`.
    msg = getattr(e, "name", None) or (e.args[0] if getattr(e, "args", None) else None) or str(e) or ""
    msg = str(msg).strip()

    # Requested by business: replace the "started leave reset" errors with a single message.
    # Message wording varies by Odoo version/translation ("officer" vs "manager").
    if "reset a started leave" in msg or "reset the started leave" in msg:
        return _EXISTING_DAY_MSG

    # Normalize common overlap messages to a single friendly one.
    if _OVERLAP_ERR_RE.search(msg):
        return _OVERLAP_FRIENDLY_MSG

    # Avoid leaking internal access errors.
    if isinstance(e, AccessError):
        return "You are not allowed to submit this leave request"

    return msg or "Could not submit leave request"


def _current_employee():
    """Best-effort mapping from logged-in user -> hr.employee."""
    return (
        request.env["hr.employee"]
        .sudo()
        .search([("user_id", "=", request.env.user.id)], limit=1)
    )


def _base_ctx(page_title: str, active_menu: str, **extra):
    ctx = {
        "page_title": page_title,
        "active_menu": active_menu,
        # Used by the global layout for profile links
        "current_employee": _current_employee(),
    }
    # Keep sidebar badges in sync for Section Officer across all pages rendered by this controller.
    try:
        user = request.env.user
        if user and user.has_group("custom_login.group_section_officer"):
            from odoo.addons.hr_holidays_updates.controllers.leave_data import (
                pending_leave_requests_for_user,
            )

            pending_res = pending_leave_requests_for_user(user.id)
            # Backwards-compat: helper may return either a recordset or (recordset, extra_info).
            pending_leaves = pending_res[0] if isinstance(pending_res, (list, tuple)) else pending_res
            ctx["pending_manage_leave_count"] = len(pending_leaves)

            ProfileRequest = request.env["hrmis.employee.profile.request"].sudo()
            ctx["pending_profile_update_count"] = ProfileRequest.search_count(
                [("approver_id.user_id", "=", user.id), ("state", "=", "submitted")]
            )
        else:
            ctx["pending_manage_leave_count"] = 0
            ctx["pending_profile_update_count"] = 0
    except Exception:
        ctx["pending_manage_leave_count"] = 0
        ctx["pending_profile_update_count"] = 0
    ctx.update(extra)
    return ctx


def _can_manage_employee_leave(employee) -> bool:
    """
    Allow the employee themselves, or HR Time Off users/managers, to act.
    """
    user = request.env.user
    if not employee or not user:
        return False
    if employee.user_id and employee.user_id.id == user.id:
        return True
    # HR officers / managers (Odoo standard groups)
    return bool(
        user.has_group("hr_holidays.group_hr_holidays_user")
        or user.has_group("hr_holidays.group_hr_holidays_manager")
    )


def _pending_leave_requests_for_user(user_id: int):
    Leave = request.env["hr.leave"].sudo()
    domains = []

    # Prefer the custom sequential/parallel visibility engine when available.
    if "pending_approver_ids" in Leave._fields:
        f = Leave._fields["pending_approver_ids"]
        comodel = getattr(f, "comodel_name", None)

        # Map current user to the right ID type stored in pending_approver_ids
        if comodel == "res.users":
            approver_ids = [user_id]
        elif comodel == "hr.employee":
            emp = request.env["hr.employee"].sudo().search([("user_id", "=", user_id)], limit=1)
            approver_ids = [emp.id] if emp else [-1]
        elif comodel == "res.partner":
            user = request.env["res.users"].sudo().browse(user_id)
            approver_ids = [user.partner_id.id] if user and user.partner_id else [-1]
        else:
            # fallback (better than breaking visibility)
            approver_ids = [user_id]

        domains.append([
            ("state", "in", ("confirm", "validate1")),
            ("pending_approver_ids", "in", approver_ids),
        ])

    # OpenHRMS / validator-line engine fallback
    if "validation_status_ids" in Leave._fields and "pending_approver_ids" not in Leave._fields:
        domains.append([
            ("state", "in", ("confirm", "validate1")),
            ("validation_status_ids.user_id", "=", user_id),
            ("validation_status_ids.validation_status", "=", False),
        ])

    # Standard Odoo manager fallback
    if "employee_id" in Leave._fields:
        domains.append([("state", "=", "confirm"), ("employee_id.parent_id.user_id", "=", user_id)])

    # HR officers/managers see validate1
    if request.env.user and (
        request.env.user.has_group("hr_holidays.group_hr_holidays_user")
        or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
    ):
        domains.append([("state", "=", "validate1")])

    if not domains:
        return Leave.browse([])
    if len(domains) == 1:
        return Leave.search(domains[0], order="request_date_from desc, id desc", limit=200)

    domain = ["|"] + domains[0] + domains[1]
    for extra in domains[2:]:
        domain = ["|"] + domain + extra
    return Leave.search(domain, order="request_date_from desc, id desc", limit=200)


def _leave_pending_for_current_user(leave) -> bool:
    """Conservative check: only allow actions on leaves pending current user's approval."""
    if not leave:
        return False
    try:
        # If our custom engine is present, use it directly (fast + correct).
        if hasattr(leave.with_user(request.env.user), "is_pending_for_user"):
            return bool(leave.with_user(request.env.user).is_pending_for_user(request.env.user))
        pending = _pending_leave_requests_for_user(request.env.user.id)
        return bool(leave.id in set(pending.ids))
    except Exception:
        return False


def _allowed_leave_type_domain(employee, request_date_from=None):
    """
    Eligibility restrictions for the HRMIS website dropdown.

    Current rules:
    - Maternity Leave is visible only for female employees.
    - Maternity Leave is hidden after 3 approved maternity leaves.
    - LPR Leave is hidden after 1 pending/approved LPR leave.
    """
    domain = []
    try:
        maternity = request.env.ref("hr_holidays_updates.leave_type_maternity", raise_if_not_found=False)
        lpr = request.env.ref("hr_holidays_updates.leave_type_lpr", raise_if_not_found=False)
        # Some deployments use `gender`, others use `hrmis_gender`. Keep both.
        gender = getattr(employee, "gender", False) or getattr(employee, "hrmis_gender", False)

        Leave = request.env["hr.leave"].sudo()
        approved_states = ("validate", "validate2")

        maternity_taken = 0
        if maternity:
            maternity_taken = Leave.search_count(
                [
                    ("employee_id", "=", employee.id),
                    ("holiday_status_id", "=", maternity.id),
                    ("state", "in", approved_states),
                ]
            )

        lpr_taken = 0
        if lpr:
            lpr_taken = Leave.search_count(
                [
                    ("employee_id", "=", employee.id),
                    ("holiday_status_id", "=", lpr.id),
                    # Treat any non-cancelled/non-refused request as "taken" (pending or approved).
                    ("state", "not in", ("cancel", "refuse")),
                ]
            )

        # Maternity visibility rules
        if maternity:
            if not gender or gender != "female":
                domain.append(("id", "!=", maternity.id))
            elif maternity_taken >= 3:
                domain.append(("id", "!=", maternity.id))

        # LPR visibility rules
        if lpr:
            if lpr_taken >= 1:
                domain.append(("id", "!=", lpr.id))
    except Exception:
        # Never break the form because of an eligibility rule.
        pass
    return domain


def _leave_types_for_employee(employee, request_date_from=None):
    domain = _allowed_leave_type_domain(employee, request_date_from=request_date_from)
    request_date_from = _safe_date(request_date_from)
    # Important: keep sudo() for website rendering, but keep employee/date context
    # so the dropdown label matches backend widgets where applicable.
    recs = (
        request.env["hr.leave.type"]
        .sudo()
        .with_context(
            # Ensure balances are computed in the employee's company when multi-company
            # is enabled; otherwise Odoo may show 0 due to company mismatch.
            allowed_company_ids=[employee.company_id.id] if getattr(employee, "company_id", False) else None,
            company_id=employee.company_id.id if getattr(employee, "company_id", False) else None,
        )
        .with_context(
            employee_id=employee.id,
            default_employee_id=employee.id,
            # Ensure balance computation matches Odoo widgets
            request_type="leave",
            default_date_from=request_date_from,
            default_date_to=request_date_from,
        )
        .search(domain, order="name asc")
    )
    return recs

def _support_doc_rule_for_leave_type(leave_type):
    """
    Business rule for supporting documents.

    Returns: (required: bool, label: str)
    """
    try:
        env = request.env
        # Resolve configured leave types (ignore if missing).
        maternity = env.ref("hr_holidays_updates.leave_type_maternity", raise_if_not_found=False)
        quarantine = env.ref("hr_holidays_updates.leave_type_special_quarantine", raise_if_not_found=False)
        study_full = env.ref("hr_holidays_updates.leave_type_study_full_pay", raise_if_not_found=False)
        study_half = env.ref("hr_holidays_updates.leave_type_study_half_pay", raise_if_not_found=False)
        study_eol = env.ref("hr_holidays_updates.leave_type_study_eol", raise_if_not_found=False)
        medical = env.ref("hr_holidays_updates.leave_type_medical_long", raise_if_not_found=False)

        rules = {
            getattr(maternity, "id", None): "Medical certificate",
            getattr(quarantine, "id", None): "Quarantine order",
            getattr(study_full, "id", None): "Admission letter / Course Details",
            getattr(study_half, "id", None): "Admission letter / Course Details",
            getattr(study_eol, "id", None): "Admission letter / Course Details",
            getattr(medical, "id", None): "Medical Certificate",
        }
        label = rules.get(getattr(leave_type, "id", None))
        if label:
            return True, label
    except Exception:
        pass
    # Default: not required
    return False, ""


def _norm_leave_type_name(name: str) -> str:
    # Collapse to an ASCII-ish comparable key: lower, remove punctuation/spaces differences.
    import re

    s = (name or "").strip().lower()
    s = re.sub(r"[\u2010-\u2015]", "-", s)  # normalize unicode hyphens
    s = re.sub(r"[^a-z0-9]+", "", s)
    return s


def _dedupe_leave_types_for_ui(leave_types):
    """
    UI-only dedupe: keep first record per normalized name to avoid showing duplicates
    even if the DB has multiple leave types with near-identical names.
    """
    # Also hide specific leave types from the HRMIS dropdown (business requirement).
    blocked = {
        "compensatorydays",
        "paidtimeoff",
        "sicktimeoff",
    }
    seen = set()
    # Preserve env/context from the incoming recordset; name_get() uses context
    # (employee/date/request_type) to compute the displayed balance.
    kept = leave_types.browse([])
    for lt in leave_types:
        key = _norm_leave_type_name(lt.name)
        if not key or key in blocked or key in seen:
            continue
        seen.add(key)
        kept |= lt
    return kept


class HrmisLeaveFrontendController(http.Controller):
    def _wants_json(self) -> bool:
        """
        The leave form can be submitted via AJAX to avoid page navigation.
        """
        try:
            accept = request.httprequest.headers.get("Accept", "") or ""
            xrw = request.httprequest.headers.get("X-Requested-With", "") or ""
            return ("application/json" in accept.lower()) or (xrw.lower() == "xmlhttprequest")
        except Exception:
            return False

    def _json(self, payload: dict, status: int = 200):
        return request.make_response(
            json.dumps(payload),
            headers=[("Content-Type", "application/json")],
            status=status,
        )
    
    

    # -------------------------------------------------------------------------
    # Odoo Time Off default URLs (override to render the custom UI)
    # -------------------------------------------------------------------------
    @http.route(
        ["/odoo/time-off-overview"], type="http", auth="user", website=True
    )
    def odoo_time_off_overview(self, **kw):
        # Render the same HRMIS "Services" dashboard at the Odoo URL.
        return request.render(
            "hr_holidays_updates.hrmis_services",
            _base_ctx("Services", "services"),
        )

    @http.route(["/odoo/custom-time-off"], type="http", auth="user", website=True)
    def odoo_my_time_off(self, **kw):
        emp = _current_employee()
        if not emp:
            return request.render(
                "hr_holidays_updates.hrmis_services",
                _base_ctx("My Time Off", "services"),
            )
        # Default to history tab (matches "My Time Off")
        return request.redirect(f"/hrmis/profile/request")

    @http.route(
        ["/odoo/my-time-off/new"], type="http", auth="user", website=True
    )
    def odoo_my_time_off_new(self, **kw):
        emp = _current_employee()
        if not emp:
            return request.redirect("/odoo/my-time-off")
        # Default to new request tab (matches "New Time Off")
        return self.hrmis_leave_form(emp.id, tab="new", **kw)

    @http.route(["/hrmis", "/hrmis/"], type="http", auth="user", website=True)
    def hrmis_root(self, **kw):
        return request.redirect("/hrmis/services")

    @http.route(["/hrmis/services"], type="http", auth="user", website=True)
    def hrmis_services(self, **kw):
        return request.render(
            "hr_holidays_updates.hrmis_services",
            _base_ctx("Services", "services"),
        )

    @http.route(["/hrmis/transfer"], type="http", auth="user", website=True)
    def hrmis_transfer_requests(self, tab: str = "new", **kw):
        # Default should open "New Transfer Request" instead of history.
        # Also allow extra tabs introduced by the `hrmis_transfer` module.
        tab = (tab or "new").strip().lower()
        if tab not in ("new", "history", "requests", "status"):
            tab = "new"
        return request.render(
            "hr_holidays_updates.hrmis_transfer_requests",
            _base_ctx("Transfer Requests", "transfer_requests", tab=tab),
        )

    @http.route(["/hrmis/promotion"], type="http", auth="user", website=True)
    def hrmis_promotion_requests(self, tab: str = "history", **kw):
        tab = (tab or "history").strip().lower()
        if tab not in ("history", "new"):
            tab = "history"
        return request.render(
            "hr_holidays_updates.hrmis_promotion_requests",
            _base_ctx("Promotion Requests", "promotion_requests", tab=tab),
        )

    @http.route(["/hrmis/disciplinary"], type="http", auth="user", website=True)
    def hrmis_disciplinary_actions(self, tab: str = "history", **kw):
        tab = (tab or "history").strip().lower()
        if tab not in ("history", "new"):
            tab = "history"
        return request.render(
            "hr_holidays_updates.hrmis_disciplinary_actions",
            _base_ctx("Disciplinary Actions", "disciplinary_actions", tab=tab),
        )

    @http.route(["/hrmis/promotion"], type="http", auth="user", website=True)
    def hrmis_promotion_requests(self, tab: str = "history", **kw):
        tab = (tab or "history").strip().lower()
        if tab not in ("history", "new"):
            tab = "history"
        return request.render(
            "hr_holidays_updates.hrmis_promotion_requests",
            _base_ctx("Promotion Requests", "promotion_requests", tab=tab),
        )
    
    @http.route(["/hrmis/disciplinary"], type="http", auth="user", website=True)
    def hrmis_disciplinary_actions(self, tab: str = "history", **kw):
        tab = (tab or "history").strip().lower()
        if tab not in ("history", "new"):
            tab = "history"
        return request.render(
            "hr_holidays_updates.hrmis_disciplinary_actions",
            _base_ctx("Disciplinary Actions", "disciplinary_actions", tab=tab),
        )


    @http.route(["/hrmis/staff"], type="http", auth="user", website=True)
    def hrmis_staff_search(self, **kw):
        search_by = (kw.get("search_by") or "designation").strip()
        q = (kw.get("q") or "").strip()

        employees = request.env["hr.employee"].sudo().browse([])
        if q:
            if search_by == "cnic":
                domain = [("hrmis_cnic", "ilike", q)]
            elif search_by == "designation":
                domain = [("hrmis_designation", "ilike", q)]
            elif search_by == "district":
                domain = [("hrmis_district_id.name", "ilike", q)]
            elif search_by == "facility":
                domain = [("hrmis_facility_id.name", "ilike", q)]
            else:
                domain = ["|", ("name", "ilike", q), ("hrmis_designation", "ilike", q)]

            employees = request.env["hr.employee"].sudo().search(domain, limit=50)

        return request.render(
            "hr_holidays_updates.hrmis_staff_search",
            _base_ctx(
                "Search staff",
                "staff",
                search_by=search_by,
                q=q,
                employees=employees,
            ),
        )

    @http.route(
        ["/hrmis/staff/profile"],
        type="http",
        auth="user",
        website=True,
    )
    def hrmis_staff_profile(self, **kw):
        user = request.env.user

        # Get employee linked to logged-in user
        employee = request.env["hr.employee"].sudo().search(
            [("user_id", "=", user.id)], limit=1
        )

        if not employee:
            return request.not_found()

        active_menu = "user_profile"

        tab = (kw.get("tab") or "personal").strip().lower()
        if tab not in ("personal", "posting", "disciplinary", "qualifications"):
            tab = "personal"

        # Section Officer restrictions
        if user.has_group("custom_login.group_section_officer"):
            if tab in ("posting", "qualifications"):
                _logger.info(
                    "[HRMIS_PROFILE] Section Officer restricted tab '%s' -> forced to personal",
                    tab,
                )
                tab = "personal"

        return request.render(
            "hr_holidays_updates.hrmis_staff_profile",
            _base_ctx(
                "User profile",
                active_menu,
                employee=employee,
                tab=tab,
                service_history=getattr(
                    employee,
                    "service_history_ids",
                    request.env["hr.employee"].browse([]),
                ),
            ),
        )

    @http.route(
        ["/hrmis/staff/<int:employee_id>/services"],
        type="http",
        auth="user",
        website=True,
    )
    def hrmis_staff_services(self, employee_id: int, **kw):
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        return request.render(
            "hr_holidays_updates.hrmis_staff_services",
            _base_ctx("Services", "leave_requests", employee=employee),
        )
    from datetime import date

    @http.route(
        ["/hrmis/staff/<int:employee_id>/leave"],
        type="http",
        auth="user",
        website=True,
    )
    def hrmis_leave_form(self, employee_id: int, tab: str = "new", **kw):
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        if not _can_manage_employee_leave(employee):
            return request.redirect("/hrmis/services?error=not_allowed")

        # normalize tab
        allowed_tabs = ("new", "history", "manage_requests_msdho")
        tab = tab if tab in allowed_tabs else "new"

        # Ensure allocations exist so balances display correctly (only relevant for new/history)
        try:
            dt_leave = _safe_date(kw.get("date_from"))
            request.env["hr.leave.allocation"].sudo().hrmis_ensure_allocations_for_employees(
                employee, target_date=dt_leave
            )
        except Exception:
            pass

        dt_leave = _safe_date(kw.get("date_from"))
        leave_types = _dedupe_leave_types_for_ui(
            _leave_types_for_employee(employee, request_date_from=dt_leave)
        )

        history = request.env["hr.leave"].sudo().search(
            [("employee_id", "=", employee.id)],
            order="create_date desc, id desc",
            limit=20,
        )

        # ✅ MS/DHO manage list (only when tab is 3rd tab)
        leaves = False
        pending_manage_leave_count = 0
        if tab == "manage_requests_msdho":
            if not request.env.user.has_group("custom_login.group_ms_dho"):
                return request.not_found()

            # Keep your current logic (you can refine domain later)
            leaves = request.env["hr.leave"].sudo().search([("state", "=", "confirm")], order="create_date desc", limit=50)
            pending_manage_leave_count = len(leaves)

        error = kw.get("error")
        success = kw.get("success")
        

        return request.render(
            "hr_holidays_updates.hrmis_leave_form",
            _base_ctx(
                "Leave requests",
                "leave_requests",
                employee=employee,
                tab=tab,
                leave_types=leave_types,
                history=history,
                # ✅ add these for 3rd tab
                leaves=leaves,
                pending_manage_leave_count=pending_manage_leave_count,
                error=error,
                success=success,
                today=date.today(),
            ),
        )

    # @http.route(
    #     ["/hrmis/staff/<int:employee_id>/leave"],
    #     type="http",
    #     auth="user",
    #     website=True,
    # )
    # def hrmis_leave_form(self, employee_id: int, tab: str = "new", **kw):
    #     employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
    #     if not employee:
    #         return request.not_found()

    #     if not _can_manage_employee_leave(employee):
    #         # Avoid exposing other employees' leave UI to normal users
    #         return request.redirect("/hrmis/services?error=not_allowed")

    #     # Ensure allocations exist for this employee so balances display correctly.
    #     try:
    #         # Use the selected date to ensure future-year allocations exist so
    #         # balances do not show "0 remaining out of 0".
    #         dt_leave = _safe_date(kw.get("date_from"))
    #         request.env["hr.leave.allocation"].sudo().hrmis_ensure_allocations_for_employees(employee, target_date=dt_leave)
    #     except Exception:
    #         pass

    #     # Show leave types allowed by the same rules used in the backend UI.
    #     dt_leave = _safe_date(kw.get("date_from"))
    #     leave_types = _dedupe_leave_types_for_ui(
    #         _leave_types_for_employee(employee, request_date_from=dt_leave)
    #     )

    #     history = request.env["hr.leave"].sudo().search(
    #         [("employee_id", "=", employee.id)],
    #          order="create_date desc, id desc",
    #         limit=20,
    #     )

    #     error = kw.get("error")
    #     success = kw.get("success")
    #     return request.render(
    #         "hr_holidays_updates.hrmis_leave_form",
    #         _base_ctx(
    #             "Leave requests",
    #             "leave_requests",
    #             employee=employee,
    #             tab=tab if tab in ("new", "history") else "new",
    #             leave_types=leave_types,
    #             history=history,
    #             error=error,
    #             success=success,
    #             today=date.today(),
    #         ),
    #     )

    @http.route(
        ["/hrmis/api/leave/types"],
        type="http",
        auth="user",
        website=True,
        methods=["GET"],
        csrf=False,
    )
    def hrmis_api_leave_types(self, **kw):
        """
        Small helper endpoint for the custom UI: returns allowed leave types
        for a given employee and start date.
        """
        try:
            employee_id = _safe_int(kw.get("employee_id"))
            employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
            if not employee or not _can_manage_employee_leave(employee):
                return self._json({"ok": False, "error": "not_allowed", "leave_types": []}, status=200)

            d_from = _safe_date(kw.get("date_from"))

            # Ensure allocations exist for this employee so balances display correctly.
            try:
                request.env["hr.leave.allocation"].sudo().hrmis_ensure_allocations_for_employees(
                    employee, target_date=d_from
                )
            except Exception:
                # Keep the endpoint stable; balances might be 0/0 but the UI must still work.
                pass

            leave_types = _dedupe_leave_types_for_ui(
                _leave_types_for_employee(employee, request_date_from=d_from)
            )
            payload = {
                "ok": True,
                "leave_types": [
                    {
                        "id": lt.id,
                        # UI requirement: show only the base leave type name (no balances suffix).
                        "name": lt.name,
                        # Keep fields optional for UI compatibility.
                        # Business rule overrides (do not depend on DB fields existing/being configured).
                        **(
                            (lambda req, note: {"support_document": bool(req), "support_document_note": note})(
                                *_support_doc_rule_for_leave_type(lt)
                            )
                        ),
                    }
                    for lt in leave_types
                ],
            }
            return self._json(payload, status=200)
        except Exception:
            _logger.exception("HRMIS leave types API failed")
            return self._json({"ok": False, "error": "leave_types_failed", "leave_types": []}, status=200)

    @http.route(
        ["/hrmis/api/leave/approvers"],
        type="http",
        auth="user",
        website=True,
        methods=["GET"],
        csrf=False,
    )
    def hrmis_api_leave_approvers(self, **kw):
        """
        Return the configured approval chain for a leave type so the custom UI
        can show the approvers list immediately when a leave type is selected.
        """
        try:
            employee_id = _safe_int(kw.get("employee_id"))
            leave_type_id = _safe_int(kw.get("leave_type_id"))

            employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
            if not employee or not _can_manage_employee_leave(employee):
                return self._json({"ok": False, "error": "not_allowed", "steps": []}, status=200)

            lt = request.env["hr.leave.type"].sudo().browse(leave_type_id).exists()
            if not lt:
                return self._json({"ok": False, "error": "invalid_leave_type", "steps": []}, status=200)

            # Prefer explicit custom flows when configured.
            Flow = request.env["hr.leave.approval.flow"].sudo()
            flows = Flow.search([("leave_type_id", "=", lt.id)], order="sequence")

            def _user_info(user):
                info = {
                    "user_id": user.id,
                    "name": user.name,
                    "job_title": "",
                    "department": "",
                }
                # Best-effort: enrich with employee info when available
                emp = getattr(user, "employee_id", False)
                if emp:
                    info["job_title"] = (
                        getattr(emp, "job_title", False)
                        or (getattr(emp, "job_id", False) and emp.job_id.name)
                        or ""
                    ) or ""
                    info["department"] = (
                        (getattr(emp, "department_id", False) and emp.department_id.name) or ""
                    )
                return info

            steps = []
            if flows:
                for flow in flows:
                    approvers = []
                    if getattr(flow, "approver_line_ids", False):
                        ordered = flow.approver_line_ids.sorted(lambda l: (l.sequence, l.id))
                        for line in ordered:
                            u = line.user_id
                            if not u:
                                continue
                            approvers.append(
                                {
                                    "sequence": line.sequence,
                                    "sequence_type": line.sequence_type or (flow.mode or "sequential"),
                                    "bps_from": getattr(line, "bps_from", 0),
                                    "bps_to": getattr(line, "bps_to", 999),
                                    **_user_info(u),
                                }
                            )
                    else:
                        # Legacy fallback on the flow itself
                        for idx, u in enumerate(
                            (flow.approver_ids or request.env["res.users"]).sorted(lambda r: r.id),
                            start=1,
                        ):
                            approvers.append(
                                {
                                    "sequence": idx * 10,
                                    "sequence_type": flow.mode or "sequential",
                                    **_user_info(u),
                                }
                            )
                    if approvers:
                        steps.append({"step": flow.sequence, "approvers": approvers})

            # If no flows are configured, use the leave-type validators list (OpenHRMS).
            if (
                not steps
                and getattr(lt, "leave_validation_type", False) == "multi"
                and getattr(lt, "validator_ids", False)
            ):
                validators = lt.validator_ids.sorted(lambda v: (getattr(v, "sequence", 10), v.id))
                approvers = []
                for v in validators:
                    u = getattr(v, "user_id", False)
                    if not u:
                        continue
                    approvers.append(
                        {
                            "sequence": getattr(v, "sequence", 10),
                            "sequence_type": getattr(v, "sequence_type", False) or "sequential",
                            "bps_from": getattr(v, "bps_from", 6),
                            "bps_to": getattr(v, "bps_to", 22),
                            **_user_info(u),
                        }
                    )
                if approvers:
                    steps.append({"step": 1, "approvers": approvers})

            payload = {
                "ok": True,
                "leave_type": {"id": lt.id, "name": lt.name},
                "steps": steps,
            }
            return self._json(payload, status=200)
        except Exception:
            _logger.exception("HRMIS leave approvers API failed")
            return self._json({"ok": False, "error": "approvers_failed", "steps": []}, status=200)

    @http.route(
        ["/hrmis/staff/<int:employee_id>/leave/submit"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_leave_submit(self, employee_id: int, **post):
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        if not _can_manage_employee_leave(employee):
            msg = "You are not allowed to submit this leave request"
            if self._wants_json():
                return self._json({"ok": False, "error": msg}, status=403)
            return request.redirect("/hrmis/services?error=not_allowed")

        dt_from = (post.get("date_from") or "").strip()
        dt_to = (post.get("date_to") or "").strip()
        leave_type_id = _safe_int(post.get("leave_type_id"))
        remarks = (post.get("remarks") or "").strip()

        if not dt_from or not dt_to or not leave_type_id or not remarks:
            msg = "Please fill all required fields"
            if self._wants_json():
                return self._json({"ok": False, "error": msg}, status=400)
            return request.redirect(f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(msg)}")

        try:
            friendly_past_msg = _EXISTING_DAY_MSG
            friendly_existing_day_msg = _EXISTING_DAY_MSG
            friendly_overlap_msg = _OVERLAP_FRIENDLY_MSG

            # Validate dates early to avoid creating a record and then failing later.
            d_from = fields.Date.to_date(dt_from)
            d_to = fields.Date.to_date(dt_to)
            if not d_from or not d_to:
                msg = "Invalid date format"
                if self._wants_json():
                    return self._json({"ok": False, "error": msg}, status=400)
                return request.redirect(f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(msg)}")

            if d_to < d_from:
                msg = "End date cannot be before start date"
                if self._wants_json():
                    return self._json({"ok": False, "error": msg}, status=400)
                return request.redirect(f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(msg)}")

            # Block past days explicitly (business requirement).
            today = fields.Date.context_today(request.env.user)
            # Allow "today" (backend may still reject based on started-leave rules);
            # only block backdated requests here.
            if d_from < today or d_to < today:
                if self._wants_json():
                    return self._json({"ok": False, "error": friendly_past_msg}, status=400)
                return request.redirect(
                    f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(friendly_past_msg)}"
                )

            # Business requirement: cannot apply for any leave that includes today's date.
            if d_from <= today <= d_to:
                if self._wants_json():
                    return self._json({"ok": False, "error": friendly_existing_day_msg}, status=400)
                return request.redirect(
                    f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(friendly_existing_day_msg)}"
                )

            leave_type = request.env["hr.leave.type"].sudo().browse(leave_type_id).exists()
            if not leave_type:
                msg = "Invalid leave type"
                if self._wants_json():
                    return self._json({"ok": False, "error": msg}, status=400)
                return request.redirect(f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(msg)}")

            # Supporting document handling for the custom UI
            uploaded = request.httprequest.files.get("support_document")
            # No leave-type conditions: never block submission based on leave type.

            # Prevent creating leave over existing leave days.
            Leave = request.env["hr.leave"].sudo()
            overlap_domain = [("employee_id", "=", employee.id), ("state", "not in", ("cancel", "refuse"))]
            if "request_date_from" in Leave._fields and "request_date_to" in Leave._fields:
                overlap_domain += [("request_date_from", "<=", d_to), ("request_date_to", ">=", d_from)]
            elif "date_from" in Leave._fields and "date_to" in Leave._fields:
                # `date_from/date_to` are datetimes (can be half-day/hour-based). When the user
                # selects a date range on the website we must treat it as a full-day window,
                # otherwise comparing to midnight can miss same-day overlaps.
                dt_start = datetime.combine(d_from, time.min)
                dt_end = datetime.combine(d_to, time.max)
                overlap_domain += [("date_from", "<=", dt_end), ("date_to", ">=", dt_start)]
            if Leave.search(overlap_domain, limit=1):
                if self._wants_json():
                    return self._json({"ok": False, "error": friendly_overlap_msg}, status=400)
                return request.redirect(
                    f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(friendly_overlap_msg)}"
                )

            # IMPORTANT: use a savepoint so partial creates are rolled back on any error.
            with request.env.cr.savepoint():
                vals = {
                    "employee_id": employee.id,
                    "holiday_status_id": leave_type_id,
                    "request_date_from": dt_from,
                    "request_date_to": dt_to,
                    "name": remarks,
                }

                # Some Odoo versions hide `name` for non-HR and use `private_name` for reason.
                # Store it in both so approvers can see it.
                try:
                    if "private_name" in request.env["hr.leave"]._fields:
                        vals["private_name"] = remarks
                except Exception:
                    pass
                
                # Defer supporting-doc checks until after the upload is linked.
                leave = (
                    request.env["hr.leave"]
                    .with_user(request.env.user)
                    .with_context(hrmis_defer_support_doc_check=True)
                    .create(vals)
                )

            if uploaded:
                data = uploaded.read()
                if data:
                    att = request.env["ir.attachment"].sudo().create(
                        {
                            "name": getattr(uploaded, "filename", None) or "supporting_document",
                            "res_model": "hr.leave",
                            "res_id": leave.id,
                            "type": "binary",
                            "datas": base64.b64encode(data),
                            "mimetype": getattr(uploaded, "mimetype", None),
                        }
                    )
                    # Link it to the standard support-document field if present,
                    # so it also shows up in the native Odoo form view.
                    if "supported_attachment_ids" in leave._fields:
                        leave.sudo().write({"supported_attachment_ids": [(4, att.id)]})
                    # Also set as main attachment when available (helps quick access in some UIs).
                    if "message_main_attachment_id" in leave._fields:
                        try:
                            leave.sudo().write({"message_main_attachment_id": att.id})
                        except Exception:
                            pass

            # Confirm regardless of whether a supporting document was uploaded.
            # (Previous indentation meant many requests stayed in draft and could bypass checks.)
            if hasattr(leave, "action_confirm"):
                # Confirm WITHOUT the defer flag so validations run with attachments present.
                leave.with_context(hrmis_defer_support_doc_check=False).action_confirm()

                # Force constraint checks inside the savepoint (so failures roll back).
                request.env.cr.flush()

        except (ValidationError, UserError, AccessError, Exception) as e:
            msg = _friendly_leave_error(e)
            # If this is an overlap and it includes today, force the existing-day message.
            try:
                if msg == _OVERLAP_FRIENDLY_MSG:
                    d_from = fields.Date.to_date((post.get("date_from") or "").strip())
                    d_to = fields.Date.to_date((post.get("date_to") or "").strip())
                    today = fields.Date.context_today(request.env.user)
                    if d_from and d_to and d_from <= today <= d_to:
                        msg = _EXISTING_DAY_MSG
            except Exception:
                pass
            if self._wants_json():
                return self._json({"ok": False, "error": msg}, status=400)
            return request.redirect(f"/hrmis/staff/{employee.id}/leave?tab=new&error={quote_plus(msg)}")

        redirect_url = f"/hrmis/staff/{employee.id}/leave?tab=history&success=Leave+request+submitted"
        if self._wants_json():
            return self._json({"ok": True, "redirect": redirect_url})
        return request.redirect(redirect_url)

    @http.route(["/hrmis/leave/requests"], type="http", auth="user", website=True)
    def hrmis_leave_requests(self, **kw):
        uid = request.env.user.id
        pending = _pending_leave_requests_for_user(uid)
        return request.render(
            "hr_holidays_updates.hrmis_leave_requests",
            _base_ctx("Leave requests", "leave_requests", leaves=pending),
        )

    @http.route(
        ["/hrmis/leave/<int:leave_id>"], type="http", auth="user", website=True
    )
    def hrmis_leave_view(self, leave_id: int, **kw):
        leave = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not leave:
            return request.not_found()
        # Website exposure: only requester/creator or current pending approvers
        # should be able to view a leave request while it's awaiting approval.
        user = request.env.user
        if leave.state == "confirm":
            is_requester = bool(leave.employee_id and leave.employee_id.user_id and leave.employee_id.user_id.id == user.id)
            is_creator = bool(leave.create_uid and leave.create_uid.id == user.id)
            is_pending = _leave_pending_for_current_user(leave)
            if not (is_requester or is_creator or is_pending):
                return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")
        return request.render(
            "hr_holidays_updates.hrmis_leave_view",
            _base_ctx("Leave request", "leave_requests", leave=leave),
        )

    @http.route(
        ["/hrmis/leave/<int:leave_id>/forward"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_leave_forward(self, leave_id: int, **post):
        # Backwards-compatible alias: "Forward" used to be the only action in this UI.
        return self.hrmis_leave_approve(leave_id, **post)

    @http.route(
        ["/hrmis/leave/<int:leave_id>/approve"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_leave_approve(self, leave_id: int, **post):
        leave = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not leave:
            return request.not_found()

        if not _leave_pending_for_current_user(leave):
            return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")

        comment = (post.get("comment") or "").strip()

        try:
            # OpenHRMS multi-level approval overrides action_approve and only allows it from "confirm".
            rec = leave.with_user(request.env.user).with_context(hr_leave_approval_no_user_unlink=True)
            if rec.state == "validate1" and hasattr(rec, "action_validate"):
                # Best-effort: persist comment on the validator line (if available) and in chatter.
                if comment and hasattr(rec, "validation_status_ids"):
                    st = rec.validation_status_ids.filtered(lambda s: s.user_id.id == request.env.user.id)[:1]
                    if st:
                        st.sudo().write({"leave_comments": comment})
                    rec.sudo().message_post(
                        body=f"Comment: {comment}",
                        author_id=getattr(request.env.user, "partner_id", False) and request.env.user.partner_id.id or False,
                    )
                rec.action_validate()
            else:
                # Use our custom sequential approval, capturing optional comment.
                rec.action_approve_by_user(comment=comment or None)
        except Exception:
            _logger.exception(
                "HRMIS leave approve failed; leave_id=%s user_id=%s",
                leave_id,
                request.env.user.id,
            )
            return request.redirect("/hrmis/manage/requests?tab=leave&error=approve_failed")

        return request.redirect("/hrmis/manage/requests?tab=leave&success=Leave request approved")

    @http.route(
        ["/hrmis/leave/<int:leave_id>/refuse"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_leave_refuse(self, leave_id: int, **post):
        leave = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not leave:
            return request.not_found()

        if not _leave_pending_for_current_user(leave):
            return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")

        try:
            leave.with_user(request.env.user).action_refuse()
        except Exception:
            return request.redirect("/hrmis/manage/requests?tab=leave&error=refuse_failed")

        return request.redirect("/hrmis/manage/requests?tab=leave&success=Leave request rejected")

    @http.route(["/hrmis/manage/requests"], type="http", auth="user", website=True)
    def hrmis_manage_requests(self, tab: str = "leave", **kw):
        uid = request.env.user.id

        leaves = []
        leave_history = []

        # Pending leave requests (for "leave" tab)
        if tab == 'leave':
            leaves = _pending_leave_requests_for_user(uid)

        # History of leave requests (for "history" tab)
        elif tab == 'history':
            leave_history = request.env['hr.leave'].sudo().search(
                [('state', 'in', ['validate', 'refuse'])], order='request_date_from desc'
            )

        return request.render(
            'hr_holidays_updates.hrmis_manage_requests',
            _base_ctx(
                'Manage Requests',
                'manage_requests',
                tab=tab,
                leaves=leaves,
                leave_history=leave_history,
            )
        )
OTHER_TOKEN = "__other__"

class HrmisProfileRequestController(EmrProfileDataMixin, http.Controller):



    def _get_all_catering_mappings(self):
        """
        Master mapping dict (single source of truth).
        login -> group_name list + bps rules
        """
        return {
            "so_i":  {"group_name": ["SMO / SWMO"], "min_bps": 19, "max_bps": None},
            "so_iii":{"group_name": ["WMO"],       "min_bps": 18, "max_bps": 18},
            "so_iv": {"group_name": ["SMO"],       "min_bps": 18, "max_bps": 18},
            "so_v":  {"group_name": ["Specialist"],"min_bps": 18, "max_bps": None},
            "so_vi": {"group_name": ["WMO"],       "min_bps": 17, "max_bps": 17},
            "so_c_i":{"group_name": ["MO"],        "min_bps": 17, "max_bps": 17},
            "so_nc": {"group_name": ["Nurse"],     "min_bps": 16, "max_bps": None},
        }
    
    def _resolve_so_user_for_designation(self, designation, bps):
        """
        Uses _get_user_catering_config mapping to find which SO should handle this designation+bps.
        Returns: res.users recordset (single) or False
        """
        env = request.env

        if not designation or not designation.exists():
            return False

        grp = designation.designation_group_id
        grp_name = (grp.name or "").strip() if grp else ""
        if not grp_name:
            return False

        bps = int(bps or 0)

        # iterate mapping and pick first matching SO
        Users = env["res.users"].sudo()
        for login, cfg in (self._get_all_catering_mappings() or {}).items():
            groups = [str(g).strip() for g in (cfg.get("group_name") or [])]
            if not groups:
                continue

            # group match (case-insensitive)
            group_ok = any(grp_name.lower() == g.lower() for g in groups)
            if not group_ok:
                continue

            min_bps = cfg.get("min_bps")
            max_bps = cfg.get("max_bps")

            if min_bps is not None and bps < int(min_bps):
                continue
            if max_bps is not None and bps > int(max_bps):
                continue

            return Users.search([("login", "=", login)], limit=1)

        return False

   

    

    def _with_temporary_parent(self, employee, new_parent_employee, work_callable):
        """
        Temporarily assigns employee.parent_id and executes work_callable().
        Rolls back safely on failure.
        Returns: (True, None) on success OR (False, error_message) on failure
        """
        env = request.env
        old_parent_id = employee.parent_id.id if employee.parent_id else False

        try:
            with env.cr.savepoint():
                if new_parent_employee:
                    employee.sudo().write({"parent_id": new_parent_employee.id})

                work_callable()

            return True, None

        except Exception as e:
            # Savepoint rollback already reverts, but keep explicit revert (safe)
            if old_parent_id != (employee.parent_id.id if employee.parent_id else False):
                employee.sudo().write({"parent_id": old_parent_id})
            return False, str(e)

    def _render_profile_form(self, env, employee, req, *, error=None, success=None, info=None, prefer_draft=False):
        max_dob_str, max_today_str, max_past_str = self._build_max_date_strings(env)
        pre_fill = self._build_prefill_dict(employee, req)
        designations_unique = self._get_unique_designations(env)

        selected_district_id = (
            (pre_fill.get("district_id") if isinstance(pre_fill, dict) else None)
            or request.params.get("district_id")
        )

        districts, districts_error = self._get_emr_districts(env)
        all_facilities, facilities_meta, facilities_error = self._get_all_emr_facilities(
            env, page=1, limit=2500
        )

        emr_error = districts_error or facilities_error
        error = error or emr_error
        
        ctx = _base_ctx(
            "Profile Update Request",
            "user_profile",
            employee=employee,
            current_employee=employee,
            req=req,
            pre_fill=pre_fill,
            districts=districts,
            facilities=all_facilities,
            designations_unique=designations_unique,
            max_dob_str=max_dob_str,
            max_today_str=max_today_str,
            max_past_str=max_past_str,
            error=error,
            success=success,
            info=info,
        )

        ctx["districts_json"] = json.dumps(districts)
        ctx["facilities_json"] = json.dumps(all_facilities)
        ctx["facilities_meta_json"] = json.dumps(facilities_meta)
        ctx["selected_district_id"] = selected_district_id

        ctx = self._with_prefill_ctx(env, employee, ctx, prefer_draft=prefer_draft)

        ctx["hrmis_profile_prefill_json"] = json.dumps({
            "qual": ctx.get("prefill_qual_rows") or [],
            "post": ctx.get("prefill_post_rows") or [],
            "promo": ctx.get("prefill_promo_rows") or [],
            "leave": ctx.get("prefill_leave_rows") or [],
        })

        _logger.warning(
            "[PROFILE][RENDER] emp_id=%s req_id=%s state=%s prefer_draft=%s district_id=%s "
            "counts={qual:%s post:%s promo:%s leave:%s} districts=%s facilities=%s",
            employee.id,
            req.id,
            req.state,
            prefer_draft,
            selected_district_id,
            len(ctx.get("prefill_qual_rows") or []),
            len(ctx.get("prefill_post_rows") or []),
            len(ctx.get("prefill_promo_rows") or []),
            len(ctx.get("prefill_leave_rows") or []),
            len(districts or []),
            len(all_facilities or []),
        )

        return request.render("hr_holidays_updates.hrmis_profile_request_form", ctx)


    def _render_profile_form_error(self, employee, req, env, msg, *, prefer_draft=True):
        return self._render_profile_form(env, employee, req, error=msg, prefer_draft=prefer_draft)

    def _to_int(self, v):
        try:
            return int(v)
        except Exception:
            return False

    def _month_to_date(self, ym):
        """
        Converts 'YYYY-MM' -> 'YYYY-MM-01' (string), suitable for fields.Date
        """
        ym = (ym or "").strip()
        if not ym:
            return False
        # basic validation
        if not re.fullmatch(r"\d{4}-\d{2}", ym):
            return False
        return f"{ym}-01"

    def _validate_profile_request_post(self, post, req, env):
        """
        Validations (server-side):
        - employee id not mandatory (no check)
        - CNIC must be dashed only: 12345-1234567-1
        - DOB >= 18 years
        - Commission date not future
        - Joining date not future
        - Contact number (if provided) must start with 03 and be 11 digits
        - Merit number mandatory
        - Dropdowns: already enforced by required-fields (non-empty)
        - CNIC front/back: only required if not already uploaded on req
        """
        # -----------------------
        # CNIC dashed-only
        # -----------------------
        cnic = (post.get("hrmis_cnic") or "").strip()
        if not re.fullmatch(r"\d{5}-\d{7}-\d{1}", cnic):
            return "CNIC must be in format 12345-1234567-1"

        # -----------------------
        # Merit number required
        # -----------------------
        merit = (post.get("hrmis_merit_number") or "").strip()
        if not merit:
            return "Merit Number is required."

        # -----------------------
        # DOB must be >= 18
        # -----------------------
        dob_str = (post.get("birthday") or "").strip()
        try:
            dob = fields.Date.to_date(dob_str)
        except Exception:
            dob = None
        if not dob:
            return "Invalid Date of Birth."

        today = date.today()
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        if age < 18:
            return "Employee must be at least 18 years old."

        # -----------------------
        # Commission date not future
        # -----------------------
        comm_str = (post.get("hrmis_commission_date") or "").strip()
        try:
            comm = fields.Date.to_date(comm_str) if comm_str else None
        except Exception:
            comm = None
        if not comm:
            return "Invalid Commission Date."
        if comm > fields.Date.today():
            return "Commission Date cannot be in the future."

        # -----------------------
        # Joining date not future
        # -----------------------
        join_str = (post.get("hrmis_joining_date") or "").strip()
        try:
            join = fields.Date.to_date(join_str) if join_str else None
        except Exception:
            join = None
        if not join:
            return "Invalid Joining Date."
        if join > fields.Date.today():
            return "Joining Date cannot be in the future."

        # -----------------------
        # Contact number: must start with 03 (if provided)
        # -----------------------
        contact = (post.get("hrmis_contact_info") or "").strip()
        if contact and not re.fullmatch(r"03\d{9}", contact):
            return "Contact number must start with 03 and be 11 digits (03XXXXXXXXX)."

        # -----------------------
        # CNIC files required only if not already uploaded
        # -----------------------
        cnic_front_file = request.httprequest.files.get("hrmis_cnic_front")
        cnic_back_file = request.httprequest.files.get("hrmis_cnic_back")

        if not getattr(req, "hrmis_cnic_front", False) and not cnic_front_file:
            return "CNIC Front Scan is required."
        if not getattr(req, "hrmis_cnic_back", False) and not cnic_back_file:
            return "CNIC Back Scan is required."

        return None
    def _get_unique_designations(self, env):
        Designation = env["hrmis.designation"].sudo()
        designations = Designation.search([("active", "=", True)], order="name")

        seen = set()
        unique = []
        for d in designations:
            key = (d.name or "").strip().lower()
            if key and key not in seen:
                seen.add(key)
                unique.append(d)
        return unique

    def _build_max_date_strings(self, env):
        today = date.today()
        max_dob_str = (today - relativedelta(years=18)).strftime("%Y-%m-%d")
        max_today_str = today.strftime("%Y-%m-%d")
        max_past_str = (today - timedelta(days=1)).strftime("%Y-%m-%d")
        return max_dob_str, max_today_str, max_past_str


    def _build_prefill_dict(self, employee, req):
        # Keep behavior same: prefer req values, fallback to employee
        return {
            "hrmis_employee_id": req.hrmis_employee_id or employee.hrmis_employee_id or "",
            "hrmis_cnic": req.hrmis_cnic or employee.hrmis_cnic or "",
            "hrmis_father_name": req.hrmis_father_name or employee.hrmis_father_name or "",
            "gender": req.gender or employee.gender or "",
            "birthday": req.birthday or employee.birthday or "",
            "hrmis_commission_date": req.hrmis_commission_date or employee.hrmis_commission_date or "",
            "hrmis_joining_date": req.hrmis_joining_date or employee.hrmis_joining_date or "",
            "hrmis_bps": req.hrmis_bps or employee.hrmis_bps or "",
            "hrmis_cadre": (req.hrmis_cadre.id if req.hrmis_cadre else (employee.hrmis_cadre.id if employee.hrmis_cadre else False)),
            "hrmis_designation": (req.hrmis_designation.id if req.hrmis_designation else (employee.hrmis_designation.id if employee.hrmis_designation else False)),
            "district_id": (req.district_id if req.district_id else (employee.district_id.id if employee.district_id else False)),
            "facility_id": (req.facility_id if req.facility_id else (employee.facility_id.id if employee.facility_id else False)),
            "hrmis_contact_info": req.hrmis_contact_info or employee.hrmis_contact_info or "",
            "hrmis_merit_number": req.hrmis_merit_number or employee.hrmis_merit_number or "",
            "hrmis_leaves_taken": req.hrmis_leaves_taken if req.hrmis_leaves_taken is not False else (employee.hrmis_leaves_taken or 0),

            "hrmis_domicile": req.hrmis_domicile or employee.hrmis_domicile or "",
            "qualification": req.qualification or employee.qualification or "",
            "qualification_date": req.qualification_date or employee.qualification_date or "",
            "year_qualification": req.year_qualification or employee.year_qualification or "",
            "date_promotion": req.date_promotion or employee.date_promotion or "",
        }
   

    @http.route("/hrmis/profile/request", type="http", auth="user", website=True, methods=["GET"], csrf=False)
    def hrmis_profile_request_form(self, **kw):
        user = request.env.user
        employee = request.env["hr.employee"].sudo().search([("user_id", "=", user.id)], limit=1)
        if not employee:
            return request.render("hr_holidays_updates.hrmis_error", {"error": "No employee linked to your user."})
        
        ProfileRequest = request.env["hrmis.employee.profile.request"].sudo()
    
        req = ProfileRequest.search(
            [("employee_id", "=", employee.id), ("state", "in", ["draft", "submitted"])], limit=1
        )

        if not req:
            approver = employee.parent_id
            req = ProfileRequest.create({
                "employee_id": employee.id,
                "user_id": user.id,
                "approver_id": approver.id if approver else False,
                "state": "draft",
                "hrmis_cadre": employee.hrmis_cadre.id if employee.hrmis_cadre else False,
                "hrmis_designation": employee.hrmis_designation.id if employee.hrmis_designation else False,
                "district_id": employee.district_id.id if employee.district_id else False,
                "facility_id": employee.facility_id.id if employee.facility_id else False,
                "hrmis_merit_number": employee.hrmis_merit_number,
                "hrmis_domicile": employee.hrmis_domicile,
                "qualification": employee.qualification,
                "qualification_date": employee.qualification_date,
                "year_qualification": employee.year_qualification,
                "date_promotion": employee.date_promotion,
                "hrmis_commission_date": employee.hrmis_commission_date,
                
            })

        info = None
        if getattr(req, "state", "") == "submitted":
            info = "You already have a submitted profile update request. You cannot submit another until it is processed. You cannot submit another until it is processed."
        _logger.warning(
            "[PROFILE][GET] EMPLOYEE DATA id=%s name=%s "
            "commission_date=%s joining_date=%s birthday=%s "
            "cadre=%s designation=%s district=%s facility=%s "
            "merit=%s domicile=%s contact=%s "
            "qualification=%s qualification_date=%s year_qualification=%s promotion_date=%s",
            req.id,
            req.id,
            req.hrmis_commission_date,
            req.hrmis_joining_date,
            req.birthday,
            req.hrmis_cadre.id if req.hrmis_cadre else None,
            req.hrmis_designation.id if req.hrmis_designation else None,
            req.district_id or None,
            req.facility_id or None,
            req.hrmis_merit_number,
            req.hrmis_domicile,
            req.hrmis_contact_info,
            req.qualification,
            req.qualification_date,
            req.year_qualification,
            req.date_promotion,
        )

        return self._render_profile_form(
            request.env,
            employee,
            req,
            info=info,
            prefer_draft=False,  # GET always loads DB histories
        )
        

    def _get_default_section_officer_user(self):
        """Always route to this SO user."""
        Users = request.env["res.users"].sudo()

        so_user = Users.search([("login", "=", "devs")], limit=1)

        return so_user or False
    
    def _resolve_manager_and_approver(self, employee, designation, bps, manager_user_id=None):
        """
        Always routes to the single default SO user (devs / section_officer).
        """
        env = request.env

        so_user = self._get_default_section_officer_user()
        if not so_user:
            return False, False, "No Section Officer user found to route this request.", True

        so_emp = env["hr.employee"].sudo().search([("user_id", "=", so_user.id)], limit=1)
        if not so_emp:
            return (
                False,
                False,
                f"SO user '{so_user.login}' has no linked employee record (hr.employee.user_id).",
                True,
            )

        # final_manager_employee used for temporary parent assignment
        final_manager_employee = so_emp

        # approver is same SO employee
        approver_employee = so_emp

        return final_manager_employee, approver_employee, None, False




    # -------------------------------------------------------------------------
    # Small render helpers (keep render payloads identical)
    # -------------------------------------------------------------------------

    def _render_error_page(self, msg):
        return request.render("hr_holidays_updates.hrmis_error", {"error": msg})

    # -------------------------------------------------------------------------
    # Load/validate core records
    # -------------------------------------------------------------------------
    def _get_current_employee_or_error(self, env):
        user = env.user
        employee = env["hr.employee"].sudo().search([("user_id", "=", user.id)], limit=1)
        if not employee:
            return None, self._render_error_page("No employee linked to your user.")
        return employee, None

    def _get_request_or_form_error(self, env, employee, post):
        req_id = int(post.get("request_id") or 0)
        req = env["hrmis.employee.profile.request"].sudo().browse(req_id)
        if not req.exists():
            # keep original behavior: render the form with "Invalid request."
            return None, self._render_profile_form(env, employee, req, error="Invalid request.")
        return req, None

    # -------------------------------------------------------------------------
    # Files handling
    # -------------------------------------------------------------------------
    def _handle_cnic_files_or_error(self, employee, req, env):
        vals = {}

        cnic_front = request.httprequest.files.get("hrmis_cnic_front")
        cnic_back = request.httprequest.files.get("hrmis_cnic_back")

        if cnic_front:
            ok, err, data = _validate_upload_file(cnic_front, "CNIC Front Scan")
            if not ok:
                return None, self._render_profile_form(env, employee, req, error=err, prefer_draft=True)
            vals["hrmis_cnic_front"] = base64.b64encode(data)
            vals["hrmis_cnic_front_filename"] = cnic_front.filename

        if cnic_back:
            ok, err, data = _validate_upload_file(cnic_back, "CNIC Back Scan")
            if not ok:
                return None, self._render_profile_form(env, employee, req, error=err, prefer_draft=True)
            vals["hrmis_cnic_back"] = base64.b64encode(data)
            vals["hrmis_cnic_back_filename"] = cnic_back.filename

        return vals, None

    # -------------------------------------------------------------------------
    # Required fields validation (same rules)
    # -------------------------------------------------------------------------
    def _validate_current_posting_status_or_form_error(self, env, employee, req, post):
        status = (post.get("hrmis_current_status_frontend") or "").strip()

        if not status:
            return self._render_profile_form(
                env, employee, req,
                error="Current Posting Status: Status is required.",
                prefer_draft=True,
            )

        def empty(name):
            return not (post.get(name) or "").strip()

        errors = []

        # Common "currently posted" main block
        if status == "currently_posted":
            facility_value = (post.get("facility_id") or "").strip()
            if not facility_value:
                raw_pf = request.httprequest.form.getlist("posting_facility_id[]") or []
                facility_value = next((str(v).strip() for v in raw_pf if str(v).strip()), "")

            if empty("district_id"):
                errors.append("Substantive Posting District is required.")
            if not facility_value:
                errors.append("Facility is required.")
            if empty("hrmis_designation"):
                errors.append("Designation is required.")
            # if empty("current_posting_start"):

        elif status == "suspended":
            if empty("frontend_suspension_date"):
                errors.append("Suspension Date is required.")
            if empty("hrmis_designation"):
                errors.append("Designation is required.")
            # Reporting To / District / Facility are optional for Suspended

        elif status == "on_leave":
            if empty("frontend_onleave_start"):
                errors.append("On Leave Starting Date is required.")
            if empty("frontend_onleave_end"):
                errors.append("On Leave Ending Date is required.")
            if empty("hrmis_designation"):
                errors.append("Designation is required.")
            # Reporting To / District / Facility are optional for On Leave

        elif status == "eol_pgship":
            if empty("frontend_eol_degree"):
                errors.append("EOL Degree is required.")
            # if empty("frontend_eol_start"):
            #     errors.append("EOL Starting Date is required.")
            if empty("frontend_eol_status"):
                errors.append("EOL Status is required.")

            eol_status = (post.get("frontend_eol_status") or "").strip()
            if eol_status == "completed" and empty("frontend_eol_end"):
                errors.append("EOL Ending Date is required when status is Complete.")

            # If your EOL primary posting fields have asterisks in the form, validate them too:
            # if empty("frontend_eol_primary_district_id"):
            #     errors.append("Primary Posting District is required.")
            # if empty("frontend_eol_primary_facility_id"):
            #     errors.append("Primary Facility is required.")
            # if empty("frontend_eol_primary_designation_id"):
            #     errors.append("Primary Designation is required.")

        elif status == "reported_to_health_department":
            
            if empty("hrmis_designation"):
                errors.append("Designation is required.")

        elif status == "deputation":
            deputation_start = (post.get("frontend_deputation_start") or "").strip()
            if not deputation_start:
                errors.append("Deputation Start Date is required.")
            elif not self._month_to_date(deputation_start):
                errors.append("Deputation Start Date must be a valid month.")
            if empty("frontend_deputation_department"):
                errors.append("Deputation Department is required.")
            if empty("frontend_deputation_district_id"):
                errors.append("Deputation District is required.")
            

        # Allowed to Work conditional block
        if (post.get("allowed_to_work") or "").strip():
            if empty("allowed_district_id"):
                errors.append("Allowed To Work District is required.")
            if empty("allowed_facility_id"):
                errors.append("Allowed To Work Facility is required.")
            if empty("allowed_designation_id"):
                errors.append("Allowed To Work Designation is required.")
            if empty("allowed_start_month"):
                errors.append("Allowed To Work Start Month is required.")

        if errors:
            return self._render_profile_form(
                env,
                employee,
                req,
                error="Please complete the following Current Posting Status fields:\n• " + "\n• ".join(errors),
                prefer_draft=True,
            )

        return None
    def _validate_required_fields_or_form_error(self, env, employee, req, post):
        required_fields = {
            "hrmis_cnic": "CNIC",
            "hrmis_father_name": "Father's Name",
            "gender": "Gender",
            "hrmis_joining_date": "Joining Date",
            "hrmis_commission_date": "Commission Date",
            "hrmis_merit_number": "Merit Number",
            "hrmis_cadre": "Cadre",
            "birthday": "Date Of Birth",
            "hrmis_cnic_front": "CNIC Front Scan",
            "hrmis_cnic_back": "CNIC Back Scan",
            "hrmis_merit_number": "Merit Number",
            "hrmis_contact_info": "Contact Number",
            "hrmis_domicile": "Domicile",
        }

        missing = []
        for field, label in required_fields.items():
            if field in ("hrmis_cnic_front", "hrmis_cnic_back"):
                already = bool(getattr(req, field, False))  # already uploaded on req
                file_obj = request.httprequest.files.get(field)
                if not already and not file_obj:
                    missing.append(label)
            else:
                if not (post.get(field) or "").strip():
                    missing.append(label)

        if missing:
            return self._render_profile_form(
                env, employee, req,
                error="Please complete the following fields before submitting:\n• " + "\n• ".join(missing),
                prefer_draft=True,
            )

        return None

    def _normalize_main_facility_from_form(self, post, form):
        """
        Normalizes facility field coming from the form.

        Supports BOTH:
        - posting_facility_id
        - posting_facility_id[]

        And maps them to facility_id (which backend expects).
        """
        if (post.get("facility_id") or "").strip():
            return post

        # Case 1: new field name
        val = (post.get("posting_facility_id") or "").strip()
        if val:
            post = dict(post)
            post["facility_id"] = val
            _logger.info("[HRMIS_SUBMIT][NORMALIZE] facility_id <- posting_facility_id=%s", val)
            return post

        # Case 2: old [] array field
        arr = form.getlist("posting_facility_id[]") or []
        for v in arr:
            v = (v or "").strip()
            if v:
                post = dict(post)
                post["facility_id"] = v
                _logger.info("[HRMIS_SUBMIT][NORMALIZE] facility_id <- posting_facility_id[]=%s", v)
                return post

        _logger.warning("[HRMIS_SUBMIT][NORMALIZE] facility_id missing")
        return post

    # -------------------------------------------------------------------------
    # Parsing primitives (cadre/designation/bps + related browse)
    # -------------------------------------------------------------------------
    def _parse_designation_cadre_bps(self, env, post, facility_id=None):
        cadre_val = (post.get("hrmis_cadre") or "").strip()
        designation_val = (post.get("hrmis_designation") or "").strip()

        # BPS
        try:
            bps = int((post.get("hrmis_bps") or "0").strip() or 0)
        except Exception:
            bps = 0

        # Cadre
        if self._is_other(cadre_val):
            cadre_other = post.get("hrmis_cadre_other_name") or ""
            cadre_id = self._get_or_create_temp_cadre(env, cadre_other)
        else:
            cadre_id = self._safe_int(cadre_val) or False

        if self._is_other(designation_val):
            if not facility_id:
                facility_id = 1
                # Do NOT crash; make it a user-facing validation
                # raise ValidationError("Please select Facility before choosing Designation (Other).")
            desig_other = post.get("hrmis_designation_other_name") or ""
            designation_id = self._get_or_create_temp_designation(env, desig_other, bps, facility_id)
        else:
            designation_id = self._safe_int(designation_val) or False

        designation = env["hrmis.designation"].sudo().browse(designation_id) if designation_id else env["hrmis.designation"]
        return designation_id, cadre_id, bps, designation


    def _safe_int_or_false(self, value):
        """
        Convert incoming POST value to int.
        Return False for empty/invalid values instead of 0.
        """
        if value in (None, "", False):
            return False

        value = str(value).strip()
        if value in ("", "0", "false", "False", "null", "None"):
            return False

        try:
            return int(value)
        except (TypeError, ValueError):
            return False


    def _parse_facility_district(self, env, post):
        district_id = self._safe_int_or_false(post.get("district_id"))

        raw_facility = (post.get("posting_facility_id") or post.get("facility_id") or "").strip()
        raw_other_name = (post.get("facility_other_name") or "").strip()

        facility_id = False

        if self._is_other(raw_facility):
            if not raw_other_name:
                raise ValidationError("Facility name is required when Substantive Posting Facility is Other.")

            # Safer: do not force district mapping if your local temp facility model
            # is not aligned with EMR district IDs
            facility_id = self._get_or_create_temp_facility(env, raw_other_name, district_id or 0) or False
        else:
            facility_id = self._safe_int_or_false(raw_facility)

        return facility_id, district_id
    

    # -------------------------------------------------------------------------
    # Manager/approver resolution wrapper (keeps your existing behavior)
    # -------------------------------------------------------------------------
    def _resolve_manager_and_approver_or_form_error(self, env, employee, req, post, designation, bps):
        message_override = None

        final_manager_employee, approver_emp, message_override, hard_error = self._resolve_manager_and_approver(
            employee=employee,
            designation=designation,
            bps=bps,
            manager_user_id=int(post.get("manager_user_id") or 0),
        )

        if hard_error:
            return None, None, None, self._render_profile_form(env, employee, req, error=message_override, prefer_draft=True)


        # preserve your extra “hard” stops
        if message_override and (
            message_override.lower().startswith("so-v user")
            or message_override.lower().startswith("manager employee not found")
        ):
            return None, None, None, self._render_error_page(message_override)

        return final_manager_employee, approver_emp, message_override, None

    # -------------------------------------------------------------------------
    # Build req vals (includes leaves taken fallback, then overwritten after calc)
    # -------------------------------------------------------------------------
    def _get_posted_taken(self, post):
        try:
            return float((post.get("hrmis_leaves_taken") or "").strip() or 0.0)
        except Exception:
            return 0.0

    def _build_req_vals(self, post, *, bps, cadre_id, designation_id, district_id, facility_id, approver_emp, posted_taken):
        vals = {
            "hrmis_employee_id": post.get("hrmis_employee_id"),
            "hrmis_cnic": post.get("hrmis_cnic"),
            "hrmis_father_name": post.get("hrmis_father_name"),
            "gender": post.get("gender"),
            "birthday": post.get("birthday"),
            "hrmis_commission_date": post.get("hrmis_commission_date"),
            "hrmis_joining_date": post.get("hrmis_joining_date"),
            "hrmis_bps": bps,
            "hrmis_cadre": cadre_id,
            "hrmis_designation": designation_id,
            "district_id": district_id,
            "facility_id": facility_id,
            "hrmis_contact_info": post.get("hrmis_contact_info"),
            "hrmis_merit_number": post.get("hrmis_merit_number"),
            "hrmis_leaves_taken": posted_taken,  # fallback (server recalcs below)
            "approver_id": approver_emp.id if approver_emp else False,
            "state": "submitted",

            # NEW
            "hrmis_domicile": post.get("hrmis_domicile"),
            "qualification": post.get("qualification"),
            "qualification_date": post.get("qualification_date"),
            "year_qualification": post.get("year_qualification"),
            "date_promotion": post.get("date_promotion"),
            "hrmis_pmdc_no": post.get("hrmis_pmdc_no"),
            "hrmis_pmdc_issue_date": post.get("hrmis_pmdc_issue_date"),
            "hrmis_pmdc_expiry_date": post.get("hrmis_pmdc_expiry_date"),
            "hrmis_email": post.get("hrmis_email"),
            "hrmis_address": post.get("hrmis_address"),
            "hrmis_postal_code": post.get("hrmis_postal_code"),
            "current_posting_start": self._month_to_date(post.get("current_posting_start") or "") or False,
            "hrmis_current_status_frontend": (post.get("hrmis_current_status_frontend") or "").strip() or False,
            
        }
        return vals

    # -------------------------------------------------------------------------
    # Histories parsing (same validations/messages)
    # -------------------------------------------------------------------------
    def _parse_qualification_history_or_error(self, employee, req, env, form):
        q_degree = form.getlist("qualification_degree[]")
        q_inst = form.getlist("qualification_institute_id[]")
        q_inst_other = form.getlist("qualification_institute_other_name[]")
        q_degree_other = form.getlist("qualification_degree_other[]")
        q_spec = form.getlist("qualification_specialization[]")
        q_spec_other = form.getlist("qualification_specialization_other[]")
        q_start = form.getlist("qualification_start[]")
        q_end = form.getlist("qualification_end[]")
        q_status = form.getlist("qualification_status[]")

        allowed_degree_keys = {
            "ms", "md", "fcps_1", "fcps_2", "mcps", "diploma",
            "mbbs", "mph", "mba", "msph", "other",
        }

        # allowed_spec_keys = {
        #     "general_medicine", "family_medicine", "medicine", "emergency_medicine",
        #     "pediatrics", "pediatric_surgery", "cardiology", "neurology", "psychiatry",
        #     "dermatology", "endocrinology", "pulmonology", "nephrology", "gastroenterology",
        #     "oncology", "hematology", "general_surgery", "surgery", "neurosurgery",
        #     "plastic_surgery", "urology", "orthopedics", "gynecology",
        #     "obstetrics_gynecology", "radiology", "pathology", "anesthesia",
        #     "anesthesiology", "physiotherapy", "nutrition", "ophthalmology",
        #     "ent", "dentistry", "orthodontist", "other",
        # }
        allowed_spec_keys = {
    "general_medicine",
    "family_medicine",
    "emergency_medicine",
    "pediatrics",
    "pediatric_surgery",
    "cardiology",
    "neurology",
    "dermatology",
    "psychiatry",
    "endocrinology",
    "pulmonology",
    "nephrology",
    "gastroenterology",
    "oncology",
    "hematology",
    "general_surgery",
    "obstetrics_gynecology",
    "orthopedics",
    "ophthalmology",
    "ent",
    "neurosurgery",
    "plastic_surgery",
    "urology",
    "anesthesiology",
    "radiology",
    "pathology",
    "physiotherapy",
    "nutrition",
    "dentistry",
    "orthodontist",
    "other",
}

        qual_lines = []
        n = max(
            len(q_degree), len(q_degree_other),
            len(q_spec), len(q_spec_other),
            len(q_start), len(q_end),
            len(q_status),
        )

        for i in range(n):
            deg_raw = (q_degree[i] if i < len(q_degree) else "").strip()
            deg_other = (q_degree_other[i] if i < len(q_degree_other) else "").strip()

            spec_raw = (q_spec[i] if i < len(q_spec) else "").strip()
            spec_other = (q_spec_other[i] if i < len(q_spec_other) else "").strip()

            status = (q_status[i] if i < len(q_status) else "").strip() or "ongoing"

            s = self._month_to_date(q_start[i] if i < len(q_start) else "")
            e = self._month_to_date(q_end[i] if i < len(q_end) else "")

            # Skip fully empty row
            if not (deg_raw or deg_other or spec_raw or spec_other or s or e):
                continue

            # Degree + start month are required once row has any data
            if not deg_raw and not deg_other:
                return None, self._render_profile_form_error(
                    employee, req, env,
                    f"Qualification History (Row {i+1}): Degree is required."
                )
            if not s:
                return None, self._render_profile_form_error(
                    employee, req, env,
                    f"Qualification History (Row {i+1}): Start Month is required."
                )
            def _m2o_or_code(raw):
                raw = (raw or "").strip()
                if not raw:
                    return False, False
                try:
                    return int(raw), False
                except Exception:
                    return False, raw  # store as code

            inst_raw = q_inst[i] if i < len(q_inst) else ""
            inst_other = (q_inst_other[i] if i < len(q_inst_other) else "").strip()

            inst_id, inst_code = _m2o_or_code(inst_raw)
            
            # if “Other” typed, create like PGship does for specialization 
            if inst_other:
                inst = env["hrmis.training.institute"].sudo().create({"name": inst_other})
                inst_id = inst.id
                inst_code = False
            # Resolve degree selection
            degree_val = deg_raw
            degree_other_name = ""

            if deg_raw == "__other__":
                if not deg_other:
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Qualification History (Row {i+1}): Degree (Other) is required."
                    )
                degree_val = "other"
                degree_other_name = deg_other

            # Enforce degree key must match selection
            if degree_val not in allowed_degree_keys:
                return None, self._render_profile_form_error(
                    employee, req, env,
                    f"Qualification History (Row {i+1}): Invalid degree selected."
                )

		# Safety: enforce degree is valid selection key
            if degree_val not in (
                "ms",
                "md",
                "fcps_1",
                "fcps_2",
                "mcps",
                "diploma",
                "mbbs",
                "mph",
                "mba",
                "msph",
                "other",
            ):
                return None, self._render_profile_form_error(
                    employee, req, env,
                    "Qualification History: Invalid degree selected."
                )
            # Resolve specialization selection (IMPORTANT: specialization is a SELECTION in your model)
            spec_val = spec_raw
            spec_other_name = ""

            if spec_raw == "__other__":
                if not spec_other:
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Qualification History (Row {i+1}): Specialization (Other) is required."
                    )
                spec_val = "other"
                spec_other_name = spec_other

            # If user picked nothing, allow empty (your model specialization isn't required)
            if spec_val:
                if spec_val not in allowed_spec_keys:
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Qualification History (Row {i+1}): Invalid specialization selected."
                    )

            # If status is completed, end month required
            if status == "completed" and not e:
                return None, self._render_profile_form_error(
                    employee, req, env,
                    f"Qualification History (Row {i+1}): End Month is required when status is Completed."
                )

            qual_lines.append({
                "request_id": req.id,
                "employee_id": employee.id,
                "degree": degree_val,
                "training_institute_id": inst_id,
                "qual_institute_code": inst_code,
                "training_institute_other_name": inst_other or False,
                "degree_other_name": degree_other_name,
                "specialization": spec_val or False,                 # selection key or False
                "specialization_other_name": spec_other_name or "",  # only when specialization == 'other'
                "status": status,
                "start_date": s,
                "end_date": e or False,
            })

        return qual_lines, None


    # def _parse_posting_history_or_error(self, employee, req, env, form):
    #     p_fac_other = (
    #         form.getlist("posting_facility_other_name[]")
    #         or form.getlist("posting_facility_other_name")
    #         or form.getlist("facility_other_name")  # fallback if template used single name
    #     )
    #     p_des_other = form.getlist("posting_designation_other_name[]")
    #     p_district = form.getlist("posting_district_id[]")
    #     # ✅ Robust: accept multiple possible names for posting facility
    #     p_facility = (
    #         form.getlist("posting_facility_id[]")
    #         or form.getlist("posting_facility_id")              # fallback if [] missing
    #         or form.getlist("frontend_reporting_facility_id[]") # fallback if template used this
    #     )
    #     p_designation = form.getlist("posting_designation_id[]")
    #     p_bps = form.getlist("posting_bps[]")
    #     p_start = form.getlist("posting_start[]")
    #     p_end = form.getlist("posting_end[]")

    #     # ---------------------------------------------------------
    #     # LOG 1: raw arrays (what browser actually posted)
    #     # ---------------------------------------------------------
    #     _logger.warning(
    #         "[PROFILE][POSTING][RAW] emp_id=%s req_id=%s lens={district:%s facility:%s desig:%s bps:%s start:%s end:%s}",
    #         employee.id, req.id,
    #         len(p_district), len(p_facility), len(p_designation), len(p_bps), len(p_start), len(p_end),
    #     )
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_district_id[]=%s", p_district)
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_facility_id[]=%s", p_facility)
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_designation_id[]=%s", p_designation)
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_bps[]=%s", p_bps)
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_start[]=%s", p_start)
    #     _logger.warning("[PROFILE][POSTING][RAW] posting_end[]=%s", p_end)

    #     post_lines = []
    #     n = max(len(p_district), len(p_designation), len(p_bps), len(p_start), len(p_end), len(p_facility))

    #     _logger.warning("[PROFILE][POSTING] rows_to_process=%s", n)

    #     for i in range(n):
    #         # raw per-index (before parsing)
    #         raw_district = (p_district[i] if i < len(p_district) else "")
    #         raw_facility = (p_facility[i] if i < len(p_facility) else "").strip()
    #         raw_desig = (p_designation[i] if i < len(p_designation) else "").strip()
    #         raw_bps = (p_bps[i] if i < len(p_bps) else "")
    #         raw_start = (p_start[i] if i < len(p_start) else "")
    #         raw_end = (p_end[i] if i < len(p_end) else "")

           
    #         # parsed values
    #         district_id = self._to_int(raw_district)
    #         facility_id = self._to_int(raw_facility)
    #         designation_id = self._to_int(raw_desig)
    #         bps_val = self._to_int(raw_bps)
    #         s = self._month_to_date(raw_start)
    #         e = self._month_to_date(raw_end)

    #         if self._is_other(raw_facility):
    #             other_name = (p_fac_other[i] if i < len(p_fac_other) else "").strip()
    #             facility_id = self._get_or_create_temp_facility(env, other_name, district_id)
    #         else:
    #             facility_id = self._safe_int(raw_facility) or 0
                

            
    #         # designation (needs facility_id)
    #         # designation (needs facility_id when __other__)
    #         if self._is_other(raw_desig):
    #             other_name = (p_des_other[i] if i < len(p_des_other) else "").strip()

    #             # ✅ HARD GUARD: cannot create designation without facility
    #             if not facility_id:
    #                 _logger.warning(
    #                     "[PROFILE][POSTING][ROW %s] DESIGNATION OTHER but facility missing. raw_facility=%r p_facility_len=%s",
    #                     i, raw_facility, len(p_facility)
    #                 )
    #                 return None, self._render_profile_form_error(
    #                     employee, req, env,
    #                     f"Posting History (Row {i+1}): Facility is required when Designation is Other."
    #                 )

    #             designation_id = self._get_or_create_temp_designation(env, other_name, bps_val, facility_id)
    #         else:
    #             designation_id = self._safe_int(raw_desig) or 0

    #         # ---------------------------------------------------------
    #         # LOG 2: per row, raw + parsed
    #         # ---------------------------------------------------------
    #         _logger.warning(
    #             "[PROFILE][POSTING][ROW %s] raw={district:%r facility:%r desig:%r bps:%r start:%r end:%r}",
    #             i, raw_district, raw_facility, raw_desig, raw_bps, raw_start, raw_end
    #         )
    #         _logger.warning(
    #             "[PROFILE][POSTING][ROW %s] parsed={district_id:%s facility_id:%s designation_id:%s bps:%s start_date:%s end_date:%s}",
    #             i, district_id, facility_id, designation_id, bps_val, s, e
    #         )

    #         # skip completely empty row (same logic)
    #         # Treat a row as "started" only if any of the REQUIRED fields (or dates) exist.
    #         # Facility alone should NOT activate the row.
    #         if not (district_id or designation_id or bps_val or s or e):
    #             _logger.warning("[PROFILE][POSTING][ROW %s] skipped (no required fields; facility-only or empty)", i)
    #             continue

    #         # required fields validation (same logic)
    #         if not district_id or not designation_id or not bps_val or not s:
    #             missing = []
    #             if not district_id:
    #                 missing.append("district_id")
    #             if not designation_id:
    #                 missing.append("designation_id")
    #             if not bps_val:
    #                 missing.append("bps")
    #             if not s:
    #                 missing.append("start_month")

    #             _logger.warning(
    #                 "[PROFILE][POSTING][ROW %s] VALIDATION FAIL missing=%s parsed={district_id:%s designation_id:%s bps:%s start_date:%s}",
    #                 i, ",".join(missing), district_id, designation_id, bps_val, s
    #             )

    #             return None, self._render_profile_form_error(
    #                 employee, req, env,
    #                 "Posting History: District, Designation, BPS and Start Month are required."
    #             )

    #         # post_lines.append({
    #         #     "request_id": req.id,
    #         #     "employee_id": employee.id,
    #         #     "district_id": district_id,
    #         #     "facility_id": facility_id or False,
    #         #     "designation_id": designation_id,
    #         #     "bps": bps_val,
    #         #     "start_date": s,
    #         #     "end_date": e or False,
    #         # })
    #         post_lines.append({
    #             "request_id": req.id,          # ✅ REQUIRED
    #             "employee_id": employee.id,
    #             "district_id": district_id,
    #             "facility_id": facility_id or False,
    #             "designation_id": designation_id,
    #             "bps": bps_val,
    #             "start_date": s,
    #             "end_date": e or False,
    #         })


    #         _logger.warning("[PROFILE][POSTING][ROW %s] accepted -> %s", i, post_lines[-1])

    #     # ---------------------------------------------------------
    #     # LOG 3: final result
    #     # ---------------------------------------------------------
    #     _logger.warning("[PROFILE][POSTING] parsed_lines_count=%s lines=%s", len(post_lines), post_lines)

    #     return post_lines, None

    def _parse_posting_history_or_error(self, employee, req, env, form):
        # -----------------------------
        # 1) Read arrays (robust)
        # -----------------------------
        # p_fac_other = (
        #     form.getlist("posting_facility_other_name[]")
        #     or form.getlist("posting_facility_other_name")
        #     or form.getlist("facility_other_name")  # fallback if template used single name
        # )
        # p_des_other = (
        #     form.getlist("posting_designation_other_name[]")
        #     or form.getlist("posting_designation_other_name")
        #     or form.getlist("designation_other_name")
        # )
        p_fac_other = form.getlist("posting_facility_other_name[]")
        p_des_other = form.getlist("posting_designation_other_name[]")

        p_district = form.getlist("posting_district_id[]")
        p_facility = form.getlist("posting_facility_id[]")

        p_designation = (
            form.getlist("posting_designation_id[]")
            or form.getlist("posting_designation_id")
        )

        p_bps = (
            form.getlist("posting_bps[]")
            or form.getlist("posting_bps")
        )
        p_start = (
            form.getlist("posting_start[]")
            or form.getlist("posting_start")
        )
        p_end = (
            form.getlist("posting_end[]")
            or form.getlist("posting_end")
        )

        # -----------------------------
        # 2) Logs: raw arrays
        # -----------------------------
        _logger.warning(
            "[PROFILE][POSTING][RAW] emp_id=%s req_id=%s lens={district:%s facility:%s fac_other:%s desig:%s des_other:%s bps:%s start:%s end:%s}",
            employee.id, req.id,
            len(p_district), len(p_facility), len(p_fac_other),
            len(p_designation), len(p_des_other),
            len(p_bps), len(p_start), len(p_end),
        )
        _logger.warning("[PROFILE][POSTING][RAW] posting_district_id[]=%s", p_district)
        _logger.warning("[PROFILE][POSTING][RAW] posting_facility_id[]=%s", p_facility)
        _logger.warning("[PROFILE][POSTING][RAW] posting_facility_other_name[]=%s", p_fac_other)
        _logger.warning("[PROFILE][POSTING][RAW] posting_designation_id[]=%s", p_designation)
        _logger.warning("[PROFILE][POSTING][RAW] posting_designation_other_name[]=%s", p_des_other)
        _logger.warning("[PROFILE][POSTING][RAW] posting_bps[]=%s", p_bps)
        _logger.warning("[PROFILE][POSTING][RAW] posting_start[]=%s", p_start)
        _logger.warning("[PROFILE][POSTING][RAW] posting_end[]=%s", p_end)

        post_lines = []

        # IMPORTANT:
        # Keep n derived from the "main" columns only (same as you did),
        # but include facility/designation because they are required.
        n = max(
            len(p_district),
            len(p_facility),
            len(p_designation),
            len(p_bps),
            len(p_start),
            len(p_end),
        )
        _logger.warning("[PROFILE][POSTING] rows_to_process=%s", n)

        def _get(lst, idx, default=""):
            return (lst[idx] if idx < len(lst) else default) or default

        for i in range(n):
            # -----------------------------
            # 3) Raw per-index values
            # -----------------------------
            raw_district = _get(p_district, i, "")
            raw_facility = _get(p_facility, i, "").strip()
            raw_fac_other = _get(p_fac_other, i, "").strip()

            raw_desig = _get(p_designation, i, "").strip()
            raw_des_other = _get(p_des_other, i, "").strip()

            raw_bps = _get(p_bps, i, "")
            raw_start = _get(p_start, i, "")
            raw_end = _get(p_end, i, "")

            # -----------------------------
            # 4) Parse basic ints/dates
            # -----------------------------
            district_id = self._to_int(raw_district) or False
            bps_val = self._to_int(raw_bps) or False
            s = self._month_to_date(raw_start)
            e = self._month_to_date(raw_end)

            # We'll set these explicitly below
            facility_id = False
            designation_id = False

            # ---------------------------------------------------------
            # LOG: per row raw (including other)
            # ---------------------------------------------------------
            _logger.warning(
                "[PROFILE][POSTING][ROW %s] raw={district:%r facility:%r fac_other:%r desig:%r des_other:%r bps:%r start:%r end:%r}",
                i, raw_district, raw_facility, raw_fac_other, raw_desig, raw_des_other, raw_bps, raw_start, raw_end
            )

            # -----------------------------
            # 5) Facility handling
            # -----------------------------
            if self._is_other(raw_facility):
                # Only accept "Other" if a name exists
                if not raw_fac_other:
                    _logger.warning("[PROFILE][POSTING][ROW %s] FACILITY OTHER selected but other_name empty", i)
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Posting History (Row {i+1}): Facility name is required when Facility is Other."
                    )

                facility_id = self._get_or_create_temp_facility(env, raw_fac_other, district_id or 0) or False
                _logger.warning(
                    "[PROFILE][POSTING][ROW %s] facility OTHER -> created/linked facility_id=%s name=%r district_id=%s",
                    i, facility_id, raw_fac_other, district_id
                )
            else:
                # HARD GUARD: if not other, ignore any posted other_name (prevents 'Other selected' on refresh)
                if raw_fac_other:
                    _logger.warning(
                        "[PROFILE][POSTING][ROW %s] FACILITY not other but other_name was posted=%r -> IGNORING/CLEARING",
                        i, raw_fac_other
                    )
                facility_id = self._safe_int(raw_facility) or False

            # -----------------------------
            # 6) Designation handling
            # -----------------------------
            if self._is_other(raw_desig):
                if not raw_des_other:
                    _logger.warning("[PROFILE][POSTING][ROW %s] DESIGNATION OTHER selected but other_name empty", i)
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Posting History (Row {i+1}): Designation name is required when Designation is Other."
                    )

                # ✅ HARD GUARD: cannot create designation without facility
                if not facility_id:
                    _logger.warning(
                        "[PROFILE][POSTING][ROW %s] DESIGNATION OTHER but facility missing. raw_facility=%r",
                        i, raw_facility
                    )
                    return None, self._render_profile_form_error(
                        employee, req, env,
                        f"Posting History (Row {i+1}): Facility is required when Designation is Other."
                    )

                designation_id = self._get_or_create_temp_designation(env, raw_des_other, bps_val or 0, facility_id) or False
                _logger.warning(
                    "[PROFILE][POSTING][ROW %s] designation OTHER -> created/linked designation_id=%s name=%r facility_id=%s bps=%s",
                    i, designation_id, raw_des_other, facility_id, bps_val
                )
            else:
                if raw_des_other:
                    _logger.warning(
                        "[PROFILE][POSTING][ROW %s] DESIGNATION not other but other_name was posted=%r -> IGNORING/CLEARING",
                        i, raw_des_other
                    )
                designation_id = self._safe_int(raw_desig) or False

            # ---------------------------------------------------------
            # LOG: parsed
            # ---------------------------------------------------------
            _logger.warning(
                "[PROFILE][POSTING][ROW %s] parsed={district_id:%s facility_id:%s designation_id:%s bps:%s start_date:%s end_date:%s}",
                i, district_id, facility_id, designation_id, bps_val, s, e
            )

            # -----------------------------
            # 7) Skip empty row logic (unchanged)
            # Facility alone should NOT activate the row.
            # -----------------------------
            if not (district_id or designation_id or bps_val or s or e):
                _logger.warning("[PROFILE][POSTING][ROW %s] skipped (no required fields; facility-only or empty)", i)
                continue

            # -----------------------------
            # 8) Required fields validation (unchanged)
            # -----------------------------
            if not district_id or not designation_id or not bps_val or not s:
                missing = []
                if not district_id:
                    missing.append("district_id")
                if not designation_id:
                    missing.append("designation_id")
                if not bps_val:
                    missing.append("bps")
                if not s:
                    missing.append("start_month")

                _logger.warning(
                    "[PROFILE][POSTING][ROW %s] VALIDATION FAIL missing=%s parsed={district_id:%s designation_id:%s bps:%s start_date:%s}",
                    i, ",".join(missing), district_id, designation_id, bps_val, s
                )
                return None, self._render_profile_form_error(
                    employee, req, env,
                    "Posting History: District, Designation, BPS and Start Month are required."
                )

            # -----------------------------
            # 9) Build line (keep same structure)
            # -----------------------------
            post_lines.append({
                "request_id": req.id,          # ✅ REQUIRED
                "employee_id": employee.id,
                "district_id": district_id,
                "facility_id": facility_id or False,
                "designation_id": designation_id,
                "bps": bps_val,
                "start_date": s,
                "end_date": e or False,
            })

            _logger.warning("[PROFILE][POSTING][ROW %s] accepted -> %s", i, post_lines[-1])

        _logger.warning("[PROFILE][POSTING] parsed_lines_count=%s lines=%s", len(post_lines), post_lines)
        return post_lines, None

    def _parse_status_payload(self, env, post, form):
        status = (post.get("hrmis_current_status_frontend") or "").strip() or "currently_posted"

        def m2o_int(v):
            try:
                return int(v) if v not in (None, "", "0") else False
            except Exception:
                return False

        def _as_int(v):
            try:
                v = (v or "").strip()
                if not v or v in ("0", "__other__"):
                    return False
                return int(v)
            except Exception:
                return False

        def _m2o_or_code(raw):
            """
            Accepts:
            - '' / None / False / '__other__' => (False, False)
            - '123' => (123, False)
            - 'jpmc' => (False, 'jpmc')
            """
            if not raw:
                return False, False

            raw = str(raw).strip()
            if not raw or raw.lower() in ("false", "0") or raw == "__other__":
                return False, False

            if raw.isdigit():
                return int(raw), False

            return False, raw

        def _resolve_facility_other(raw_id, other_name, district_id):
            raw_id = (raw_id or "").strip()
            if raw_id == "__other__":
                name = (other_name or "").strip()
                if not name:
                    return False
                return self._get_or_create_temp_facility(env, name, district_id)
            return m2o_int(raw_id)

        def _resolve_designation_other(raw_id, other_name, bps_val, facility_id):
            raw_id = (raw_id or "").strip()
            if raw_id == "__other__":
                name = (other_name or "").strip()
                if not name:
                    return False
                # HARD GUARD: designation needs facility
                if not facility_id:
                    return False
                return self._get_or_create_temp_designation(env, name, bps_val, facility_id)
            return m2o_int(raw_id)

        allowed_to_work = bool(post.get("allowed_to_work"))

        # -------------------------------------------------------
        # ✅ Suspension (compute FIRST so it can be referenced safely)
        # -------------------------------------------------------
        susp_district_id = m2o_int(post.get("frontend_reporting_district_id"))

        susp_facility_id = _resolve_facility_other(
            post.get("frontend_reporting_facility_id"),
            post.get("frontend_reporting_facility_other_name"),
            susp_district_id,
        )

        susp_bps_val = int(post.get("frontend_reporting_bps") or 0) if (post.get("frontend_reporting_bps") or "").strip() else 0

        susp_designation_id = _resolve_designation_other(
            post.get("hrmis_designation"),
            post.get("frontend_reporting_designation_other_name"),
            susp_bps_val,
            susp_facility_id,
        )

        # -------------------------
        # PGship (EOL) parsing (ONLY)
        # -------------------------
        inst_raw = (post.get("frontend_eol_institute") or "").strip()
        inst_other = (post.get("frontend_eol_institute_other_name") or "").strip()
        spec_raw = (post.get("frontend_eol_specialization_id") or "").strip()
        spec_other = (post.get("frontend_eol_specialization_other_name") or "").strip()
        eol_degree_raw = (post.get("frontend_eol_degree") or "").strip()
        eol_degree_other = (post.get("frontend_eol_degree_other_name") or "").strip()

        eol_degree = False
        eol_degree_other_name = False

        if eol_degree_raw == "__other__":
            eol_degree = "other"
            eol_degree_other_name = eol_degree_other
        else:
            eol_degree = eol_degree_raw or False
            eol_degree_other_name = False
        eol_institute_id, eol_institute_code = _m2o_or_code(inst_raw)
        
        if inst_other:
            inst = env["hrmis.training.institute"].sudo().create({"name": inst_other})
            eol_institute_id = inst.id
            eol_institute_code = False 

        eol_specialization_id, eol_specialization_code = _m2o_or_code(spec_raw)

        if spec_other:
            spec = env["hrmis.training.specialization"].sudo().create({"name": spec_other})
            eol_specialization_id = spec.id
            eol_specialization_code = False
             
        allowed_district_id = m2o_int(post.get("allowed_district_id"))
        allowed_facility_id = _resolve_facility_other(
            post.get("allowed_facility_id"),
            post.get("allowed_work_facility_other_name"),
            allowed_district_id,
        )
        allowed_bps_val = int(post.get("allowed_bps") or 0) if (post.get("allowed_bps") or "").strip() else 0
        onleave_district_id = m2o_int(post.get("frontend_onleave_district_id"))
        onleave_facility_id = _resolve_facility_other(
            post.get("frontend_onleave_facility_id"),
            post.get("frontend_onleave_facility_other_name"),
            onleave_district_id,
        )

        deputation_district_id = m2o_int(post.get("frontend_deputation_district_id"))
        
        vals = {
            "status": status,

            # Suspension
            "suspension_date": post.get("frontend_suspension_date") or False,
            "suspension_reporting_to": post.get("frontend_reporting_to") or False,
            "suspension_reporting_district_id": susp_district_id,
            "suspension_reporting_facility_id": susp_facility_id,
            "suspension_reporting_designation_id": susp_designation_id,  # <-- if you added this field

            # On leave
            "onleave_type_id": m2o_int(post.get("frontend_onleave_type")),
            "onleave_start": post.get("frontend_onleave_start") or False,
            "onleave_end": post.get("frontend_onleave_end") or False,
            "onleave_reporting_to": post.get("frontend_onleave_reporting_to") or False,
            "onleave_reporting_district_id": onleave_district_id,
            "onleave_reporting_facility_id": onleave_facility_id,

            # EOL
            "eol_institute_id": eol_institute_id,
            "eol_institute_code": eol_institute_code,
            "eol_specialization_id": eol_specialization_id,
            "eol_specialization_code": eol_specialization_code,
            "eol_status": post.get("frontend_eol_status") or False,
            "eol_start": post.get("frontend_eol_start") or False,
            "eol_end": post.get("frontend_eol_end") or False,
            "eol_degree": eol_degree,
            "eol_degree_other_name": eol_degree_other_name,

            # Allowed to work
            "allowed_to_work": allowed_to_work,
            "allowed_district_id": allowed_district_id,
            "allowed_facility_id": allowed_facility_id,
            "allowed_bps": allowed_bps_val,
            "allowed_designation_id": _resolve_designation_other(
                post.get("allowed_designation_id"),
                post.get("allowed_work_designation_other_name"),
                allowed_bps_val,
                allowed_facility_id,
            ),
            "allowed_start_month": self._month_to_date(post.get("allowed_start_month") or "") or False,

            # EOL Primary Posting (as you had)
            "eol_primary_district_id": m2o_int(post.get("frontend_eol_primary_district_id")),
            "eol_primary_facility_id": m2o_int(post.get("frontend_eol_primary_facility_id")),
            "eol_primary_designation_id": m2o_int(post.get("frontend_eol_primary_designation_id")),
            "eol_primary_bps": int(post.get("frontend_eol_primary_bps") or 0) if (post.get("frontend_eol_primary_bps") or "").strip() else 0,

            # Deputation
            "deputation_start": self._month_to_date(post.get("frontend_deputation_start") or "") or False,
            "deputation_department": (post.get("frontend_deputation_department") or "").strip() or False,
            "deputation_district_id": deputation_district_id,
        }
        

        return vals

    def _upsert_posting_status(self, env, req, status_vals):
        Status = env["hrmis.profile.posting.status"].sudo()
        rec = Status.search([("request_id", "=", req.id)], limit=1)
        if rec:
            rec.write(status_vals)
            return rec
        status_vals = dict(status_vals or {})
        status_vals["request_id"] = req.id
        return Status.create(status_vals)

    def _parse_promotion_history_or_error(self, employee, req, env, form):
        pr_from = form.getlist("promotion_bps_from[]")
        pr_to = form.getlist("promotion_bps_to[]")
        pr_date = form.getlist("promotion_date[]")

        promo_lines = []
        for i in range(max(len(pr_from), len(pr_to), len(pr_date))):
            b_from = self._to_int(pr_from[i] if i < len(pr_from) else "")
            b_to = self._to_int(pr_to[i] if i < len(pr_to) else "")
            pdate = self._month_to_date(pr_date[i] if i < len(pr_date) else "")

            if not (b_from or b_to or pdate):
                continue

            if not b_from or not b_to or not pdate:
                return None, self._render_profile_form_error(
                    employee, req, env, "Promotion History: BPS From, BPS To and Promotion Month are required."
                )

            if b_to <= b_from:
                return None, self._render_profile_form_error(
                    employee, req, env, "Promotion History: BPS To must be greater than BPS From."
                )

            promo_lines.append({
                "request_id": req.id,
                "employee_id": employee.id,
                "bps_from": b_from,
                "bps_to": b_to,
                "promotion_date": pdate,
            })

        return promo_lines, None

    def _parse_leave_history_or_error(self, employee, req, env, post, form):
        l_type = form.getlist("leave_type_id[]")
        l_start = form.getlist("leave_start[]")
        l_end = form.getlist("leave_end[]")

        # Joining date boundary: disallow leaves before joining month.
        join_raw = (post.get("hrmis_joining_date") or "").strip() or getattr(employee, "hrmis_joining_date", "") or ""
        join_dt = fields.Date.to_date(join_raw) if join_raw else None
        join_month_start = None
        try:
            if join_dt:
                join_month_start = join_dt.replace(day=1)
        except Exception:
            join_month_start = None

        leave_lines = []
        leave_calc_items = []  # (leave_type_id, start_date, end_date)

        blocked_leave_type_keys = {"paidtimeoff", "sicktimeoff", "unpaid"}
        emp_gender = (
            (post.get("gender") or "")
            or (getattr(employee, "gender", False) or getattr(employee, "hrmis_gender", False) or "")
        ).strip().lower()

        for i in range(max(len(l_type), len(l_start), len(l_end))):
            leave_type_id = self._to_int(l_type[i] if i < len(l_type) else "")
            s = (l_start[i] if i < len(l_start) else "").strip()
            e = (l_end[i] if i < len(l_end) else "").strip()

            if not (leave_type_id or s or e):
                continue

            if not leave_type_id or not s or not e:
                return None, None, self._render_profile_form_error(
                    employee, req, env, "Leave History: Leave Type, Start Date and End Date are required."
                )

            # Validate leave type (blocked)
            try:
                lt = env["hr.leave.type"].sudo().browse(int(leave_type_id)).exists()
                if lt and _norm_leave_type_name(getattr(lt, "name", "")) in blocked_leave_type_keys:
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: This leave type is not allowed."
                    )
                if lt and emp_gender == "male":
                    key = _norm_leave_type_name(getattr(lt, "name", ""))
                    if "maternity" in key:
                        return None, None, self._render_profile_form_error(
                            employee, req, env, "Leave History: Maternity leave is not allowed for male employees."
                        )
            except Exception:
                pass

            # Date validations
            try:
                sd = fields.Date.to_date(s)
                ed = fields.Date.to_date(e)
                if not sd or not ed:
                    return None, None, self._render_profile_form_error(employee, req, env, "Leave History: Invalid dates.")
                if ed < sd:
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: End Date cannot be earlier than Start Date."
                    )
                if join_month_start and (sd < join_month_start or ed < join_month_start):
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: Leave dates cannot be before your joining month."
                    )
                today_ctx = fields.Date.context_today(env.user)
                if sd >= today_ctx:
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: Start Date must be before today."
                    )
                if ed > today_ctx:
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: End Date cannot be after today."
                    )
                if (ed - sd).days < 7:
                    return None, None, self._render_profile_form_error(
                        employee, req, env, "Leave History: End Date must be at least 7 days after Start Date."
                    )
            except Exception:
                return None, None, self._render_profile_form_error(employee, req, env, "Leave History: Invalid dates.")

            leave_lines.append({
                "request_id": req.id,
                "employee_id": employee.id,
                "leave_type_id": leave_type_id,
                "start_date": sd,
                "end_date": ed,
            })
            leave_calc_items.append((leave_type_id, sd, ed))

        # Block overlaps across leave history rows (no reused days).
        try:
            ranges = [(sd, ed) for (_, sd, ed) in leave_calc_items]
            ranges.sort(key=lambda r: (r[0], r[1]))
            prev_s = None
            prev_e = None
            for s0, e0 in ranges:
                if prev_s is None:
                    prev_s, prev_e = s0, e0
                    continue
                if prev_e and s0 and s0 <= prev_e:
                    return None, None, self._render_profile_form_error(
                        employee,
                        req,
                        env,
                        "Leave History: Overlapping leave dates are not allowed (you cannot reuse the same day in multiple rows).",
                    )
                prev_s, prev_e = s0, e0
        except Exception:
            pass

        return leave_lines, leave_calc_items, None

    # -------------------------------------------------------------------------
    # Leaves total calculation (unchanged)
    # -------------------------------------------------------------------------
    def _calc_total_leaves_taken_safely(self, env, leave_calc_items, posted_taken):
        try:
            import math

            total_taken = 0.0
            LeaveType = env["hr.leave.type"].sudo()

            for lt_id, sd, ed in leave_calc_items:
                lt = LeaveType.browse(int(lt_id)).exists()
                name = (lt.name or "").strip().lower() if lt else ""

                if any(k in name for k in ("medical", "maternity", "without pay", "eol", "unpaid")):
                    continue

                factor = 0.0
                if "half pay" in name:
                    factor = 0.5
                elif any(k in name for k in ("full pay", "earned", "lpr")):
                    factor = 1.0
                else:
                    continue

                eff = float((ed - sd).days + 1)
                if factor == 0.5:
                    total_taken += float(math.ceil(eff / 2.0))
                else:
                    total_taken += eff

            total_taken = round(total_taken * 2.0) / 2.0

            try:
                if float(total_taken or 0.0) == 0.0 and float(posted_taken or 0.0) > 0.0:
                    total_taken = float(posted_taken)
            except Exception:
                pass

            return total_taken
        except Exception:
            return None  # caller keeps existing

    # -------------------------------------------------------------------------
    # DB writes (histories + employee merit + request with temp parent)
    # -------------------------------------------------------------------------
    # def _replace_histories(self, env, employee,req, qual_lines, post_lines, promo_lines, leave_lines):
    #     Qual = env["hrmis.qualification.history"].sudo()
    #     Post = env["hrmis.posting.history"].sudo()
    #     Promo = env["hrmis.promotion.history"].sudo()
    #     Leave = env["hrmis.leave.history"].sudo()

    #     # Qual.search([("employee_id", "=", employee.id)]).unlink()
    #     # Post.search([("employee_id", "=", employee.id)]).unlink()
    #     # Promo.search([("employee_id", "=", employee.id)]).unlink()
    #     # Leave.search([("employee_id", "=", employee.id)]).unlink()
    #     Qual.search([("request_id", "=", req.id)]).unlink()
    #     Post.search([("request_id", "=", req.id)]).unlink()
    #     Promo.search([("request_id", "=", req.id)]).unlink()
    #     Leave.search([("request_id", "=", req.id)]).unlink()

    #     if qual_lines:
    #         Qual.create(qual_lines)
    #     if post_lines:
    #         Post.create(post_lines)
    #     if promo_lines:
    #         Promo.create(promo_lines)
    #     if leave_lines:
    #         Leave.create(leave_lines)
    def _replace_histories(self, env, req, qual_lines, post_lines, promo_lines, leave_lines):
        Qual = env["hrmis.qualification.history"].sudo()
        Post = env["hrmis.posting.history"].sudo()
        Promo = env["hrmis.promotion.history"].sudo()
        Leave = env["hrmis.leave.history"].sudo()

        # delete only current request's lines
        Qual.search([("request_id", "=", req.id)]).unlink()
        Post.search([("request_id", "=", req.id)]).unlink()
        Promo.search([("request_id", "=", req.id)]).unlink()
        Leave.search([("request_id", "=", req.id)]).unlink()

        if qual_lines:
            Qual.create(qual_lines)
        if post_lines:
            Post.create(post_lines)
        if promo_lines:
            Promo.create(promo_lines)
        if leave_lines:
            Leave.create(leave_lines)

    def _update_employee_merit(self, employee, post):
        employee.sudo().write({
            "hrmis_merit_number": (post.get("hrmis_merit_number") or "").strip() or employee.hrmis_merit_number,
        })

    def _write_req_with_temp_parent_or_form_error(self, env, employee, req, final_manager_employee, vals):
        def _work():
            req.sudo().write(vals)

        ok, err = self._with_temporary_parent(employee, final_manager_employee, _work)
        if not ok:
            return self._render_profile_form(
                env, employee, req,
                error=f"Could not submit request. Changes reverted. Error: {err}",
                prefer_draft=True,
            )

        return None

    def _ym(self, d):
        """date -> 'YYYY-MM' for <input type='month'>"""
        try:
            if not d:
                return ""
            if isinstance(d, str):
                # already formatted
                return d[:7] if len(d) >= 7 else d
            return d.strftime("%Y-%m")
        except Exception:
            return ""

    def _yd(self, d):
        """date -> 'YYYY-MM-DD' for <input type='date'>"""
        try:
            if not d:
                return ""
            if isinstance(d, str):
                return d
            return d.strftime("%Y-%m-%d")
        except Exception:
            return ""

    def _load_employee_histories(self, env, employee):
        Qual = env["hrmis.qualification.history"].sudo()
        Post = env["hrmis.posting.history"].sudo()
        Promo = env["hrmis.promotion.history"].sudo()
        Leave = env["hrmis.leave.history"].sudo()

        qual_recs = Qual.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")
        post_recs = Post.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")
        promo_recs = Promo.search([("employee_id", "=", employee.id)], order="promotion_date asc, id asc")
        leave_recs = Leave.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")

        prefill_qual = [{
            "degree": (q.degree or ""),
            "specialization": (q.specialization or ""),
            "training_institute_id": q.training_institute_id.id if q.training_institute_id else 0,
            "training_institute_code": q.qual_institute_code or "",
            "training_institute_other_name": q.training_institute_other_name or "",
            "start_month": self._ym(q.start_date),
            "end_month": self._ym(q.end_date) if q.end_date else "",
            "completed": bool(q.end_date),
        } for q in qual_recs]

        prefill_post = [{
            "district_id": q.district_id.id if q.district_id else 0,
            "facility_id": q.facility_id.id if getattr(q, "facility_id", False) else 0,
            "designation_id": q.designation_id.id if q.designation_id else 0,
            "bps": int(q.bps or 0),
            "start_month": self._ym(q.start_date),
            "end_month": self._ym(q.end_date) if q.end_date else "",
        } for q in post_recs]

        prefill_promo = [{
            "bps_from": int(p.bps_from or 0),
            "bps_to": int(p.bps_to or 0),
            "promotion_month": self._ym(p.promotion_date),
        } for p in promo_recs]

        prefill_leave = [{
            "leave_type_id": q.leave_type_id.id if q.leave_type_id else 0,
            "start_date": self._yd(q.start_date),
            "end_date": self._yd(q.end_date),
        } for q in leave_recs]

        return {
            "prefill_qual_rows": prefill_qual,
            "prefill_post_rows": prefill_post,
            "prefill_promo_rows": prefill_promo,
            "prefill_leave_rows": prefill_leave,
        }


    def _draft_histories_from_post(self):
        """
        Build prefill from the submitted form so errors don't wipe the user's input.
        Uses request.httprequest.form.getlist(...) names from your XML.
        """
        form = request.httprequest.form

        # Qualification
        q_degree = form.getlist("qualification_degree[]")
        q_spec = form.getlist("qualification_specialization[]")
        q_start = form.getlist("qualification_start[]")
        q_end = form.getlist("qualification_end[]")
        # Note: checkbox list only posts checked ones; we infer "completed" from end_month.
        draft_qual = []
        for i in range(max(len(q_degree), len(q_spec), len(q_start), len(q_end))):
            deg = (q_degree[i] if i < len(q_degree) else "").strip()
            spec = (q_spec[i] if i < len(q_spec) else "").strip()
            s = (q_start[i] if i < len(q_start) else "").strip()
            e = (q_end[i] if i < len(q_end) else "").strip()
            if not (deg or spec or s or e):
                continue
            draft_qual.append({
                "degree": deg,
                "specialization": spec,
                "start_month": s,
                "end_month": e,
                "completed": bool(e),
            })

        # Previous Posting
        p_district = form.getlist("posting_district_id[]")
        p_facility = form.getlist("posting_facility_id[]")
        if not p_facility:
            p_facility = form.getlist("frontend_reporting_facility_id[]")
        p_designation = form.getlist("posting_designation_id[]")
        p_bps = form.getlist("posting_bps[]")
        p_start = form.getlist("posting_start[]")
        p_end = form.getlist("posting_end[]")
        def _safe_int0(v):
            try:
                v = (v or "").strip()
                if not v or v == "__other__":
                    return 0
                return int(v)
            except Exception:
                return 0
            
        draft_post = []
        for i in range(max(len(p_district), len(p_facility), len(p_designation), len(p_bps), len(p_start), len(p_end))):
            draft_post.append({
                "district_id": _safe_int0(p_district[i] if i < len(p_district) else ""),
                "facility_id": _safe_int0(p_facility[i] if i < len(p_facility) else ""),
                "designation_id": _safe_int0(p_designation[i] if i < len(p_designation) else ""),
                "bps": _safe_int0(p_bps[i] if i < len(p_bps) else ""),
                "start_month": (p_start[i] if i < len(p_start) else "").strip(),
                "end_month": (p_end[i] if i < len(p_end) else "").strip(),
            })

        # Leaves
        l_type = form.getlist("leave_type_id[]")
        l_start = form.getlist("leave_start[]")
        l_end = form.getlist("leave_end[]")

        draft_leave = []
        for i in range(max(len(l_type), len(l_start), len(l_end))):
            lt = (l_type[i] if i < len(l_type) else "").strip()
            s = (l_start[i] if i < len(l_start) else "").strip()
            e = (l_end[i] if i < len(l_end) else "").strip()
            if not (lt or s or e):
                continue
            draft_leave.append({
                "leave_type_id": int(lt or 0),
                "start_date": s,
                "end_date": e,
            })

        pr_from = form.getlist("promotion_bps_from[]")
        pr_to = form.getlist("promotion_bps_to[]")
        pr_date = form.getlist("promotion_date[]")

        draft_promo = []
        for i in range(max(len(pr_from), len(pr_to), len(pr_date))):
            b_from = (pr_from[i] if i < len(pr_from) else "").strip()
            b_to = (pr_to[i] if i < len(pr_to) else "").strip()
            p_dt = (pr_date[i] if i < len(pr_date) else "").strip()
            if not (b_from or b_to or p_dt):
                continue
            draft_promo.append({
                "bps_from": int(b_from or 0),
                "bps_to": int(b_to or 0),
                "promotion_month": p_dt,  # already YYYY-MM
            })

        return {
            "draft_qual_rows": draft_qual,
            "draft_post_rows": draft_post,
            "draft_promo_rows": draft_promo,
            "draft_leave_rows": draft_leave,
        }

    def _with_prefill_ctx(self, env, employee, ctx, *, prefer_draft=False):
        db = self._load_employee_histories(env, employee)

        if prefer_draft:
            draft = self._draft_histories_from_post()
            ctx["prefill_qual_rows"] = draft["draft_qual_rows"] or db["prefill_qual_rows"]
            ctx["prefill_post_rows"] = draft["draft_post_rows"] or db["prefill_post_rows"]
            ctx["prefill_promo_rows"] = draft["draft_promo_rows"] or db["prefill_promo_rows"]
            ctx["prefill_leave_rows"] = draft["draft_leave_rows"] or db["prefill_leave_rows"]
            return ctx

        ctx.update(db)
        return ctx

    

    def _clean_name(self, s):
        return (s or "").strip()

    def _is_other(self, v):
        return (v or "").strip() == OTHER_TOKEN

    def _safe_int(self, v):
        """int('') -> 0, int('__other__') -> 0, int('12') -> 12"""
        try:
            v = (v or "").strip()
            if not v or v == OTHER_TOKEN:
                return 0
            return int(v)
        except Exception:
            return 0

    def _make_code(self, name, prefix="TEMP"):
        """
        Cadre.code is required; user didn't define a rule.
        We'll generate a stable-ish code from name.
        """
        base = re.sub(r"[^A-Za-z0-9]+", "_", (name or "").strip().upper()).strip("_")
        base = base[:20] if base else "X"
        return f"{prefix}_{base}"

    # ------------------------------------------------------------
    # TEMP record creators (match your defaults)
    # ------------------------------------------------------------

    def _get_or_create_temp_cadre(self, env, name):
        name = self._clean_name(name)
        if not name:
            return False

        Cadre = env["hrmis.cadre"].sudo()
        existing = Cadre.search([("name", "=", name)], limit=1)
        if existing:
            return existing.id

        # code required -> generate
        code = self._make_code(name, prefix="TEMP_CADRE")
        rec = Cadre.create({
            "name": name,
            "code": code,
            "active": True,
            "is_temp": True,
        })
        _logger.warning("[TEMP_CREATE] cadre created id=%s name=%r code=%r", rec.id, name, code)
        return rec.id

    def _get_or_create_temp_facility(self, env, name, district_id):
        name = self._clean_name(name)
        if not name:
            return False

        Facility = env["hrmis.facility.type"].sudo()
        domain = [("name", "=", name)]
        if district_id:
            domain.append(("district_id", "=", district_id))
        existing = Facility.search(domain, limit=1)
        if existing:
            return existing.id

        # hcu_id is forced to 1 by your requirement
        hcu = env["hrmis.healthcare.unit"].sudo().browse(1)
        if not hcu.exists():
            raise ValueError("Cannot create facility: hcu_id=1 does not exist")

        vals = {
            "name": name,
            "district_id": district_id,
            "capacity": 0,
            "facility_code": "NA",
            "category": "hospital",
            "hcu_id": 1,
            "active": True,
            "is_temp": True,
        }
        rec = Facility.create(vals)
        _logger.warning("[TEMP_CREATE] facility created id=%s name=%r district_id=%s", rec.id, name, district_id)
        return rec.id

    def _get_or_create_temp_designation(self, env, name, post_bps, facility_id):
        name = self._clean_name(name)
        if not name:
            return False
        if not facility_id:
            # Controller should validate this earlier; return False as safety.
            _logger.warning("[TEMP_CREATE] designation blocked: facility_id missing for name=%r", name)
            return False

        Designation = env["hrmis.designation"].sudo()
        existing = Designation.search([("name", "=", name), ("facility_id", "=", facility_id)], limit=1)
        if existing:
            return existing.id

        vals = {
            "name": name,
            "designation_group_id": 1,
            "total_sanctioned_posts": 1,
            "post_BPS": int(post_bps or 0) or 1,
            "facility_id": facility_id,
            "active": True,
            "is_temp": True,
            # remaining_posts is computed; do not set unless field is not computed in your actual model
        }
        rec = Designation.create(vals)
        _logger.warning("[TEMP_CREATE] designation created id=%s name=%r bps=%s facility_id=%s", rec.id, name, post_bps, facility_id)
        return rec.id
    # -------------------------------------------------------------------------
    # MAIN ROUTE (now orchestration only)
    # -------------------------------------------------------------------------
    @http.route(
        "/hrmis/profile/request/submit",
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_profile_request_submit(self, **post):
        env = request.env
        message_override = None
        form = request.httprequest.form
        post = self._normalize_main_facility_from_form(post, form)
        # 1) Employee
        employee, resp = self._get_current_employee_or_error(env)
        if resp:
            return resp

        # 2) Request
        req, resp = self._get_request_or_form_error(env, employee, post)
        if resp:
            return resp
        if req.state != "draft":
            return self._render_profile_form(
                env,
                employee,
                req,
                error="This request has already been submitted and cannot be edited.",
                prefer_draft=False,
            )
        # 3) Files
        file_vals, resp = self._handle_cnic_files_or_error(employee, req, env)
        if resp:
            return resp

        # 4) Required fields
        # 4) Required fields
        resp = self._validate_required_fields_or_form_error(env, employee, req, post)
        if resp:
            return resp

        # 4.1) Current Posting Status strict validation
        resp = self._validate_current_posting_status_or_form_error(env, employee, req, post)
        if resp:
            return resp

        # 5) Parse cadre/designation/bps + facility/district (browse kept)
        facility_id, district_id = self._parse_facility_district(env, post)
        designation_id, cadre_id, bps, designation = self._parse_designation_cadre_bps(env, post, facility_id=facility_id)
        

        # 6) Resolve manager/approver
        final_manager_employee, approver_emp, message_override, resp = self._resolve_manager_and_approver_or_form_error(
            env, employee, req, post, designation, bps
        )
        if resp:
            return resp

        # 7) Build vals (start with files + base fields)
        posted_taken = self._get_posted_taken(post)
        vals = {}
        vals.update(file_vals)
        vals.update(self._build_req_vals(
            post,
            bps=bps,
            cadre_id=cadre_id,
            designation_id=designation_id,
            district_id=district_id,
            facility_id=facility_id,
            approver_emp=approver_emp,
            posted_taken=posted_taken,
        ))

        # 8) Parse repeatable histories
        form = request.httprequest.form
        post = self._normalize_main_facility_from_form(post, form)

        _logger.info("[HRMIS_SUBMIT] req=%s user=%s(%s)", req.id, request.env.user.name, request.env.user.id)
        _logger.info("[HRMIS_SUBMIT] posted keys=%s", sorted(list(form.keys())))

        # Log all "other" fields (handles both normal and [] names)
        for k in sorted([k for k in form.keys() if "other" in (k or "").lower()]):
            other_vals = form.getlist(k)
            _logger.info("[HRMIS_SUBMIT][OTHER] %s => %s", k, other_vals)

        # Optional: log repeatable groups explicitly (useful while testing)
        def _log_list(name):
            other_vals = form.getlist(name)
            _logger.info("[HRMIS_SUBMIT][LIST] %s count=%s values=%s", name, len(other_vals), other_vals)

        # Qualifications
        _log_list("qualification_degree[]")
        _log_list("qualification_degree_other[]")
        _log_list("qualification_specialization[]")
        _log_list("qualification_specialization_other[]")
        _log_list("qualification_start[]")
        _log_list("qualification_end[]")

        # Posting
        _log_list("posting_district_id[]")
        _log_list("posting_facility_id[]")
        _log_list("posting_facility_other_name[]")
        _log_list("posting_bps[]")
        _log_list("posting_designation_id[]")
        _log_list("posting_designation_other_name[]")
        _log_list("posting_start[]")
        _log_list("posting_end[]")



        qual_lines, resp = self._parse_qualification_history_or_error(employee, req, env, form)
        if resp:
            return resp

        post_lines, resp = self._parse_posting_history_or_error(employee, req, env, form)
        if resp:
            return resp

        promo_lines, resp = self._parse_promotion_history_or_error(employee, req, env, form)
        if resp:
            return resp

        leave_lines, leave_calc_items, resp = self._parse_leave_history_or_error(employee, req, env, post, form)
        if resp:
            return resp

        # 9) Auto-calculate leaves taken (same rules)
        total_taken = self._calc_total_leaves_taken_safely(env, leave_calc_items, posted_taken)
        if total_taken is not None:
            vals["hrmis_leaves_taken"] = total_taken
        # else: keep existing vals["hrmis_leaves_taken"] (posted_taken)
        # 9.5) Save posting status box data
        status_vals = self._parse_status_payload(env, post, form)
        self._upsert_posting_status(env, req, status_vals)


        # 10) Replace histories
        # self._replace_histories(env, employee, qual_lines, post_lines, promo_lines, leave_lines)
        self._replace_histories(env, req, qual_lines, post_lines, promo_lines, leave_lines)
        # 11) Update employee merit (unchanged timing)
        self._update_employee_merit(employee, post)
        
        
        # 12) Write req inside savepoint/temp parent logic
        resp = self._write_req_with_temp_parent_or_form_error(env, employee, req, final_manager_employee, vals)
        if resp:
            return resp

        # 13) Success
        success_msg = message_override or "Profile update request submitted successfully."
        return self._render_profile_form(env, employee, req, success=success_msg)

#     @http.route(
#     "/hrmis/profile/request/submit",
#     type="http",
#     auth="user",
#     website=True,
#     methods=["POST"],
#     csrf=True,
# )
# def hrmis_profile_request_submit(self, **post):
#     from odoo.http import request

#     html = """
#     <html>
#         <head>
#             <title>Submitted Form Data</title>
#             <style>
#                 body {font-family: Arial; padding: 40px;}
#                 table {border-collapse: collapse; width: 100%%;}
#                 th, td {border: 1px solid #ddd; padding: 8px;}
#                 th {background: #f5f5f5; text-align:left;}
#             </style>
#         </head>
#         <body>
#             <h2>Submitted Fields</h2>
#             <table>
#                 <tr>
#                     <th>Field</th>
#                     <th>Value</th>
#                 </tr>
#     """

#     for key, value in post.items():
#         html += f"""
#             <tr>
#                 <td>{key}</td>
#                 <td>{value}</td>
#             </tr>
#         """

#     html += """
#             </table>
#         </body>
#     </html>
#     """

    # return request.make_response(html)

    @http.route(
        "/hrmis/profile/request/save",
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_profile_request_save(self, **post):
        env = request.env
        form = request.httprequest.form

        _logger.info("[HRMIS_SAVE] hit /hrmis/profile/request/save user=%s(%s)", env.user.name, env.user.id)

        # Keep your normalize bridge exactly like submit
        post = self._normalize_main_facility_from_form(post, form)

        # 1) Employee
        employee, resp = self._get_current_employee_or_error(env)
        if resp:
            return resp

        # 2) Request
        req, resp = self._get_request_or_form_error(env, employee, post)
        if resp:
            return resp

        if req.state != "draft":
            _logger.warning("[HRMIS_SAVE] blocked: req=%s already state=%s", req.id, req.state)
            return Response(
                json.dumps({"ok": False, "error": "This request has already been submitted and cannot be saved."}),
                content_type="application/json",
                status=400,
            )

        # 3) Files (optional on save, but if provided, validate + store)
        file_vals, resp = self._handle_cnic_files_or_error(employee, req, env)
        if resp:
            # _handle_cnic_files_or_error renders template; but for AJAX save we return JSON
            return Response(
                json.dumps({"ok": False, "error": "Invalid file upload. Please re-check CNIC files."}),
                content_type="application/json",
                status=400,
            )

        # 4) Parse facility/district + designation/cadre/bps (same logic as submit)
        facility_id, district_id = self._parse_facility_district(env, post)
        designation_id, cadre_id, bps, designation = self._parse_designation_cadre_bps(env, post, facility_id=facility_id)

        # 5) Approver handling on SAVE:
        # Do NOT force resolution/validations here. Keep current approver unless resolvable.
        approver_emp = req.approver_id
        try:
            final_manager_employee, approver_emp2, msg_override, hard_resp = self._resolve_manager_and_approver_or_form_error(
                env, employee, req, post, designation, bps
            )
            if not hard_resp and approver_emp2:
                approver_emp = approver_emp2
        except Exception as e:
            _logger.warning("[HRMIS_SAVE] approver resolve skipped: %s", e)

        # 6) Build vals, but KEEP state=draft
        posted_taken = self._get_posted_taken(post)

        vals = {}
        vals.update(file_vals)

        req_vals = self._build_req_vals(
            post,
            bps=bps,
            cadre_id=cadre_id,
            designation_id=designation_id,
            district_id=district_id,
            facility_id=facility_id,
            approver_emp=approver_emp,
            posted_taken=posted_taken,
        )
        # IMPORTANT: do not submit on save
        req_vals.pop("state", None)
        req_vals["state"] = "draft"
        vals.update(req_vals)

        # 7) Repeatable histories (same parsers; they already skip fully-empty rows)
        qual_lines, resp = self._parse_qualification_history_or_error(employee, req, env, form)
        if resp:
            return Response(json.dumps({"ok": False, "error": "Qualification rows have errors. Please fix and Save again."}),
                            content_type="application/json", status=400)

        post_lines, resp = self._parse_posting_history_or_error(employee, req, env, form)
        if resp:
            return Response(json.dumps({"ok": False, "error": "Posting history rows have errors. Please fix and Save again."}),
                            content_type="application/json", status=400)

        promo_lines, resp = self._parse_promotion_history_or_error(employee, req, env, form)
        if resp:
            return Response(json.dumps({"ok": False, "error": "Promotion rows have errors. Please fix and Save again."}),
                            content_type="application/json", status=400)

        leave_lines, leave_calc_items, resp = self._parse_leave_history_or_error(employee, req, env, post, form)
        if resp:
            return Response(json.dumps({"ok": False, "error": "Leave rows have errors. Please fix and Save again."}),
                            content_type="application/json", status=400)

        # 8) Keep leaves_taken behavior consistent (optional)
        total_taken = self._calc_total_leaves_taken_safely(env, leave_calc_items, posted_taken)
        if total_taken is not None:
            vals["hrmis_leaves_taken"] = total_taken

        # 9) Status box save (unchanged)
        try:
            status_vals = self._parse_status_payload(env, post, form)
            self._upsert_posting_status(env, req, status_vals)
        except Exception as e:
            _logger.warning("[HRMIS_SAVE] status upsert skipped: %s", e)

        # 10) Replace histories (stores against request, but they still include employee_id so your prefill can work)
        self._replace_histories(env, req, qual_lines, post_lines, promo_lines, leave_lines)

        # 11) Write request
        try:
            req.sudo().write(vals)
        except Exception as e:
            _logger.exception("[HRMIS_SAVE] write failed req=%s: %s", req.id, e)
            return Response(json.dumps({"ok": False, "error": "Could not save draft due to a server error."}),
                            content_type="application/json", status=500)

        _logger.info("[HRMIS_SAVE] saved req=%s", req.id)
        return Response(json.dumps({"ok": True, "message": "Draft saved successfully.", "request_id": req.id}),
                        content_type="application/json", status=200)
    

class HrmisProfileUpdateRequests(http.Controller):

    def _is_parent_approver(self, user, req):
        """
        Parent (manager) of employee is the approver
        """
        parent = req.employee_id.parent_id
        return bool(parent and parent.user_id and parent.user_id.id == user.id)
    
    # Section officer receives profile approval requests here
    @http.route('/hrmis/profile-update-requests', type='http', auth='user', website=True)
    def profile_update_requests(self, **kwargs):
        # Only admin and HR Manager can access
        user = request.env.user

        is_admin = user.has_group('base.group_system')
        is_hr_manager = user.has_group('hr.group_hr_manager')

        ProfileRequest = request.env['hrmis.employee.profile.request'].sudo()

        # -------------------------------------------------
        # DATA VISIBILITY
        # -------------------------------------------------
        if is_admin or is_hr_manager:
            # HR / Admin → see all
            requests = ProfileRequest.search([], order='create_date desc')
        else:
            # Approver → only assigned requests
            requests = ProfileRequest.search(
                [('approver_id.user_id', '=', user.id)],
                order='create_date desc'
            )

        # -------------------------------------------------
        # PREPARE DISPLAY DATA
        # -------------------------------------------------
        requests_for_display = []

        for req in requests:
            changes = []

            emp = req.employee_id

            if req.hrmis_employee_id != (emp.hrmis_employee_id or ''):
                changes.append(f"Employee ID: {req.hrmis_employee_id}")

            if req.hrmis_cnic != (emp.hrmis_cnic or ''):
                changes.append(f"CNIC: {req.hrmis_cnic}")

            if req.hrmis_father_name != (emp.hrmis_father_name or ''):
                changes.append(f"Father Name: {req.hrmis_father_name}")

            if req.hrmis_bps != (emp.hrmis_bps or 0):
                changes.append(f"BPS: {req.hrmis_bps}")

            #if req.hrmis_designation != (emp.hrmis_designation or ''):
            #    changes.append(f"Designation: {req.hrmis_designation}")

            requests_for_display.append({
                'id': req.id,
                'employee_name': emp.name,
                'state': req.state,
                'create_date': req.create_date,
                'changes': changes,
                'is_my_request': req.user_id.id == user.id,
                'is_my_approval': req.approver_id.user_id.id == user.id if req.approver_id else False,
            })

        return request.render(
            'hr_holidays_updates.hrmis_profile_update_requests',
            _base_ctx(
                "Profile Update Requests",
                "profile_update_requests",
                profile_update_requests=requests_for_display,
                is_admin=is_admin,
                is_hr_manager=is_hr_manager,
            ),
        )

    @http.route(
        '/hrmis/profile/request/view/<int:request_id>',
        type='http',
        auth='user',
        website=True
    )
    def profile_update_request_view(self, request_id, **kw):

        user = request.env.user
        req = request.env['hrmis.employee.profile.request'].sudo().browse(request_id)

        if not req.exists():
            return request.not_found()

        # ----------------------------
        # ACCESS CONTROL
        # ----------------------------
        is_admin = user.has_group('base.group_system')
        is_hr = user.has_group('hr.group_hr_manager')
        is_owner = user.id == req.user_id.id
        is_parent_approver = self._is_parent_approver(user, req)

        can_approve = (
            req.state in ('draft', 'submitted')
            and (
                user.has_group('hr.group_hr_manager')
                or user.has_group('base.group_system')
                or req._is_parent_approver()
            )
        )

        if not (is_admin or is_hr or is_owner or is_parent_approver):
            return request.not_found()

        # ----------------------------
        # Messages (for Bootstrap alerts)
        # ----------------------------
        error = request.params.get('error')
        success = request.params.get('success')
        info = request.params.get('info')

        error_msg = error and unquote(error)
        success_msg = success and unquote(success)
        info_msg = info and unquote(info)

        # ----------------------------
        # Facility-wise remaining seats map
        # key: (facility_id, designation_id) -> remaining_posts
        # ----------------------------
        allocs = request.env['hrmis.facility.designation'].sudo().search([])
        remaining_map = {
            (a.facility_id.id, a.designation_id.id): a.remaining_posts
            for a in allocs
        }

        return request.render(
            "hr_holidays_updates.hrmis_profile_update_request_view",
            {
                "req": req,
                "districts": self._get_emr_districts(request.env),
                "facilities": self._get_emr_facilities(request.env, page=1, limit=2000)[0],
                "cadres": request.env["hrmis.cadre"].sudo().search([]),

                # Only active designations (recommended)
                "designations": request.env["hrmis.designation"].sudo().search([('active', '=', True)], order="name"),

                # NEW: for (remaining/total) display facility-wise
                "remaining_map": remaining_map,

                # NEW: template alerts
                "error_msg": error_msg,
                "success_msg": success_msg,
                "info_msg": info_msg,

                "back_url": "/hrmis/profile-update-requests",
                "can_approve": can_approve,
            },
        )

    @http.route("/hrmis/api/facilities", type="json", auth="user", csrf=False)
    def hrmis_api_facilities(self, district_id=None, **kw):

        district_raw = (district_id or "").strip()
        District = request.env["hrmis.district.master"].sudo()

        district = False
        if district_raw.isdigit():
            district = District.browse(int(district_raw)).exists()
        elif district_raw:
            # adjust "code" to whatever field you actually use
            district = District.search([("code", "=", district_raw)], limit=1)

        resolved_district_id = district.id if district else False

        domain = [("active", "=", True)]
        if resolved_district_id:
            domain.append(("district_id", "=", resolved_district_id))

        facilities = request.env["hrmis.facility.type"].sudo().search(domain, order="name ASC")
        payload = [{"id": f.id, "name": f.name or ""} for f in facilities]

       
        return {"ok": True, "district_id": resolved_district_id, "facilities": payload}



    @http.route('/hrmis/profile/request/approve/<int:request_id>', type='http', auth='user', website=True, methods=['POST', 'GET'])
    def profile_request_approve(self, request_id, **post):
        user = request.env.user
        req = request.env['hrmis.employee.profile.request'].sudo().browse(request_id)
        if not req.exists():
            return request.not_found()

        is_admin = user.has_group('base.group_system')
        is_parent_approver = self._is_parent_approver(user, req)

        if not (is_parent_approver or is_admin):
            return request.redirect(
                f"/hrmis/profile/request/view/{req.id}?error=You are not allowed to approve this request."
            )

        if request.httprequest.method == 'GET':
            return request.render(
                'hr_holidays_updates.hrmis_profile_request_approve_form',
                {
                    'req': req,
                    'back_url': '/hrmis/profile-update-requests',
                    'districts': request.env['hrmis.district.master'].sudo().search([]),
                    'facilities': request.env['hrmis.facility.type'].sudo().search([]),
                    'cadres': request.env['hrmis.cadre'].sudo().search([]),
                    'designations': request.env['hrmis.designation'].sudo().search([('active', '=', True)]),
                }
            )

        def m2o(val):
            try:
                return int(val)
            except Exception:
                return False

        req.write({
            'hrmis_employee_id': post.get('hrmis_employee_id'),
            'hrmis_cnic': post.get('hrmis_cnic'),
            'hrmis_father_name': post.get('hrmis_father_name'),
            'gender': post.get('gender'),
            'birthday': post.get('birthday'),
            'hrmis_commission_date': post.get('hrmis_commission_date'),
            'hrmis_joining_date': post.get('hrmis_joining_date'),
            'hrmis_bps': int(post.get('hrmis_bps') or 0),
            'hrmis_cadre': m2o(post.get('hrmis_cadre')),
            'hrmis_designation': m2o(post.get('hrmis_designation')),
            'district_id': m2o(post.get('district_id')),
            'facility_id': m2o(post.get('facility_id')),
            'hrmis_contact_info': post.get('hrmis_contact_info'),
            'hrmis_leaves_taken': post.get('hrmis_leaves_taken'),
            "hrmis_merit_number": post.get('hrmis_merit_number'),
            "hrmis_cnic_front": req.hrmis_cnic_front,  # files cannot be changed by approver
            "hrmis_cnic_back": req.hrmis_cnic_back,
            'state': 'submitted',
        })

        if req.state != 'submitted':
            return request.redirect('/hrmis/profile-update-requests')

        try:
            # ----------------------------
            # 1) Validate required fields
            # ----------------------------
            if not req.facility_id or not req.hrmis_designation:
                return request.redirect(
                    f"/hrmis/profile/request/view/{req.id}?error=Facility and Designation are required to approve."
                )

            Allocation = request.env['hrmis.facility.designation'].sudo()

            # ----------------------------
            # 2) Find / create allocation row
            # ----------------------------
            allocation = Allocation.search([
                ('facility_id', '=', req.facility_id.id),
                ('designation_id', '=', req.hrmis_designation.id),
            ], limit=1)

            if not allocation:
                allocation = Allocation.create({
                    'facility_id': req.facility_id.id,
                    'designation_id': req.hrmis_designation.id,
                    'occupied_posts': 0,
                })
                request.env.flush_all()

            # ----------------------------
            # 3) Lock row + re-check seats BEFORE approving
            #    (prevents race conditions)
            # ----------------------------
            request.env.cr.execute(
                "SELECT id FROM hrmis_facility_designation WHERE id=%s FOR UPDATE",
                (allocation.id,)
            )
            request.env.flush_all()
            allocation = Allocation.browse(allocation.id)

            if allocation.remaining_posts <= 0:
                return request.redirect(
                    f"/hrmis/profile/request/view/{req.id}?error=No remaining posts for this designation in this facility."
                )

            # ----------------------------
            # 4) Reserve the seat (increment occupied) FIRST
            # ----------------------------
            allocation.write({'occupied_posts': allocation.occupied_posts + 1})
            request.env.flush_all()

            # ----------------------------
            # 5) Now approve the request
            # ----------------------------
            req.action_approve()
            request.env.flush_all()

        except Exception as e:
            return request.redirect(f"/hrmis/profile/request/view/{req.id}?error={str(e)}")

        return request.redirect('/hrmis/profile-update-requests')


    @http.route('/hrmis/profile/request/reject/<int:request_id>', type='http', auth='user', website=True)
    def profile_request_reject(self, request_id, **kwargs):
        user = request.env.user
        req = request.env['hrmis.employee.profile.request'].sudo().browse(request_id)

        if not req.exists():
            return request.not_found()

        # ACCESS CONTROL (match your approve logic)
        is_hr = user.has_group('hr.group_hr_manager')
        is_admin = user.has_group('base.group_system')
        is_parent = self._is_parent_approver(user, req)

        if not (is_hr or is_admin or is_parent):
            return request.redirect(
                f"/hrmis/profile/request/view/{req.id}?error=You are not allowed to reject this request."
            )

        # Prevent self reject (same as model rule)
        if req.user_id == user:
            return request.redirect(
                f"/hrmis/profile/request/view/{req.id}?error=You cannot reject your own profile update request."
            )

        # STATE PROTECTION
        if req.state != 'submitted':
            return request.redirect('/hrmis/profile-update-requests')

        # ACTION
        try:
            req.action_reject()  # uses your model method (good)
        except Exception as e:
            return request.redirect(
                f"/hrmis/profile/request/view/{req.id}?error={str(e)}"
            )

        return request.redirect('/hrmis/profile-update-requests')


    # def _normalize_main_facility_from_form(self, post, form):
    #     """
    #     Normalize facility fields between `post` and raw `form` dicts.
    #     This MUST be safe/no-op if keys aren't present.
    #     """
    #     post = dict(post or {})
    #     try:
    #         form = form or {}

    #         _logger.info(
    #             "[HRMIS_NORM] before: post_keys=%s form_keys=%s",
    #             list(post.keys())[:40],
    #             list(form.keys())[:40],
    #         )

    #         # Example normalization patterns — adjust the exact keys to your form names
    #         # (keep it harmless: only fill missing values, do NOT overwrite)
    #         candidates = [
    #             ("hrmis_main_facility_id", "hrmis_main_facility_id"),
    #             ("main_facility_id", "main_facility_id"),
    #             ("hrmis_facility_id", "hrmis_facility_id"),
    #             ("facility_id", "facility_id"),
    #         ]

    #         for post_key, form_key in candidates:
    #             if not post.get(post_key) and form.get(form_key):
    #                 post[post_key] = form.get(form_key)
    #                 _logger.info("[HRMIS_NORM] filled %s from form[%s]=%s", post_key, form_key, post[post_key])

    #         _logger.info("[HRMIS_NORM] after: main facility normalized")
    #         return post

    #     except Exception as e:
    #         _logger.exception("[HRMIS_NORM] failed, returning original post: %s", e)
    #         return post
        
    