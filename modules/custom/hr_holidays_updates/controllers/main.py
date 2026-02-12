# -*- coding: utf-8 -*-
from __future__ import annotations
import base64

from datetime import date
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
    # This ensures only the *current* pending approver(s) see the request.
    if "pending_approver_ids" in Leave._fields:
        # Some deployments use 'validate1' as an intermediate "still pending final approval" state.
        domains.append([("state", "in", ("confirm", "validate1")), ("pending_approver_ids", "in", [user_id])])
    # OpenHRMS multi-level approval: show only requests where current user is a validator
    # and has NOT yet approved.
    if "validation_status_ids" in Leave._fields and "pending_approver_ids" not in Leave._fields:
        domains.append(
            [
                ("state", "=", "confirm"),
                ("validation_status_ids.user_id", "=", user_id),
                ("validation_status_ids.validation_status", "=", False),
            ]
        )

    # Standard Odoo manager approval fallback (useful if validation_status_ids is absent
    # or leave types aren't configured with validators).
    if "employee_id" in Leave._fields:
        domains.append([("state", "=", "confirm"), ("employee_id.parent_id.user_id", "=", user_id)])

    # Second-stage approvals (Odoo standard "validate1" => "validate") are usually handled
    # by Time Off officers/managers. Without this, those requests won't show up in Manage Requests.
    if (
        request.env.user
        and (
            request.env.user.has_group("hr_holidays.group_hr_holidays_user")
            or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
        )
    ):
        # Be permissive across versions: some builds gate validate1 by validation_type,
        # others don't. Showing validate1 to HR users matches Odoo's "To Approve" behavior.
        domains.append([("state", "=", "validate1")])

    if not domains:
        return Leave.browse([])
    if len(domains) == 1:
        return Leave.search(domains[0], order="request_date_from desc, id desc", limit=200)
    # OR the domains
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
        "unpaid",
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
        return request.redirect(f"/hrmis/staff/{emp.id}")

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
        ["/hrmis/staff/<int:employee_id>"], type="http", auth="user", website=True
    )
    def hrmis_staff_profile(self, employee_id: int, **kw):
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        current_emp = _current_employee()
        active_menu = (
            "user_profile"
            if current_emp and current_emp.id == employee.id
            else "staff"
            
        )
        tab = (kw.get("tab") or "personal").strip().lower()
        if tab not in ("personal", "posting", "disciplinary", "qualifications"):
            tab = "personal"

        if request.env.user.has_group("custom_login.group_section_officer"):
            if tab in ("posting", "qualifications"):
                tab = "personal"
        return request.render(
            "hr_holidays_updates.hrmis_staff_profile",
            # _base_ctx("User profile", active_menu, employee=employee),
            _base_ctx(
                "User profile",
                active_menu,
                employee=employee,
                tab=tab,
                # Used by the template to decide whether to show the service history table.
                service_history=getattr(employee, "service_history_ids", request.env["hr.employee"].browse([])),
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

class HrmisProfileRequestController(http.Controller):



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

    # def _resolve_manager_and_approver(self, employee, designation, bps, manager_user_id=None):
    #     """
    #     Mapping-driven approver resolution.
    #     No facility logic, no hardcoded specialist logic.

    #     Returns:
    #         final_manager_employee (hr.employee or False)
    #         approver_employee (hr.employee or False)
    #         message_override (str or None)
    #         hard_error (bool)
    #     """
    #     env = request.env
    #     message_override = None

    #     # 1) Try mapped SO from designation group + bps
    #     mapped_so_user = self._resolve_so_user_for_designation(designation, bps)

    #     final_manager_user = mapped_so_user or False

    #     # 2) If no mapped SO found:
    #     #    - If employee already has parent => keep it and allow submission
    #     #    - Otherwise block
    #     if not final_manager_user:
    #         if employee.parent_id:
    #             message_override = "The assignment of this user to its SO remains."
    #             approver_employee = employee.parent_id
    #             return False, approver_employee, message_override, False
    #         return False, False, "Current designation has no SO available.", True

    #     # 3) Convert mapped user -> hr.employee
    #     final_manager_employee = env["hr.employee"].sudo().search(
    #         [("user_id", "=", final_manager_user.id)],
    #         limit=1
    #     )
    #     if not final_manager_employee:
    #         return (
    #             False,
    #             False,
    #             f"Current designation has no SO available (no employee record for user: {final_manager_user.login}).",
    #             True,
    #         )

    #     # 4) Approver is the mapped SO employee
    #     approver_employee = final_manager_employee

    #     # 5) HARD BLOCK (extra safety)
    #     if not approver_employee:
    #         return False, False, "Current designation has no SO available.", True

    #     return final_manager_employee, approver_employee, message_override, False

    

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

    def _render_profile_form_error(self, employee, req, env, msg):
        return request.render(
            "hr_holidays_updates.hrmis_profile_request_form",
            _base_ctx(
                "Profile Update Request",
                "user_profile",
                employee=employee,
                current_employee=employee,
                req=req,
                districts=env["hrmis.district.master"].sudo().search([]),
                facilities=env["hrmis.facility.type"].sudo().search([]),
                designations_unique=self._get_unique_designations(env),
                error=msg,
            ),
        )

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


    @http.route("/hrmis/profile/request", type="http", auth="user", website=True, methods=["GET"], csrf=False)
    def hrmis_profile_request_form(self, **kw):
        user = request.env.user
        employee = request.env["hr.employee"].sudo().search([("user_id", "=", user.id)], limit=1)
        if not employee:
            return request.render("hr_holidays_updates.hrmis_error", {"error": "No employee linked to your user."})
        today = date.today()
        max_dob_str = (today - relativedelta(years=18)).strftime("%Y-%m-%d")
        max_today_str = today.strftime("%Y-%m-%d")   # for commission/joining max
        # Leave History rows must not allow today/future dates
        max_past_str = (today - relativedelta(days=1)).strftime("%Y-%m-%d")

        ProfileRequest = request.env["hrmis.employee.profile.request"].sudo()
        Post = request.env["hrmis.posting.history"].sudo()
        Qual = request.env["hrmis.qualification.history"].sudo()
        Promo = request.env["hrmis.promotion.history"].sudo()
        Leave = request.env["hrmis.leave.history"].sudo()

        posting_lines = Post.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")
        qualification_lines = Qual.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")
        promotion_lines = Promo.search([("employee_id", "=", employee.id)], order="promotion_date asc, id asc")
        leave_lines = Leave.search([("employee_id", "=", employee.id)], order="start_date asc, id asc")

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

                
            })

        # Pre-fill dictionary (for form rendering)
        pre_fill = {
            "hrmis_employee_id": employee.hrmis_employee_id or "",
            "hrmis_cnic": employee.hrmis_cnic or "",
            "hrmis_father_name": employee.hrmis_father_name or "",
            "gender": employee.gender or "",
            "hrmis_joining_date": employee.hrmis_joining_date or "",
            "hrmis_bps": employee.hrmis_bps or "",
            "hrmis_cadre": req.hrmis_cadre.id if req.hrmis_cadre else False,
            "hrmis_designation": req.hrmis_designation.id if req.hrmis_designation else False,
            "district_id": req.district_id.id if req.district_id else False,
            "facility_id": req.facility_id.id if req.facility_id else False,
            "hrmis_contact_info": employee.hrmis_contact_info or "",
            "birthday": employee.birthday or "",
            "commission_date": employee.hrmis_commission_date or "",
            "hrmis_leaves_taken": employee.hrmis_leaves_taken or "",
            "hrmis_merit_number": employee.hrmis_merit_number or "",
            "hrmis_cnic_front": req.hrmis_cnic_front_filename if req.hrmis_cnic_front else "",
            "hrmis_cnic_back": req.hrmis_cnic_back_filename if req.hrmis_cnic_back else "",
            # NEW
            "hrmis_domicile": employee.hrmis_domicile or "",
            "qualification": employee.qualification or "",
            "qualification_date": employee.qualification_date or "",
            "year_qualification": employee.year_qualification or "",
            "date_promotion": employee.date_promotion or "",

        }

        info = None
        if getattr(req, "state", "") == "submitted":
            info = (
                "You already have a submitted profile update request. "
                "You cannot submit another until it is processed."
            )

        return request.render(
            "hr_holidays_updates.hrmis_profile_request_form",
            _base_ctx(
                "Profile Update Request",
                "user_profile",
                employee=employee,
                current_employee=employee,
                req=req,
                pre_fill=pre_fill,
                districts=request.env["hrmis.district.master"].sudo().search([]),
                facilities=request.env["hrmis.facility.type"].sudo().search([]),
                posting_lines=posting_lines,
                qualification_lines=qualification_lines,
                promotion_lines=promotion_lines,
                leave_lines=leave_lines,

                designations_unique=self._get_unique_designations(request.env),
                info=info,
                max_dob_str=max_dob_str,
                max_today_str=max_today_str,
                max_past_str=max_past_str,
            ),
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




    # It submits the employees profile update request
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
        user = env.user

        message_override = None
        
        employee = env["hr.employee"].sudo().search([("user_id", "=", user.id)], limit=1)
        if not employee:
            return request.render("hr_holidays_updates.hrmis_error", {"error": "No employee linked to your user."})

        req = env["hrmis.employee.profile.request"].sudo().browse(int(post.get("request_id") or 0))
        if not req.exists():
            return request.render(
                "hr_holidays_updates.hrmis_profile_request_form",
                _base_ctx(
                    "Profile Update Request",
                    "user_profile",
                    employee=employee,
                    current_employee=employee,
                    req=req,
                    districts=env["hrmis.district.master"].sudo().search([]),
                    facilities=env["hrmis.facility.type"].sudo().search([]),
                    error="Invalid request.",
                ),
            )

        # -----------------------
        # Files
        # -----------------------
        cnic_front = request.httprequest.files.get("hrmis_cnic_front")
        cnic_back = request.httprequest.files.get("hrmis_cnic_back")

        vals = {}

        if cnic_front:
            vals["hrmis_cnic_front"] = base64.b64encode(cnic_front.read())
            vals["hrmis_cnic_front_filename"] = cnic_front.filename

        if cnic_back:
            vals["hrmis_cnic_back"] = base64.b64encode(cnic_back.read())
            vals["hrmis_cnic_back_filename"] = cnic_back.filename

        # -----------------------
        # Required fields validation
        # -----------------------
        required_fields = {
            "hrmis_cnic": "CNIC",
            "hrmis_father_name": "Father's Name",
            "gender": "Gender",
            "hrmis_joining_date": "Joining Date",
           
            "hrmis_cadre": "Cadre",
            
            "birthday": "Date Of Birth",
            "hrmis_cnic_front": "CNIC Front Scan",
            "hrmis_cnic_back": "CNIC Back Scan",
            "hrmis_merit_number": "Merit Number",
            "hrmis_contact_info": "Contact Number",

            # NEW
            "hrmis_domicile": "Domicile",
        }


        missing = []
        for field, label in required_fields.items():
            if field in ("hrmis_cnic_front", "hrmis_cnic_back"):
                already = bool(getattr(req, field, False))  # ✅ already uploaded on req
                file_obj = request.httprequest.files.get(field)
                if not already and not file_obj:
                    missing.append(label)
            else:
                if not (post.get(field) or "").strip():
                    missing.append(label)


        if missing:
            return request.render(
                "hr_holidays_updates.hrmis_profile_request_form",
                _base_ctx(
                    "Profile Update Request",
                    "user_profile",
                    employee=employee,
                    current_employee=employee,
                    req=req,
                    districts=env["hrmis.district.master"].sudo().search([]),
                    facilities=env["hrmis.facility.type"].sudo().search([]),
                    error="Please complete the following fields before submitting:\n• " + "\n• ".join(missing),
                ),
            )

        # -----------------------
        # Handle Cadre safely
        # -----------------------
        cadre_val = post.get("hrmis_cadre")
        designation_val = post.get("hrmis_designation")
        designation_id = int(designation_val) if designation_val else False
        
        try:
            cadre_id = int(cadre_val) if cadre_val else False
        except Exception:
            cadre_id = False

        if not isinstance(cadre_id, (int, type(None))):
            cadre_id = False

        # -----------------------
        # Parse BPS safely
        # -----------------------
        try:
            bps = int(post.get("hrmis_bps") or 0)
        except Exception:
            bps = 0

        # -----------------------
        # Resolve manager + approver via helper
        # -----------------------
        manager_user_id = int(post.get("manager_user_id") or 0)  # optional
        facility_id = int(post.get("facility_id") or 0)
        district_id = int(post.get("district_id") or 0)

        designation = env["hrmis.designation"].sudo().browse(designation_id) if designation_id else env["hrmis.designation"]
        facility = env["hrmis.facility.type"].sudo().browse(facility_id) if facility_id else env["hrmis.facility.type"]

        final_manager_employee, approver_emp, message_override, hard_error = self._resolve_manager_and_approver(
            employee=employee,
            designation=designation,
            bps=bps,
            manager_user_id=int(post.get("manager_user_id") or 0),
        )

        if hard_error:
            return request.render(
                "hr_holidays_updates.hrmis_profile_request_form",
                _base_ctx(
                    "Profile Update Request",
                    "user_profile",
                    employee=employee,
                    current_employee=employee,
                    req=req,
                    districts=env["hrmis.district.master"].sudo().search([]),
                    facilities=env["hrmis.facility.type"].sudo().search([]),
                    error=message_override,   # contains the reason
                ),
            )
        # If helper returns a hard error message, stop here
        # (recommended: in helper, return message_override only for user-facing hard errors)
        if message_override and (
            message_override.lower().startswith("so-v user") or
            message_override.lower().startswith("manager employee not found")
        ):
            return request.render("hr_holidays_updates.hrmis_error", {"error": message_override})

        # -----------------------
        # Build request values
        # -----------------------
        vals.update({
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
            "hrmis_leaves_taken": post.get("hrmis_leaves_taken"),
            "hrmis_merit_number": post.get("hrmis_merit_number"),
            "approver_id": approver_emp.id if approver_emp else False,
            "state": "submitted",

            # NEW
            "hrmis_domicile": post.get("hrmis_domicile"),
            "qualification": post.get("qualification"),
            "qualification_date": post.get("qualification_date"),
            "year_qualification": post.get("year_qualification"),
            "date_promotion": post.get("date_promotion"),
        })
        # -----------------------
        # Parse Repeatable Sections (getlist arrays)
        # -----------------------
        form = request.httprequest.form

        # 1) Qualification History
        q_degree = form.getlist("qualification_degree[]")
        q_spec = form.getlist("qualification_specialization[]")
        q_start = form.getlist("qualification_start[]")
        q_end = form.getlist("qualification_end[]")

        qual_lines = []
        for i in range(max(len(q_degree), len(q_start), len(q_spec), len(q_end))):
            deg = (q_degree[i] if i < len(q_degree) else "").strip()
            spec = (q_spec[i] if i < len(q_spec) else "").strip()
            s = self._month_to_date(q_start[i] if i < len(q_start) else "")
            e = self._month_to_date(q_end[i] if i < len(q_end) else "")

            # skip completely empty rows
            if not (deg or spec or s or e):
                continue

            # required fields
            if not deg or not s:
                return self._render_profile_form_error(employee, req, env, "Qualification History: Degree and Start Month are required.")

            qual_lines.append({
                "employee_id": employee.id,
                "degree": deg,
                "specialization": spec,
                "start_date": s,
                "end_date": e or False,
            })

        # 2) Posting History
        p_district = form.getlist("posting_district_id[]")
        p_facility = form.getlist("posting_facility_id[]")
        p_designation = form.getlist("posting_designation_id[]")
        p_bps = form.getlist("posting_bps[]")
        p_start = form.getlist("posting_start[]")
        p_end = form.getlist("posting_end[]")

        post_lines = []
        for i in range(max(len(p_district), len(p_designation), len(p_bps), len(p_start), len(p_end), len(p_facility))):
            district_id = self._to_int(p_district[i] if i < len(p_district) else "")
            facility_id = self._to_int(p_facility[i] if i < len(p_facility) else "")
            designation_id = self._to_int(p_designation[i] if i < len(p_designation) else "")
            bps_val = self._to_int(p_bps[i] if i < len(p_bps) else "")
            s = self._month_to_date(p_start[i] if i < len(p_start) else "")
            e = self._month_to_date(p_end[i] if i < len(p_end) else "")

            # skip completely empty row
            if not (district_id or facility_id or designation_id or bps_val or s or e):
                continue

            if not district_id or not designation_id or not bps_val or not s:
                return self._render_profile_form_error(employee, req, env, "Posting History: District, Designation, BPS and Start Month are required.")

            post_lines.append({
                "employee_id": employee.id,
                "district_id": district_id,
                "facility_id": facility_id or False,
                "designation_id": designation_id,
                "bps": bps_val,
                "start_date": s,
                "end_date": e or False,
            })

        # 3) Promotion History
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
                return self._render_profile_form_error(employee, req, env, "Promotion History: BPS From, BPS To and Promotion Month are required.")

            if b_to <= b_from:
                return self._render_profile_form_error(employee, req, env, "Promotion History: BPS To must be greater than BPS From.")

            promo_lines.append({
                "employee_id": employee.id,
                "bps_from": b_from,
                "bps_to": b_to,
                "promotion_date": pdate,
            })

        # 4) Leave History
        l_type = form.getlist("leave_type_id[]")
        l_start = form.getlist("leave_start[]")
        l_end = form.getlist("leave_end[]")

        leave_lines = []
        # Hard-block these leave types even if posted manually
        blocked_leave_type_keys = {"paidtimeoff", "sicktimeoff"}
        for i in range(max(len(l_type), len(l_start), len(l_end))):
            leave_type_id = self._to_int(l_type[i] if i < len(l_type) else "")
            s = (l_start[i] if i < len(l_start) else "").strip()
            e = (l_end[i] if i < len(l_end) else "").strip()

            if not (leave_type_id or s or e):
                continue

            if not leave_type_id or not s or not e:
                return self._render_profile_form_error(employee, req, env, "Leave History: Leave Type, Start Date and End Date are required.")

            # Validate leave type (blocked)
            try:
                lt = env["hr.leave.type"].sudo().browse(int(leave_type_id)).exists()
                if lt and _norm_leave_type_name(getattr(lt, "name", "")) in blocked_leave_type_keys:
                    return self._render_profile_form_error(employee, req, env, "Leave History: This leave type is not allowed.")
            except Exception:
                # If we cannot resolve the leave type reliably, keep going; other validations still apply.
                pass

            # Date validations
            try:
                sd = fields.Date.to_date(s)
                ed = fields.Date.to_date(e)
                if not sd or not ed:
                    return self._render_profile_form_error(employee, req, env, "Leave History: Invalid dates.")
                if ed < sd:
                    return self._render_profile_form_error(employee, req, env, "Leave History: End Date cannot be earlier than Start Date.")
                today_ctx = fields.Date.context_today(env.user)
                # Start date must be before today; End date can be up to today.
                if sd >= today_ctx:
                    return self._render_profile_form_error(employee, req, env, "Leave History: Start Date must be before today.")
                if ed > today_ctx:
                    return self._render_profile_form_error(employee, req, env, "Leave History: End Date cannot be after today.")
                # End date must be at least 7 days after start date.
                if (ed - sd).days < 7:
                    return self._render_profile_form_error(employee, req, env, "Leave History: End Date must be at least 7 days after Start Date.")
            except Exception:
                return self._render_profile_form_error(employee, req, env, "Leave History: Invalid dates.")

            leave_lines.append({
                "employee_id": employee.id,
                "leave_type_id": leave_type_id,
                "start_date": sd,
                "end_date": ed,
            })

        # -----------------------
        # Write histories (replace existing histories)
        # If you want append-only, remove the unlink() blocks.
        # -----------------------
        Qual = env["hrmis.qualification.history"].sudo()
        Post = env["hrmis.posting.history"].sudo()
        Promo = env["hrmis.promotion.history"].sudo()
        Leave = env["hrmis.leave.history"].sudo()

        Qual.search([("employee_id", "=", employee.id)]).unlink()
        Post.search([("employee_id", "=", employee.id)]).unlink()
        Promo.search([("employee_id", "=", employee.id)]).unlink()
        Leave.search([("employee_id", "=", employee.id)]).unlink()

        if qual_lines:
            Qual.create(qual_lines)
        if post_lines:
            Post.create(post_lines)
        if promo_lines:
            Promo.create(promo_lines)
        if leave_lines:
            Leave.create(leave_lines)

        # ✅ store merit number into employee AFTER req is updated
        employee.sudo().write({
            "hrmis_merit_number": (post.get("hrmis_merit_number") or "").strip() or employee.hrmis_merit_number,
        })

        # -----------------------
        # Write req inside savepoint while temporarily assigning parent_id
        # -----------------------
        def _work():
            req.sudo().write(vals)

        ok, err = self._with_temporary_parent(employee, final_manager_employee, _work)
        if not ok:
            return request.render(
                "hr_holidays_updates.hrmis_profile_request_form",
                _base_ctx(
                    "Profile Update Request",
                    "user_profile",
                    employee=employee,
                    current_employee=employee,
                    req=req,
                    districts=env["hrmis.district.master"].sudo().search([]),
                    facilities=env["hrmis.facility.type"].sudo().search([]),
                    
                    error=f"Could not submit request. Changes reverted. Error: {err}",
                ),
            )

        # -----------------------
        # Success
        # -----------------------
        success_msg = message_override or "Profile update request submitted successfully."

        return request.render(
            "hr_holidays_updates.hrmis_profile_request_form",
            _base_ctx(
                "Profile Update Request",
                "user_profile",
                employee=employee,
                current_employee=employee,
                req=req,
                districts=env["hrmis.district.master"].sudo().search([]),
                facilities=env["hrmis.facility.type"].sudo().search([]),
                success=success_msg,
            ),
        )



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
                "districts": request.env["hrmis.district.master"].sudo().search([]),
                "facilities": request.env["hrmis.facility.type"].sudo().search([]),
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