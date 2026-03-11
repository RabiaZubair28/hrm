from __future__ import annotations

import json
from urllib.parse import quote_plus
from odoo.exceptions import UserError, ValidationError, AccessError
from odoo import http
from odoo.http import request
from odoo.addons.hr_holidays_updates.controllers.helperControllers.emr_profile_data import EmrProfileDataMixin
from odoo.addons.hrmis_multilevel_approvals.models.mixins import NoApproverConfigured
import logging
_logger = logging.getLogger(__name__)


class HrmisTransferController(EmrProfileDataMixin, http.Controller):
    def _json(self, payload: dict, status: int = 200):
        return request.make_response(
            json.dumps(payload),
            headers=[("Content-Type", "application/json")],
            status=status,
        )

    def _current_employee(self):
        return (
            request.env["hr.employee"]
            .sudo()
            .search([("user_id", "=", request.env.user.id)], limit=1)
        )

    def _can_submit_for_employee(self, employee) -> bool:
        if not employee:
            return False
        user = request.env.user
        if employee.user_id and employee.user_id.id == user.id:
            return True
        return bool(user.has_group("hr.group_hr_manager") or user.has_group("base.group_system"))

    @http.route(
        ["/hrmis/api/transfer/eligible_destinations"],
        type="http",
        auth="user",
        website=True,
        methods=["GET"],
        csrf=False,
    )
    def hrmis_api_transfer_eligible_destinations(self, **kw):
        """
        Return ONLY districts+facilities which have the employee's current designation
        at the employee's BPS grade, along with vacancy counts for that designation.
        """
        try:
            employee_id = int((kw.get("employee_id") or 0) or 0)
        except Exception:
            employee_id = 0

        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee or not self._can_submit_for_employee(employee):
            return self._json({"ok": False, "error": "not_allowed", "districts": [], "facilities": []}, status=200)

        payload = self._get_static_transfer_destinations_payload(request.env, employee)
        return self._json(payload, status=200)

    @http.route(
        ["/hrmis/staff/<int:employee_id>/transfer/submit"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_transfer_submit(self, employee_id: int, **post):
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        if not self._can_submit_for_employee(employee):
            return request.redirect("/hrmis/services?error=not_allowed")

        def _safe_int(v):
            try:
                return int(v)
            except Exception:
                return 0

        current_district_id = _safe_int(post.get("current_district_id")) or int(
            getattr(getattr(employee, "district_id", False), "id", 0) or 0
        )
        current_facility_id = _safe_int(post.get("current_facility_id")) or int(
            getattr(getattr(employee, "facility_id", False), "id", 0) or 0
        )
        required_district_id = _safe_int(post.get("required_district_id"))
        required_facility_id = _safe_int(post.get("required_facility_id"))
        justification = (post.get("justification") or "").strip()

        if not (
            current_district_id
            and current_facility_id
            and required_district_id
            and required_facility_id
            and justification
        ):
            msg = "Please fill all required fields"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        if required_facility_id == current_facility_id:
            msg = "You cannot request transfer to your current facility"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        District = request.env["hrmis.district.master"].sudo()
        Facility = request.env["hrmis.facility.type"].sudo()
        Designation = request.env["hrmis.designation"].sudo()

        cur_dist = District.browse(current_district_id).exists()
        cur_fac = Facility.browse(current_facility_id).exists()
        req_dist = District.browse(required_district_id).exists()
        req_fac = Facility.browse(required_facility_id).exists()

        if not (cur_dist and cur_fac and req_dist and req_fac):
            msg = "Invalid district/facility selection"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        if cur_fac.district_id.id != cur_dist.id:
            msg = "Current facility must belong to current district"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        if req_fac.district_id.id != req_dist.id:
            msg = "Required facility must belong to required district"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        # ---- designation matching (unchanged) ----
        matched_designation = False
        emp_desig = getattr(employee, "hrmis_designation", False)
        if emp_desig:
            dom = [
                ("facility_id", "=", req_fac.id),
                ("active", "=", True),
                ("post_BPS", "=", getattr(employee, "hrmis_bps", 0) or 0),
            ]
            emp_code_raw = (getattr(emp_desig, "code", "") or "").strip()
            emp_code = emp_code_raw.lower()
            emp_name = (getattr(emp_desig, "name", "") or "").strip()
            bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

            if emp_code and emp_code not in bad_codes:
                matched_designation = Designation.search(dom + [("code", "=ilike", emp_code_raw)], limit=1)
            if not matched_designation:
                matched_designation = Designation.search(dom + [("name", "=ilike", emp_name)], limit=1)

        if not matched_designation:
            msg = "Requested facility does not have your designation at your BPS"
            return request.redirect(f"/hrmis/transfer?tab=new&error={quote_plus(msg)}")

        # ===============================
        # CREATE + SUBMIT (TRY / EXCEPT)
        # ===============================
        try:
            Transfer = request.env["hrmis.transfer.request"].sudo()
            tr = Transfer.create({
                "employee_id": employee.id,
                "current_district_id": cur_dist.id,
                "current_facility_id": cur_fac.id,
                "required_district_id": req_dist.id,
                "required_facility_id": req_fac.id,
                "required_designation_id": matched_designation.id,
                "justification": justification,
                "state": "draft",
            })

            tr.with_user(request.env.user).action_submit()
        
        except (UserError, ValidationError, AccessError) as e:
            # ✅ show the real business message to the user
            return request.redirect(
                f"/hrmis/transfer?tab=new&error={quote_plus(str(e) or 'Operation not allowed')}"
            )
        
        except NoApproverConfigured as e:
            return request.redirect(
                f"/hrmis/transfer?tab=new&error={quote_plus(str(e))}"
            )

        except Exception as e:
            # ✅ log full traceback in server logs
            _logger.exception("[TR][SUBMIT] Unexpected error while submitting transfer request. emp=%s user=%s",
                            employee.id, request.env.user.id)

            # ✅ show a slightly more meaningful message (without leaking internals)
            msg = f"Unexpected error occurred ({e.__class__.__name__}). Please contact the administrator."
            return request.redirect(
                f"/hrmis/transfer?tab=new&error={quote_plus(msg)}"
            )

        return request.redirect(
            "/hrmis/transfer?tab=history&success=Transfer+request+submitted+successfully"
        )