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

    def _static_transfer_vacancy_map(self):
        vacancy_map = {}
        for row in getattr(self, "_STATIC_TRANSFER_VACANCIES", []) or []:
            try:
                facility_id = int(row.get("facility_id") or 0)
            except Exception:
                facility_id = 0
            if not facility_id:
                continue
            total = int(row.get("total_sanctioned_posts") or 0)
            occupied = int(row.get("occupied_posts") or 0)
            vacancy_map[facility_id] = {
                "total": total,
                "occupied": occupied,
                "vacant": max(total - occupied, 0),
            }
        return vacancy_map

    def _get_static_transfer_catalog(self):
        districts, _err = self._get_static_emr_districts()
        facilities, _meta, _err2 = self._get_static_emr_facilities(district_id=None, page=1, limit=2500)
        return districts or [], facilities or [], self._static_transfer_vacancy_map()

    def _get_temp_hcu(self):
        hcu = request.env["hrmis.healthcare.unit"].sudo().browse(1).exists()
        if not hcu:
            raise UserError("Transfer static data requires hrmis.healthcare.unit record with ID 1.")
        return hcu

    def _get_or_create_static_district_record(self, district_row):
        district_row = district_row or {}
        name = (district_row.get("name") or "").strip()
        if not name:
            return request.env["hrmis.district.master"].browse()

        District = request.env["hrmis.district.master"].sudo()
        district = District.search([("name", "=", name)], limit=1)
        if district:
            return district

        vals = {
            "name": name,
            "code": f"TMP-{(district_row.get('id') or 0)}",
            "active": True,
        }
        return District.create(vals)

    def _get_or_create_static_facility_record(self, facility_row, district):
        facility_row = facility_row or {}
        name = (facility_row.get("name") or "").strip()
        code = (facility_row.get("code") or "").strip() or f"TMP-{facility_row.get('id') or 0}"
        if not name or not district:
            return request.env["hrmis.facility.type"].browse()

        Facility = request.env["hrmis.facility.type"].sudo()
        facility = Facility.search(
            [("name", "=", name), ("district_id", "=", district.id)],
            limit=1,
        )
        if not facility and code:
            facility = Facility.search([("facility_code", "=", code)], limit=1)
        if facility:
            return facility

        self._get_temp_hcu()
        vals = {
            "name": name,
            "district_id": district.id,
            "description": "Temporary facility created from static transfer API data.",
            "capacity": 0,
            "facility_code": code,
            "category": "hospital",
            "hcu_id": 1,
            "active": True,
            "is_temp": True,
        }
        return Facility.create(vals)

    def _get_or_create_static_transfer_designation(self, employee, facility, total_posts):
        if not employee or not facility:
            return request.env["hrmis.designation"].browse()

        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = int(getattr(employee, "hrmis_bps", 0) or 0)
        if not emp_desig or not emp_bps:
            return request.env["hrmis.designation"].browse()

        Designation = request.env["hrmis.designation"].sudo()
        code = (getattr(emp_desig, "code", "") or "").strip()
        name = (getattr(emp_desig, "name", "") or "").strip()
        bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

        dom = [
            ("facility_id", "=", facility.id),
            ("active", "=", True),
            ("post_BPS", "=", emp_bps),
        ]
        designation = request.env["hrmis.designation"].browse()
        if code and code.lower() not in bad_codes:
            designation = Designation.search(dom + [("code", "=ilike", code)], limit=1)
        if not designation and name:
            designation = Designation.search(dom + [("name", "=ilike", name)], limit=1)
        if designation:
            return designation

        vals = {
            "name": name or "Temporary Designation",
            "code": code or False,
            "designation_group_id": getattr(getattr(emp_desig, "designation_group_id", False), "id", False) or False,
            "total_sanctioned_posts": max(int(total_posts or 0), 1),
            "post_BPS": max(emp_bps, 1),
            "facility_id": facility.id,
            "active": True,
            "is_temp": True,
        }
        return Designation.create(vals)

    def _ensure_static_transfer_allocation(self, facility, designation, occupied_posts):
        if not facility or not designation:
            return request.env["hrmis.facility.designation"].browse()

        Allocation = request.env["hrmis.facility.designation"].sudo()
        allocation = Allocation.search(
            [("facility_id", "=", facility.id), ("designation_id", "=", designation.id)],
            limit=1,
        )
        if allocation:
            return allocation

        return Allocation.create(
            {
                "facility_id": facility.id,
                "designation_id": designation.id,
                "occupied_posts": max(int(occupied_posts or 0), 0),
            }
        )

    def _resolve_static_transfer_district(self, district_id):
        District = request.env["hrmis.district.master"].sudo()
        district = District.browse(district_id).exists()
        if district:
            return district

        districts, _facilities, _vacancies = self._get_static_transfer_catalog()
        static_row = next((d for d in districts if int(d.get("id") or 0) == int(district_id or 0)), None)
        return self._get_or_create_static_district_record(static_row) if static_row else District.browse()

    def _resolve_static_transfer_facility(self, facility_id, employee=None):
        Facility = request.env["hrmis.facility.type"].sudo()
        facility = Facility.browse(facility_id).exists()
        if facility:
            return facility

        districts, facilities, vacancy_map = self._get_static_transfer_catalog()
        static_row = next((f for f in facilities if int(f.get("id") or 0) == int(facility_id or 0)), None)
        if not static_row:
            return Facility.browse()

        district_row = next(
            (d for d in districts if int(d.get("id") or 0) == int(static_row.get("district_id") or 0)),
            None,
        )
        district = self._get_or_create_static_district_record(district_row)
        facility = self._get_or_create_static_facility_record(static_row, district)

        if employee:
            vacancy = vacancy_map.get(int(static_row.get("id") or 0), {})
            designation = self._get_or_create_static_transfer_designation(
                employee,
                facility,
                vacancy.get("total") or 1,
            )
            self._ensure_static_transfer_allocation(
                facility,
                designation,
                vacancy.get("occupied") or 0,
            )

        return facility

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

        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = getattr(employee, "hrmis_bps", 0) or 0
        if not emp_desig or not emp_bps:
            return self._json(
                {
                    "ok": True,
                    "employee_designation": getattr(emp_desig, "name", "") if emp_desig else "",
                    "employee_bps": emp_bps,
                    "districts": [],
                    "facilities": [],
                },
                status=200,
            )

        current_fac = getattr(employee, "facility_id", False) or getattr(employee, "hrmis_facility_id", False)
        current_fac_name = ((getattr(current_fac, "name", "") or "").strip().lower()) if current_fac else ""
        current_dist_name = (
            (getattr(getattr(current_fac, "district_id", False), "name", "") or "").strip().lower()
            if current_fac
            else ""
        )

        static_districts, static_facilities, vacancy_map = self._get_static_transfer_catalog()
        districts_by_static_id = {
            int(d.get("id") or 0): d for d in static_districts if int(d.get("id") or 0)
        }
        facilities_payload = []
        seen_fac_ids = set()
        seen_dist_ids = set()
        districts_payload = []

        for fac_row in static_facilities:
            static_fac_id = int(fac_row.get("id") or 0)
            if not static_fac_id:
                continue

            fac_name = (fac_row.get("name") or "").strip().lower()
            dist_name = (fac_row.get("district_name") or "").strip().lower()
            if current_fac_name and fac_name == current_fac_name and dist_name == current_dist_name:
                continue

            district_row = districts_by_static_id.get(int(fac_row.get("district_id") or 0))
            district = self._get_or_create_static_district_record(district_row)
            facility = self._get_or_create_static_facility_record(fac_row, district)
            if not facility or facility.id in seen_fac_ids:
                continue

            vacancy = vacancy_map.get(static_fac_id, {})
            designation = self._get_or_create_static_transfer_designation(
                employee,
                facility,
                vacancy.get("total") or 1,
            )
            allocation = self._ensure_static_transfer_allocation(
                facility,
                designation,
                vacancy.get("occupied") or 0,
            )
            total = int(getattr(designation, "total_sanctioned_posts", 0) or vacancy.get("total") or 0)
            occ = int(getattr(allocation, "occupied_posts", 0) or vacancy.get("occupied") or 0)
            vac = max(int(total - occ), 0)

            seen_fac_ids.add(facility.id)
            facilities_payload.append(
                {
                    "id": facility.id,
                    "name": facility.name,
                    "district_id": district.id if district else 0,
                    "designation_id": designation.id if designation else 0,
                    "total": total,
                    "occupied": occ,
                    "vacant": vac,
                }
            )

            if district and district.id not in seen_dist_ids:
                seen_dist_ids.add(district.id)
                districts_payload.append({"id": district.id, "name": district.name})

        facilities_payload.sort(key=lambda x: (x.get("district_id") or 0, x.get("name") or ""))
        districts_payload.sort(key=lambda x: x.get("name") or "")

        return self._json(
            {
                "ok": True,
                "employee_designation": emp_desig.name,
                "employee_bps": emp_bps,
                "districts": districts_payload,
                "facilities": facilities_payload,
            },
            status=200,
        )

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

        cur_dist = District.browse(current_district_id).exists() or self._resolve_static_transfer_district(current_district_id)
        cur_fac = Facility.browse(current_facility_id).exists() or self._resolve_static_transfer_facility(current_facility_id, employee=employee)
        req_dist = District.browse(required_district_id).exists() or self._resolve_static_transfer_district(required_district_id)
        req_fac = Facility.browse(required_facility_id).exists() or self._resolve_static_transfer_facility(required_facility_id, employee=employee)

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
            if not matched_designation and req_fac:
                static_vacancy = self._static_transfer_vacancy_map().get(
                    int(_safe_int(post.get("required_facility_id")) or 0),
                    {},
                )
                matched_designation = self._get_or_create_static_transfer_designation(
                    employee,
                    req_fac,
                    static_vacancy.get("total") or 1,
                )
                self._ensure_static_transfer_allocation(
                    req_fac,
                    matched_designation,
                    static_vacancy.get("occupied") or 0,
                )

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