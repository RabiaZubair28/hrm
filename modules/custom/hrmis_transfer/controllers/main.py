from __future__ import annotations

import base64
import json
import logging
from urllib.parse import quote_plus

from odoo import http
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.http import request
from odoo.addons.hr_holidays_updates.controllers.helperControllers.emr_profile_data import (
    EmrProfileDataMixin,
)
from odoo.addons.hrmis_multilevel_approvals.models.mixins import NoApproverConfigured

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

    def _safe_int(self, value, default=0):
        try:
            return int(value)
        except Exception:
            return default

    def _normalize_text(self, value):
        return " ".join(str(value or "").strip().lower().split())

    def _safe_redirect_base(self, value):
        value = (value or "/hrmis/transfer").strip()
        return value if value.startswith("/") else "/hrmis/transfer"

    def _transfer_redirect(self, base_url, *, tab=None, success=None, error=None):
        url = base_url or "/hrmis/transfer"
        parts = []
        if tab:
            parts.append(f"tab={quote_plus(tab)}")
        if success:
            parts.append(f"success={quote_plus(success)}")
        if error:
            parts.append(f"error={quote_plus(error)}")
        if parts:
            url = f"{url}?{'&'.join(parts)}"
        return request.redirect(url)

    def _get_transfer_emr_catalog(self):
        districts, districts_error = self._get_emr_districts(request.env)
        facilities, _meta, facilities_error = self._get_emr_facilities(
            request.env,
            page=1,
            limit=2500,
        )
        return (districts or []), (facilities or []), (districts_error or facilities_error)

    def _match_emr_district_for_local(self, local_district, emr_districts):
        if not local_district:
            return {}

        local_name = self._normalize_text(getattr(local_district, "name", ""))

        for row in emr_districts or []:
            if local_name and self._normalize_text(row.get("name")) == local_name:
                return row
        return {}

    def _match_emr_facility_for_local(self, local_facility, emr_facilities):
        if not local_facility:
            return {}

        local_name = self._normalize_text(getattr(local_facility, "name", ""))
        local_code = self._normalize_text(getattr(local_facility, "facility_code", ""))
        local_district_id = getattr(getattr(local_facility, "district_id", False), "id", 0)
        local_district_name = self._normalize_text(
            getattr(getattr(local_facility, "district_id", False), "name", "")
        )

        for row in emr_facilities or []:
            row_code = self._normalize_text(row.get("code"))
            if local_code and row_code and row_code == local_code:
                return row
        for row in emr_facilities or []:
            row_name = self._normalize_text(row.get("name"))
            row_district_id = self._safe_int(row.get("district_id"))
            row_district_name = self._normalize_text(row.get("district_name"))
            if not local_name or row_name != local_name:
                continue
            if local_district_id and row_district_id and local_district_id == row_district_id:
                return row
            if local_district_name and row_district_name and local_district_name == row_district_name:
                return row
        return {}

    def _resolve_local_district_from_emr(self, emr_row):
        District = request.env["hrmis.district.master"].sudo()
        district = False
        name = ((emr_row or {}).get("name") or "").strip()

        if name:
            district = District.search([("name", "=ilike", name)], limit=1)
        return district

    def _resolve_local_facility_from_emr(self, emr_row, district):
        Facility = request.env["hrmis.facility.type"].sudo()
        facility = False
        code = ((emr_row or {}).get("code") or "").strip()
        name = ((emr_row or {}).get("name") or "").strip()

        if code and "facility_code" in Facility._fields:
            facility = Facility.search([("facility_code", "=ilike", code)], limit=1)
        if not facility and name:
            dom = [("name", "=ilike", name)]
            if district:
                dom.append(("district_id", "=", district.id))
            facility = Facility.search(dom, limit=1)
        return facility

    def _match_requested_designation(self, employee, facility):
        matched_designation = False
        emp_desig = getattr(employee, "hrmis_designation", False)
        if emp_desig and facility:
            Designation = request.env["hrmis.designation"].sudo()
            dom = [
                ("facility_id", "=", facility.id),
                ("active", "=", True),
                ("post_BPS", "=", getattr(employee, "hrmis_bps", 0) or 0),
            ]
            emp_code_raw = (getattr(emp_desig, "code", "") or "").strip()
            emp_code = emp_code_raw.lower()
            emp_name = (getattr(emp_desig, "name", "") or "").strip()
            bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

            if emp_code and emp_code not in bad_codes:
                matched_designation = Designation.search(
                    dom + [("code", "=ilike", emp_code_raw)],
                    limit=1,
                )
            if not matched_designation:
                matched_designation = Designation.search(
                    dom + [("name", "=ilike", emp_name)],
                    limit=1,
                )
        return matched_designation

    def _attach_support_document(self, transfer_request, uploaded):
        if not transfer_request or not uploaded:
            return

        data = uploaded.read()
        if not data:
            return

        attachment = request.env["ir.attachment"].sudo().create(
            {
                "name": getattr(uploaded, "filename", None) or "supporting_document",
                "res_model": "hrmis.transfer.request",
                "res_id": transfer_request.id,
                "type": "binary",
                "datas": base64.b64encode(data),
                "mimetype": getattr(uploaded, "mimetype", None),
            }
        )
        transfer_request.sudo().write({"supporting_attachment_ids": [(4, attachment.id)]})
        if "message_main_attachment_id" in transfer_request._fields:
            try:
                transfer_request.sudo().write({"message_main_attachment_id": attachment.id})
            except Exception:
                pass

    @http.route(
        ["/hrmis/api/transfer/emr_locations"],
        type="http",
        auth="user",
        website=True,
        methods=["GET"],
        csrf=False,
    )
    def hrmis_api_transfer_emr_locations(self, **kw):
        employee_id = self._safe_int(kw.get("employee_id"))
        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee or not self._can_submit_for_employee(employee):
            return self._json(
                {
                    "ok": False,
                    "error": "not_allowed",
                    "districts": [],
                    "facilities": [],
                },
                status=200,
            )

        districts, facilities, error = self._get_transfer_emr_catalog()
        current_district = self._match_emr_district_for_local(
            getattr(employee, "district_id", False),
            districts,
        )
        current_facility = self._match_emr_facility_for_local(
            getattr(employee, "facility_id", False),
            facilities,
        )

        return self._json(
            {
                "ok": not bool(error),
                "error": error or "",
                "districts": districts,
                "facilities": facilities,
                "current_district_id": self._safe_int(current_district.get("id")),
                "current_facility_id": self._safe_int(current_facility.get("id")),
                "current_designation": getattr(
                    getattr(employee, "hrmis_designation", False),
                    "name",
                    "",
                ),
                "current_designation_id": getattr(
                    getattr(employee, "hrmis_designation", False),
                    "id",
                    0,
                ),
            },
            status=200,
        )

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

        emr_districts, emr_facilities, _emr_error = self._get_transfer_emr_catalog()
        Designation = request.env["hrmis.designation"].sudo()
        # IMPORTANT: match case-insensitively across districts.
        # Many DBs store different casing (e.g., "CARDIOLOGIST" vs "Cardiologist").
        dom = [("active", "=", True), ("post_BPS", "=", emp_bps)]
        emp_code_raw = (getattr(emp_desig, "code", "") or "").strip()
        emp_code = emp_code_raw.strip().lower()
        emp_name = (getattr(emp_desig, "name", "") or "").strip()

        # Many seed rows use code="nan" as a placeholder. Treat these as empty,
        # otherwise we'd match *all* BPS rows having code nan.
        bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}
        if emp_code and emp_code not in bad_codes:
            # accept either code OR name match (case-insensitive exact)
            dom += ["|", ("code", "=ilike", emp_code_raw), ("name", "=ilike", emp_name)]
        else:
            dom += [("name", "=ilike", emp_name)]

        # Source of truth for "facility has designation" is `hrmis.designation` itself
        # (as loaded from hrmis_user_profiles_updates/data/hrmis_designation.xml).
        # One designation row exists per facility per designation name/BPS in that seed data.
        designations = Designation.search(dom)

        # Do not allow transferring to the same current facility.
        current_fac = getattr(employee, "facility_id", False) or getattr(employee, "hrmis_facility_id", False)
        if current_fac:
            # IMPORTANT: filter *designations* too, otherwise current facility can still leak
            # into the payload via iteration over `designations`.
            designations = designations.filtered(lambda d: d.facility_id and d.facility_id.id != current_fac.id)

        facilities = designations.mapped("facility_id")
        districts = facilities.mapped("district_id")

        Allocation = request.env["hrmis.facility.designation"].sudo()
        allocs = Allocation.search(
            [
                ("facility_id", "in", facilities.ids or [-1]),
                ("designation_id", "in", designations.ids or [-1]),
            ]
        )
        alloc_by_key = {(a.facility_id.id, a.designation_id.id): a for a in allocs}

        facilities_payload = []
        # Prevent duplicates: one facility per designation match.
        seen_fac_ids = set()
        for d in designations:
            fac = d.facility_id
            if not fac or fac.id in seen_fac_ids:
                continue
            seen_fac_ids.add(fac.id)

            a = alloc_by_key.get((fac.id, d.id))
            total = int(getattr(d, "total_sanctioned_posts", 0) or 0)
            occ = int(getattr(a, "occupied_posts", 0) or 0) if a else 0
            vac = int(total - occ)
            facilities_payload.append(
                {
                    "id": fac.id,
                    "local_facility_id": fac.id,
                    "name": fac.name,
                    "district_id": fac.district_id.id if getattr(fac, "district_id", False) else 0,
                    "local_district_id": fac.district_id.id if getattr(fac, "district_id", False) else 0,
                    "designation_id": d.id if d else 0,
                    "total": total,
                    "occupied": occ,
                    "vacant": vac,
                }
            )

        for item in facilities_payload:
            facility = request.env["hrmis.facility.type"].sudo().browse(item["local_facility_id"]).exists()
            emr_facility = self._match_emr_facility_for_local(facility, emr_facilities)
            item["emr_facility_id"] = self._safe_int(emr_facility.get("id"))
            item["emr_district_id"] = self._safe_int(emr_facility.get("district_id"))
            item["facility_code"] = (
                (emr_facility.get("code") or "").strip()
                or getattr(facility, "facility_code", "")
                or ""
            )

        facilities_payload.sort(key=lambda x: (x.get("district_id") or 0, x.get("name") or ""))
        districts_payload = []
        for district in districts:
            emr_district = self._match_emr_district_for_local(district, emr_districts)
            districts_payload.append(
                {
                    "id": district.id,
                    "name": district.name,
                    "emr_district_id": self._safe_int(emr_district.get("id")),
                }
            )
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

        redirect_base = self._safe_redirect_base(post.get("redirect_base"))
        current_emr_district_id = self._safe_int(post.get("current_emr_district_id"))
        current_emr_facility_id = self._safe_int(post.get("current_emr_facility_id"))
        required_emr_district_id = self._safe_int(post.get("required_emr_district_id"))
        required_emr_facility_id = self._safe_int(post.get("required_emr_facility_id"))
        requested_designation = (post.get("requested_designation") or "").strip()
        justification = (post.get("justification") or "").strip()
        uploaded = request.httprequest.files.get("support_document")

        if not (
            current_emr_district_id
            and current_emr_facility_id
            and required_emr_district_id
            and required_emr_facility_id
            and requested_designation
            and justification
        ):
            msg = "Please fill all required fields"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        requested_designation_options = dict(
            request.env["hrmis.transfer.request"]._fields["requested_designation"].selection
        )
        if requested_designation not in requested_designation_options:
            msg = "Invalid required designation selection"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        districts, facilities, emr_error = self._get_transfer_emr_catalog()
        if emr_error:
            return self._transfer_redirect(redirect_base, tab="new", error=emr_error)

        district_rows = {
            self._safe_int(row.get("id")): row
            for row in districts
            if self._safe_int(row.get("id"))
        }
        facility_rows = {
            self._safe_int(row.get("id")): row
            for row in facilities
            if self._safe_int(row.get("id"))
        }

        current_district_row = district_rows.get(current_emr_district_id) or self._match_emr_district_for_local(
            getattr(employee, "district_id", False),
            districts,
        )
        current_facility_row = facility_rows.get(current_emr_facility_id) or self._match_emr_facility_for_local(
            getattr(employee, "facility_id", False),
            facilities,
        )
        required_district_row = district_rows.get(required_emr_district_id)
        required_facility_row = facility_rows.get(required_emr_facility_id)

        if not (current_district_row and current_facility_row and required_district_row and required_facility_row):
            msg = "Invalid district/facility selection"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        if self._safe_int(current_facility_row.get("district_id")) != self._safe_int(current_district_row.get("id")):
            msg = "Current facility must belong to current district"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        if self._safe_int(required_facility_row.get("district_id")) != self._safe_int(required_district_row.get("id")):
            msg = "Required facility must belong to required district"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        cur_dist = getattr(employee, "district_id", False)
        cur_fac = getattr(employee, "facility_id", False)
        if not (cur_dist and cur_fac):
            msg = "Your current district/facility is not configured in HRMIS"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        req_dist = self._resolve_local_district_from_emr(required_district_row)
        req_fac = self._resolve_local_facility_from_emr(required_facility_row, req_dist)
        if not req_dist or not req_fac:
            msg = "Selected required district/facility is not configured in HRMIS yet"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        if req_fac.district_id.id != req_dist.id:
            msg = "Required facility must belong to required district"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        if req_fac.id == cur_fac.id:
            msg = "You cannot request transfer to your current facility"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        matched_designation = self._match_requested_designation(employee, req_fac)

        if not matched_designation:
            msg = "Requested facility does not have your designation at your BPS"
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        # ===============================
        # CREATE + SUBMIT (TRY / EXCEPT)
        # ===============================
        try:
            with request.env.cr.savepoint():
                Transfer = request.env["hrmis.transfer.request"].sudo()
                tr = Transfer.create(
                    {
                        "employee_id": employee.id,
                        "current_district_id": cur_dist.id,
                        "current_emr_district_id": self._safe_int(current_district_row.get("id")),
                        "current_emr_district_name": current_district_row.get("name") or cur_dist.name,
                        "current_facility_id": cur_fac.id,
                        "current_emr_facility_id": self._safe_int(current_facility_row.get("id")),
                        "current_emr_facility_name": current_facility_row.get("name") or cur_fac.name,
                        "current_emr_facility_code": (
                            (current_facility_row.get("code") or "").strip()
                            or getattr(cur_fac, "facility_code", "")
                            or ""
                        ),
                        "current_designation_id": getattr(
                            getattr(employee, "hrmis_designation", False),
                            "id",
                            False,
                        ),
                        "required_district_id": req_dist.id,
                        "required_emr_district_id": self._safe_int(required_district_row.get("id")),
                        "required_emr_district_name": required_district_row.get("name") or req_dist.name,
                        "required_facility_id": req_fac.id,
                        "required_emr_facility_id": self._safe_int(required_facility_row.get("id")),
                        "required_emr_facility_name": required_facility_row.get("name") or req_fac.name,
                        "required_emr_facility_code": (
                            (required_facility_row.get("code") or "").strip()
                            or getattr(req_fac, "facility_code", "")
                            or ""
                        ),
                        "requested_designation": requested_designation,
                        "required_designation_id": matched_designation.id,
                        "justification": justification,
                        "state": "draft",
                    }
                )
                self._attach_support_document(tr, uploaded)
                tr.with_user(request.env.user).action_submit()
                request.env.cr.flush()
        
        except (UserError, ValidationError, AccessError) as e:
            # ✅ show the real business message to the user
            return self._transfer_redirect(
                redirect_base,
                tab="new",
                error=str(e) or "Operation not allowed",
            )
        
        except NoApproverConfigured as e:
            return self._transfer_redirect(redirect_base, tab="new", error=str(e))

        except Exception as e:
            # ✅ log full traceback in server logs
            _logger.exception("[TR][SUBMIT] Unexpected error while submitting transfer request. emp=%s user=%s",
                            employee.id, request.env.user.id)

            # ✅ show a slightly more meaningful message (without leaking internals)
            msg = f"Unexpected error occurred ({e.__class__.__name__}). Please contact the administrator."
            return self._transfer_redirect(redirect_base, tab="new", error=msg)

        return self._transfer_redirect(
            redirect_base,
            tab="history",
            success="Transfer request submitted successfully",
        )