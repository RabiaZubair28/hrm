from __future__ import annotations

from odoo import http, fields
from odoo.http import request
import json
from odoo.exceptions import UserError, AccessError
import logging
_logger = logging.getLogger(__name__)
import random
import base64
from odoo.http import content_disposition


from odoo.addons.hr_holidays_updates.controllers.leave_data import (
    leave_pending_for_current_user,
    pending_leave_requests_for_user,
    leave_request_history_for_user,
)
from odoo.addons.hr_holidays_updates.controllers.utils import base_ctx







class HrmisSectionOfficerManageRequestsController(http.Controller):
    
    @staticmethod
    def _random_light_green_hex(seed_int: int):
        rr = random.Random(seed_int or 0)
        r = rr.randint(215, 240)
        g = rr.randint(235, 252)
        b = rr.randint(215, 240)
        return "#{:02X}{:02X}{:02X}".format(r, g, b)
    
    def _get_section_officer_users(self):
        Users = request.env["res.users"].sudo()

        # Prefer hrmis_role if present
        if "hrmis_role" in Users._fields:
            so_users = Users.search([("hrmis_role", "=", "section_officer"), ("active", "=", True)], order="login asc")
            if so_users:
                return so_users

        # fallback by login prefix
        return Users.search([("login", "=ilike", "so_%"), ("active", "=", True)], order="login asc")

    

    def _get_transfer_summary_for_user(self, so_user, district_id=None, facility_id=None, bps=None, designation_id=None):
        groups, overall = self._get_transfer_vacancies_grouped(
            district_id=district_id,
            facility_id=facility_id,
            bps=bps,
            designation_id=designation_id,
            limit=None,
            user=so_user,          # ✅ key: scope to that SO
        )
        return overall


    # --------------------------------
    # Catering config (SO -> scope)
    # --------------------------------
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

    def _get_user_catering_config(self, user):
        login = (user.login or "").strip().lower()
        mapping = self._get_all_catering_mappings()
        cfg = mapping.get(login)

        if login.startswith("so_") and not cfg:
            return {"deny": True}

        return cfg



    # --------------------------------
    # Filters pack for UI dropdowns
    # --------------------------------
    def _get_transfer_vacancy_filters(self, selected_district_id=None, selected_facility_id=None, selected_bps=None, user=None):
        District = request.env["hrmis.district.master"].sudo()
        Facility = request.env["hrmis.facility.type"].sudo()
        Designation = request.env["hrmis.designation"].sudo()

        districts = District.search([("active", "=", True)], order="name asc")

        fac_domain = [("active", "=", True)]
        if selected_district_id:
            fac_domain.append(("district_id", "=", int(selected_district_id)))
        facilities = Facility.search(fac_domain, order="name asc")

        # ✅ catering scope
        catering = self._get_user_catering_config(user) if user else None

        # ✅ deny by default for unmapped SOs
        if catering and catering.get("deny"):
            return {"districts": [], "facilities": [], "bps_values": [], "designations": []}

        # -------------------------
        # Build base designation domain (catering)
        # -------------------------
        des_base_domain = [("active", "=", True)]

        if catering:
            groups = [g.strip() for g in (catering.get("group_name") or []) if g]
            if groups:
                # OR domain: (grp ilike g1) OR (grp ilike g2) ...
                des_base_domain += ["|"] * (len(groups) - 1)
                for g in groups:
                    des_base_domain.append(("designation_group_id.name", "ilike", g))

            if catering.get("min_bps") is not None:
                des_base_domain.append(("post_BPS", ">=", int(catering["min_bps"])))
            if catering.get("max_bps") is not None:
                des_base_domain.append(("post_BPS", "<=", int(catering["max_bps"])))

        # BPS values within catering scope
        bps_rows = Designation.search_read(des_base_domain, ["post_BPS"])
        bps_values = sorted({int(r["post_BPS"]) for r in bps_rows if r.get("post_BPS") is not None})

        # Designations dropdown within catering scope + selected filters
        des_domain = list(des_base_domain)
        if selected_facility_id:
            des_domain.append(("facility_id", "=", int(selected_facility_id)))
        if selected_bps:
            des_domain.append(("post_BPS", "=", int(selected_bps)))

        designations = Designation.search(des_domain, order="name asc")

        return {
            "districts": districts,
            "facilities": facilities,
            "bps_values": bps_values,
            "designations": designations,
        }


    # --------------------------------
    # Flat rows
    # --------------------------------
    def _get_transfer_vacancies_data(self, district_id=None, facility_id=None, bps=None, designation_id=None, limit=None, user=None):
        Designation = request.env["hrmis.designation"].sudo()
        Allocation = request.env["hrmis.facility.designation"].sudo()

        des_domain = [("active", "=", True)]

        catering = self._get_user_catering_config(user) if user else None

        # ✅ deny by default for unmapped SOs
        if catering and catering.get("deny"):
            return []

        # -------------------------
        # Catering restriction
        # -------------------------
        if catering:
            groups = [g.strip() for g in (catering.get("group_name") or []) if g]
            if groups:
                des_domain += ["|"] * (len(groups) - 1)
                for g in groups:
                    des_domain.append(("designation_group_id.name", "ilike", g))

            if catering.get("min_bps") is not None:
                des_domain.append(("post_BPS", ">=", int(catering["min_bps"])))
            if catering.get("max_bps") is not None:
                des_domain.append(("post_BPS", "<=", int(catering["max_bps"])))

        # -------------------------
        # Existing filters
        # -------------------------
        if designation_id:
            des_domain.append(("id", "=", int(designation_id)))
        if bps:
            des_domain.append(("post_BPS", "=", int(bps)))
        if facility_id:
            des_domain.append(("facility_id", "=", int(facility_id)))
        if district_id and not facility_id:
            des_domain.append(("facility_id.district_id", "=", int(district_id)))

        designations = Designation.search(
            des_domain,
            order="facility_id asc, name asc",
            limit=(limit or None),
        )
        if not designations:
            return []

        # preload allocations
        alloc_domain = [("designation_id", "in", designations.ids)]
        if facility_id:
            alloc_domain.append(("facility_id", "=", int(facility_id)))
        if district_id and not facility_id:
            alloc_domain.append(("facility_id.district_id", "=", int(district_id)))

        allocs = Allocation.search(alloc_domain)

        alloc_by_key = {}
        for a in allocs:
            if a.designation_id and a.facility_id:
                alloc_by_key[(a.designation_id.id, a.facility_id.id)] = int(a.occupied_posts or 0)

        rows = []
        for idx, des in enumerate(designations, start=1):
            fac = des.facility_id
            dist = fac.district_id if fac else False

            total = int(des.total_sanctioned_posts or 0)
            occupied = alloc_by_key.get((des.id, fac.id), 0) if fac else 0

            vacant = total - occupied
            if vacant < 0:
                vacant = 0

            bg = self._random_light_green_hex(dist.id if dist else 0)

            rows.append({
                "row_no": idx,
                "district": dist.name if dist else "-",
                "facility": fac.name if fac else "-",
                "district_id": dist.id if dist else False,
                "facility_id": fac.id if fac else False,
                "designation": des.name or "-",
                "bps": int(des.post_BPS or 0),
                "vacant": int(vacant),
                "total": int(total),
                "bg_color": bg,
            })

        return rows


    # --------------------------------
    # Grouped output
    # --------------------------------
    def _get_transfer_vacancies_grouped(self, district_id=None, facility_id=None, bps=None, designation_id=None, limit=None, user=None):
        flat_rows = self._get_transfer_vacancies_data(
            district_id=district_id,
            facility_id=facility_id,
            bps=bps,
            designation_id=designation_id,
            limit=limit,
            user=user,
        )

        grouped = {}
        for r in flat_rows:
            fac_name = r.get("facility") or "-"
            dist_name = r.get("district") or "-"
            key = f"{dist_name}||{fac_name}"

            grp = grouped.get(key)
            if not grp:
                grp = {
                    "key": key,
                    "district": dist_name,
                    "facility": fac_name,
                    "district_id": r.get("district_id") or False,
                    "facility_id": r.get("facility_id") or False,
                    "bg_color": r.get("bg_color") or "",
                    "summary": {"total": 0, "occupied": 0, "vacant": 0},
                    "rows": [],
                }
                grouped[key] = grp

            total = int(r.get("total") or 0)
            vacant = int(r.get("vacant") or 0)
            occupied = max(0, total - vacant)

            grp["summary"]["total"] += total
            grp["summary"]["vacant"] += vacant
            grp["summary"]["occupied"] += occupied

            grp["rows"].append({
                "designation": r.get("designation") or "-",
                "bps": int(r.get("bps") or 0),
                "vacant": int(vacant),
                "total": int(total),
                "occupied": int(occupied),
            })

        groups = sorted(grouped.values(), key=lambda g: (g["district"], g["facility"]))
        for g in groups:
            g["rows"] = sorted(g["rows"], key=lambda x: (x["bps"], x["designation"]))

        overall = {"total": 0, "occupied": 0, "vacant": 0, "facilities": len(groups)}
        for g in groups:
            overall["total"] += g["summary"]["total"]
            overall["occupied"] += g["summary"]["occupied"]
            overall["vacant"] += g["summary"]["vacant"]

        return groups, overall

    def _employee_group_ids_for_person(self, employee):
        """
        Best-effort: return all hr.employee ids that represent the same person.

        This matches the behavior used in the History page, so totals like
        "Leave Taken" don't appear wrong when leave requests are attached to
        different employee rows for the same user/service number.
        """
        if not employee:
            return []
        Emp = request.env["hr.employee"].sudo()
        emp_ids = [employee.id]
        try:
            if getattr(employee, "user_id", False):
                emp_ids = Emp.search([("user_id", "=", employee.user_id.id)]).ids or emp_ids
            elif "hrmis_employee_id" in employee._fields and employee.hrmis_employee_id:
                emp_ids = Emp.search([("hrmis_employee_id", "=", employee.hrmis_employee_id)]).ids or emp_ids
        except Exception:
            return emp_ids
        return emp_ids

    def _leave_days_value(self, leave) -> float:
        """
        Best-effort leave days value.
        Prefer Odoo computed fields if available; fall back to calendar-day count.
        """
        if not leave:
            return 0.0
        for f in ("number_of_days_display", "number_of_days"):
            try:
                if f in leave._fields:
                    v = getattr(leave, f, 0.0) or 0.0
                    return float(v)
            except Exception:
                continue
        try:
            d_from = getattr(leave, "request_date_from", None)
            d_to = getattr(leave, "request_date_to", None)
            if d_from and d_to:
                return float((d_to - d_from).days + 1)
        except Exception:
            pass
        return 0.0

    def _leave_days_for_duration_display(self, leave) -> float:
        """
        Duration for SO UI + downloads, aligned with HRMIS Sunday-only policy.

        - For partial leaves (hours / half / custom): keep Odoo's computed duration.
        - For day-based leaves: prefer HRMIS effective days if available.
        """
        if not leave:
            return 0.0

        try:
            is_partial = bool(
                ("request_unit_half" in leave._fields and leave.request_unit_half)
                or ("request_unit_hours" in leave._fields and leave.request_unit_hours)
                or ("request_unit_custom" in leave._fields and leave.request_unit_custom)
            )
        except Exception:
            is_partial = False

        if is_partial:
            return float(self._leave_days_value(leave) or 0.0)

        d_from = None
        d_to = None
        try:
            d_from = getattr(leave, "request_date_from", None)
            d_to = getattr(leave, "request_date_to", None)
            if (
                getattr(leave, "employee_id", False)
                and d_from
                and d_to
                and hasattr(leave, "_hrmis_effective_days")
            ):
                v = float(leave._hrmis_effective_days(leave.employee_id, d_from, d_to) or 0.0)
                if v > 0:
                    return v
        except Exception:
            pass

        v = float(self._leave_days_value(leave) or 0.0)
        if v > 0:
            return v

        # Last-resort: if we still got 0 but dates are valid, show inclusive days.
        try:
            if d_from and d_to and d_to >= d_from:
                return float((d_to - d_from).days + 1)
        except Exception:
            pass
        return 0.0

    @staticmethod
    def _format_days(days: float) -> str:
        try:
            d = float(days or 0.0)
        except Exception:
            d = 0.0
        if abs(d - round(d)) < 1e-6:
            n = int(round(d))
            unit = "day" if n == 1 else "days"
            return f"{n} {unit}"
        unit = "day" if abs(d - 1.0) < 1e-6 else "days"
        return f"{d:.1f} {unit}"

    @http.route(
        ["/hrmis/leave/<int:leave_id>/attachment/<int:att_id>"],
        type="http",
        auth="user",
        website=True,
        methods=["GET"],
        csrf=False,
    )
    def hrmis_leave_attachment(self, leave_id: int, att_id: int, download: str = "0", **kw):
        """
        Serve supporting-doc attachments to approvers/section officers.

        We can't rely on `/web/content/<id>` because `ir.attachment` rules often
        block access for non-owners. Here we verify the user can access the leave,
        then stream the attachment with sudo.
        """
        lv = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not lv:
            return request.not_found()

        is_hr = bool(
            request.env.user.has_group("hr_holidays.group_hr_holidays_user")
            or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
        )
        if not is_hr:
            try:
                is_pending_for_me = leave_pending_for_current_user(lv)
                is_managed = self._is_record_managed_by_current_user(lv)
            except Exception:
                is_pending_for_me = False
                is_managed = False
            if not (is_pending_for_me or is_managed):
                return request.not_found()

        att = request.env["ir.attachment"].sudo().browse(att_id).exists()
        if not att or (att.res_model != "hr.leave") or (int(att.res_id or 0) != int(lv.id)):
            return request.not_found()

        try:
            raw = base64.b64decode(att.datas or b"")
        except Exception:
            raw = b""

        is_download = str(download or "0").strip().lower() in ("1", "true", "yes", "y")
        dispo = "attachment" if is_download else "inline"

        cd = content_disposition(att.name or "document")
        if dispo == "inline" and cd.startswith("attachment"):
            cd = "inline" + cd[len("attachment") :]

        headers = [
            ("Content-Type", att.mimetype or "application/octet-stream"),
            ("Content-Length", str(len(raw))),
            ("Content-Disposition", cd),
        ]
        return request.make_response(raw, headers)
    def _section_officer_employee_ids(self):
        """Return hr.employee ids linked to current user.

        Note: Some databases may contain multiple hr.employee rows for one user.
        Using employee ids (not user ids) avoids accidental overlap if manager
        linkage is done via hr.employee.parent_id.
        """
        Emp = request.env["hr.employee"].sudo()
        return Emp.search([("user_id", "=", request.env.user.id)]).ids

    def _managed_employee_ids(self):
        """Return employee ids managed by the current section officer.

        Your Odoo DB uses `hr.employee.employee_parent_id` as the manager field.
        We scan all employees and select those where:
          employee.employee_parent_id in (current user's employee ids)

        This is the single source of truth for "which employees belong to this SO".
        """
        so_emp_ids = self._section_officer_employee_ids()
        if not so_emp_ids:
            return []

        Emp = request.env["hr.employee"].sudo()
        if "employee_parent_id" in Emp._fields:
            return Emp.search([("employee_parent_id", "in", so_emp_ids)]).ids
        # Fallback for older schemas
        return Emp.search([("parent_id", "in", so_emp_ids)]).ids

    def _canonical_employee(self, employee):
        """Try to resolve duplicate employee rows to a single 'canonical' record.

        In some databases, the same real-world person can exist as multiple
        hr.employee rows (often with the same name / HRMIS service number),
        and leave/allocation requests may be linked to different rows. We
        canonicalize using user_id first, then HRMIS service number, to make
        manager matching consistent and avoid showing the "same employee"
        under multiple section officers.
        """
        if not employee:
            return None

        Emp = request.env["hr.employee"].sudo()
        candidates = Emp.browse([])

        if getattr(employee, "user_id", False):
            candidates = Emp.search([("user_id", "=", employee.user_id.id)], order="id desc")
        elif "hrmis_employee_id" in employee._fields and employee.hrmis_employee_id:
            candidates = Emp.search([("hrmis_employee_id", "=", employee.hrmis_employee_id)], order="id desc")
        else:
            return employee

        if not candidates:
            return employee

        # Prefer active record if available.
        if "active" in candidates._fields:
            active = candidates.filtered(lambda e: e.active)
            if active:
                candidates = active

        # Prefer the row that actually has a manager set.
        with_parent = candidates.filtered(lambda e: getattr(e, "parent_id", False))
        if with_parent:
            return with_parent[0]
        return candidates[0]

    def _is_record_managed_by_current_user(self, record) -> bool:
        if not record or not getattr(record, "employee_id", False):
            return False
        return record.employee_id.id in set(self._managed_employee_ids())

    def _responsible_manager_emp(self, employee):
        """Pick exactly one manager employee record for matching."""
        employee = self._canonical_employee(employee)
        if not employee:
            return None
        # 1) Standard Odoo HR manager field.
        if getattr(employee, "parent_id", False):
            return employee.parent_id
        # 2) Department manager (common alternative setup).
        if (
            "department_id" in employee._fields
            and employee.department_id
            and getattr(employee.department_id, "manager_id", False)
        ):
            return employee.department_id.manager_id
        # 3) Coach fallback (some DBs use coach as manager).
        if "coach_id" in employee._fields and getattr(employee, "coach_id", False):
            return employee.coach_id
        return None

    def _is_managed_by_current_user(self, employee) -> bool:
        mgr = self._responsible_manager_emp(employee)
        if not mgr:
            return False
        return mgr.id in set(self._section_officer_employee_ids())

    @http.route(["/hrmis/leave/<int:leave_id>"], type="http", auth="user", website=True)
    def hrmis_leave_view(self, leave_id: int, **kw):
        lv = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not lv:
            return request.not_found()

        # Section officers should only see requests for employees they manage,
        # unless they are HR (who can access via other menus anyway).
        # Section officers can view:
        # - requests pending their action (multi-level approver logic), OR
        # - requests for employees they manage (legacy manager-based logic), OR
        # - HR users can view as usual.
        is_hr = bool(
            request.env.user.has_group("hr_holidays.group_hr_holidays_user")
            or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
        )
        if not is_hr:
            is_pending_for_me = leave_pending_for_current_user(lv)
            is_managed = self._is_record_managed_by_current_user(lv)
            if not (is_pending_for_me or is_managed):
                return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")
        # Get the last approver correctly
        pending = lv.pending_approver_ids.sorted(key=lambda u: u.id)
        show_approve_text = pending and pending[-1].user_id.id == request.env.user.id
        return request.render(
            "hr_holidays_updates.hrmis_leave_view",
            base_ctx("Leave request", "manage_requests", leave=lv, show_approve_text=show_approve_text,),
        )

    #IMPORTANT: This route is being called by the approve button
    @http.route(
        ["/hrmis/leave/<int:leave_id>/approve"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )

    def hrmis_leave_approve(self, leave_id: int, **post):
        _logger.warning("🔥 APPROVE ROUTE HIT for leave_id=%s", leave_id)

        leave = request.env["hr.leave"].sudo().browse(leave_id)
        if not leave:
            _logger.warning("⚠ Leave not found for leave_id=%s", leave_id)
            return request.redirect(
                "/hrmis/manage/requests?tab=leave&error=Leave Not Found"
            )

        current_user = request.env.user
        leave._ensure_custom_approval_initialized()

        if not leave.is_pending_for_user(current_user):
            _logger.warning("⛔ User %s not authorized to approve leave_id=%s", current_user.id, leave_id)
            return request.redirect(
                "/hrmis/manage/requests?tab=leave&error=not_authorized"
            )

        action = (post.get("action") or "approve").strip().lower()
        comment = (post.get("comment") or "").strip() or None

        # ------------------------------
        # Optional date updates with logging
        # ------------------------------
        dt_from = (post.get("date_from") or "").strip()
        dt_to = (post.get("date_to") or "").strip()
        _logger.info("📅 Received date_from='%s', date_to='%s'", dt_from, dt_to)

        if dt_from and dt_to:
            _logger.info("🔄 Entered date update block for leave_id=%s", leave_id)
            try:
                d_from = fields.Date.to_date(dt_from)
                d_to = fields.Date.to_date(dt_to)
                _logger.info("✅ Parsed dates: d_from=%s, d_to=%s", d_from, d_to)

                if not d_from or not d_to:
                    _logger.warning("⚠ Failed to parse dates from input")
                elif d_to < d_from:
                    _logger.warning("⛔ End date %s is before start date %s", d_to, d_from)
                    return request.redirect(
                        "/hrmis/manage/requests?tab=leave&error=End+date+cannot+be+before+start+date"
                    )
                else:
                    if leave.request_date_from != d_from or leave.request_date_to != d_to:
                        leave.with_context(
                            mail_notrack=True,
                            mail_create_nolog=True
                        ).sudo().write({
                            "request_date_from": d_from,
                            "request_date_to": d_to,
                        })

                    _logger.info("✏️ Leave dates updated for leave_id=%s: %s -> %s", leave_id, d_from, d_to)
            except Exception as e:
                _logger.exception("⚠ Exception while updating leave dates: %s", e)
                return request.redirect(
                    "/hrmis/manage/requests?tab=leave&error=Invalid+date+format"
                )
        else:
            _logger.info("ℹ️ No date update provided for leave_id=%s", leave_id)

        # ------------------------------
        # Approve or Dismiss logic
        # ------------------------------
        try:
            if action == "dismiss":
                _logger.info("❌ Rejecting leave_id=%s", leave_id)
                if comment:
                    leave.sudo().message_post(
                        body=comment,
                        message_type="comment",
                        subtype_xmlid="mail.mt_comment",
                        author_id=current_user.partner_id.id,
                    )

                rec = leave.sudo()
                if hasattr(rec, "action_refuse"):
                    rec.action_refuse()
                elif hasattr(rec, "action_reject"):
                    rec.action_reject()
                else:
                    rec.write({"state": "refuse"})
            else:
                _logger.info("✅ Approving leave_id=%s", leave_id)
                leave.with_user(current_user).action_approve_by_user(comment=comment)

        except (UserError, AccessError) as e:
            msg = getattr(e, "name", None) or getattr(e, "args", ["error"])[0]
            _logger.warning("⚠ Approval error for leave_id=%s: %s", leave_id, msg)
            return request.redirect(
                "/hrmis/manage/requests?tab=leave&error=%s" % http.url_quote(str(msg))
            )

        except Exception as e:
            _logger.exception("💥 Unexpected leave approval error for leave_id=%s", leave_id)
            return request.redirect(
                "/hrmis/manage/requests?tab=leave&error=approve_failed"
            )

        return request.redirect(
            "/hrmis/manage/requests?tab=leave&success=%s"
            % ("Leave request rejected" if action == "dismiss" else "Leave request approved")
        )




    @http.route(
        ["/hrmis/leave/<int:leave_id>/history-view"],
        type="http",
        auth="user",
        website=True,
    )
    def hrmis_leave_history_view(self, leave_id: int, **kw):
        leave = request.env["hr.leave"].sudo().browse(leave_id)
        if not leave:
            return request.not_found()

        # Ensure only the requester sees it
        if leave.employee_id.user_id.id != request.env.user.id:
            return request.redirect("/hrmis/services?error=not_allowed")

        pending_names = (
        ", ".join(leave.pending_approver_ids.mapped("name"))
        if leave.pending_approver_ids
        else "-"
        )      

        back_url = f"/hrmis/staff/{leave.employee_id.id}/leave?tab=history"
        return request.render(
            "hr_holidays_updates.hrmis_leave_view_history",
            {
                "leave": leave,
                "pending_names": pending_names,
                "back_url": back_url,
            },
        )



    
    

    @http.route(["/hrmis/manage/requests"], type="http", auth="user", website=True)
    def hrmis_manage_requests(self, tab: str = "leave", success=None, error=None, **kw):
        uid = request.env.user.id

        leaves = []
        leave_history = []
        leave_taken_by_leave_id = {}
        leave_duration_days_by_leave_id = {}
        leave_duration_text_by_leave_id = {}
        is_last_approver_by_leave = {}
        transfer_requests = request.env["hrmis.transfer.request"].browse([])
        vacancy_by_transfer_id = {}
        can_approve_by_transfer_id = {}
        filter_pack = {}
        tv_groups = []
        tv_summary = {}
        tv_summary_by_so = []
        district_id = facility_id = bps = designation_id = False
        is_last_approver_by_tr_id = {}
        last_comment_by_tr_id = {}
        comments_by_tr_id = {}
        last_comment_by_tr_id = {}
        remarks_by_tr_id = {}
        remarks_items_by_tr_id = {}
        
        # Decide which tab is active
        tab = tab or "leave"

        if tab == "leave":
            leaves, is_last_approver_by_leave = pending_leave_requests_for_user(uid)

            try:
                if leaves:
                    leave_ids = leaves.ids
                    type_ids = leaves.mapped("holiday_status_id").ids

                    Emp = request.env["hr.employee"].sudo()
                    root_emp_ids = leaves.mapped("employee_id").ids

                    emp_id_to_root = {}
                    all_person_emp_ids = set()

                    for emp in Emp.browse(root_emp_ids):
                        grp = self._employee_group_ids_for_person(emp)
                        for e_id in grp:
                            emp_id_to_root[e_id] = emp.id
                            all_person_emp_ids.add(e_id)

                    taken_by_root_type = {}

                    if all_person_emp_ids and type_ids:
                        approved = request.env["hr.leave"].sudo().search(
                            [
                                ("employee_id", "in", list(all_person_emp_ids)),
                                ("holiday_status_id", "in", type_ids),
                                ("state", "in", ("validate", "validate2")),
                            ]
                        )

                        for alv in approved:
                            root_id = emp_id_to_root.get(
                                alv.employee_id.id, alv.employee_id.id
                            )
                            lt_id = alv.holiday_status_id.id if alv.holiday_status_id else None
                            if not lt_id:
                                continue

                            taken_by_root_type[(root_id, lt_id)] = (
                                taken_by_root_type.get((root_id, lt_id), 0.0)
                                + self._leave_days_value(alv)
                            )

                    for lv in leaves:
                        root_id = (
                            emp_id_to_root.get(lv.employee_id.id, lv.employee_id.id)
                            if lv.employee_id
                            else None
                        )
                        lt_id = lv.holiday_status_id.id if lv.holiday_status_id else None
                        leave_taken_by_leave_id[lv.id] = float(
                            taken_by_root_type.get((root_id, lt_id), 0.0)
                        )

                        # Duration shown in the SO table: align with HRMIS Sunday-only policy.
                        try:
                            dur = float(self._leave_days_for_duration_display(lv) or 0.0)
                        except Exception:
                            dur = 0.0
                        leave_duration_days_by_leave_id[lv.id] = dur
                        leave_duration_text_by_leave_id[lv.id] = self._format_days(dur)

            except Exception:
                _logger.exception("Failed preparing Manage Requests UI data")

        elif tab == "history":
            leave_history = leave_request_history_for_user(uid)

        elif tab == "transfer_requests":
            Transfer = request.env["hrmis.transfer.request"].sudo()
            managed_emp_ids = self._managed_employee_ids()

            # init dicts (safe if already defined)
            vacancy_by_transfer_id = vacancy_by_transfer_id if "vacancy_by_transfer_id" in locals() else {}
            can_approve_by_transfer_id = can_approve_by_transfer_id if "can_approve_by_transfer_id" in locals() else {}
            is_last_approver_by_tr_id = is_last_approver_by_tr_id if "is_last_approver_by_tr_id" in locals() else {}
            last_comment_by_tr_id = last_comment_by_tr_id if "last_comment_by_tr_id" in locals() else {}
            remarks_by_tr_id = remarks_by_tr_id if "remarks_by_tr_id" in locals() else {}

            domain = [("state", "=", "submitted")]

            is_hr_mgr = request.env.user.has_group("hr.group_hr_manager")
            is_sys = request.env.user.has_group("base.group_system")

            _logger.warning(
                "[TR][REQ] user=%s(%s) hr_mgr=%s sys=%s managed_emp_ids=%s",
                request.env.user.login, request.env.user.id, is_hr_mgr, is_sys, managed_emp_ids
            )

            approver_res_ids = []
            Status = request.env["hrmis.approval.status"].sudo()

            if is_hr_mgr or is_sys:
                _logger.warning("[TR][REQ] HR/Admin -> no extra domain filters")
            else:
                # 🔎 visibility query
                vis_domain = [
                    ("res_model", "=", "hrmis.transfer.request"),
                    ("approved", "=", False),
                    ("user_id", "=", request.env.user.id),
                    ("is_current", "=", True),
                ]
                _logger.warning("[TR][REQ] visibility status domain=%s", vis_domain)

                status_rows = Status.search(vis_domain)
                approver_res_ids = status_rows.mapped("res_id")

                _logger.warning(
                    "[TR][REQ] visibility statuses found=%s status_ids=%s approver_res_ids=%s",
                    len(status_rows), status_rows.ids, approver_res_ids
                )

                for s in status_rows[:30]:
                    _logger.warning(
                        "[TR][REQ][S] id=%s res_id=%s user=%s approved=%s is_current=%s flow_seq=%s seq=%s type=%s flow_id=%s",
                        s.id, s.res_id, s.user_id.login if s.user_id else None,
                        getattr(s, "approved", None),
                        getattr(s, "is_current", None),
                        getattr(s, "flow_sequence", None),
                        getattr(s, "sequence", None),
                        getattr(s, "sequence_type", None),
                        s.flow_id.id if s.flow_id else None,
                    )

                domain += [("id", "in", approver_res_ids or [-1])]
                _logger.warning("[TR][REQ] Final domain=%s", domain)

            transfer_requests = Transfer.search(
                domain,
                order="submitted_on desc, create_date desc, id desc",
                limit=200
            )
            _logger.warning(
                "[TR][REQ] transfer_requests found=%s ids=%s",
                len(transfer_requests), transfer_requests.ids
            )

            # ---------------------------------------------------------------------
            # One status fetch for ALL TRs (used for comments + last approver)
            # ---------------------------------------------------------------------
            all_statuses = Status.search([
                ("res_model", "=", "hrmis.transfer.request"),
                ("res_id", "in", transfer_requests.ids),
            ], order="flow_sequence asc, sequence asc, id asc")

            by_tr = {}
            for st in all_statuses:
                by_tr.setdefault(st.res_id, []).append(st)

            uid = request.env.user.id

            # ---------------------------------------------------------------------
            # Comments + Remarks + Last approver per TR
            # ---------------------------------------------------------------------
            for tr in transfer_requests:
                rows = by_tr.get(tr.id, [])

                # ---- 1) COMMENTS: only approved rows with a real comment
                approved_comments = [
                    r for r in rows
                    if r.approved and (r.comment and str(r.comment).strip())
                ]

                # sort by commented_on / approved_on / id best effort
                def _dt(r):
                    return r.commented_on or r.approved_on or fields.Datetime.from_string("1970-01-01 00:00:00")

                approved_comments = sorted(approved_comments, key=lambda r: (_dt(r), int(r.sequence or 0), int(r.id or 0)))


                items = []
                for r in approved_comments:
                    items.append({
                        "user_name": (r.user_id.name if r.user_id else "-"),
                        "comment": (r.comment or "").strip() or "No Comment",
                    })

                remarks_items_by_tr_id[tr.id] = items
                # table last comment
                if approved_comments:
                    last = approved_comments[-1]
                    last_comment_by_tr_id[tr.id] = {
                        "user_name": last.user_id.name if last.user_id else "-",
                        "user_login": last.user_id.login if last.user_id else "",
                        "sequence": int(last.sequence or 0),
                        "comment": (last.comment or "").strip(),
                        "when": last.commented_on or last.approved_on,
                    }
                else:
                    last_comment_by_tr_id[tr.id] = False

                # modal single remarks string (ONE block)
                remark_lines = []
                for r in approved_comments:
                    uname = (r.user_id.name or "-") if r.user_id else "-"
                    cmt = (r.comment or "").strip() or "No Comment"
                    remark_lines.append(f"{uname}: {cmt}")

                remarks_by_tr_id[tr.id] = "\n".join(remark_lines).strip()

                # ---- 2) LAST APPROVER LOGIC (only meaningful for non HR/Admin)
                if is_hr_mgr or is_sys:
                    is_last_approver_by_tr_id[tr.id] = True  # admins effectively "final"
                    continue

                my_row = next(
                    (
                        r for r in rows
                        if r.user_id and r.user_id.id == uid
                        and not r.approved
                        and r.is_current
                    ),
                    None
                )
                if not my_row:
                    is_last_approver_by_tr_id[tr.id] = False
                    continue

                pending_seqs = [
                    int(getattr(r, "sequence", 0) or 0)
                    for r in rows
                    if not r.approved
                ]
                max_pending_seq = max(pending_seqs) if pending_seqs else 0
                my_seq = int(getattr(my_row, "sequence", 0) or 0)
                is_last_approver_by_tr_id[tr.id] = (my_seq == max_pending_seq)

            # ---------------------------------------------------------------------
            # Debug why visible
            # ---------------------------------------------------------------------
            if not (is_hr_mgr or is_sys):
                managed_set = set(managed_emp_ids or [])
                approver_set = set(approver_res_ids or [])
                for tr in transfer_requests[:50]:
                    why_mgr = tr.employee_id.id in managed_set if tr.employee_id else False
                    why_app = tr.id in approver_set
                    _logger.warning(
                        "[TR][REQ] TR id=%s name=%s state=%s visible_by_manager=%s visible_by_approver=%s pending_with=%s approval_step=%s",
                        tr.id, tr.name, tr.state, why_mgr, why_app,
                        getattr(tr, "pending_with", None),
                        getattr(tr, "approval_step", None),
                    )

            # ---------------------------------------------------------------------
            # Vacancy
            # ---------------------------------------------------------------------
            Allocation = request.env["hrmis.facility.designation"].sudo()
            for tr in transfer_requests:
                total = occupied = vacant = 0
                alloc = False

                if tr.required_facility_id and tr.required_designation_id:
                    alloc = Allocation.search([
                        ("facility_id", "=", tr.required_facility_id.id),
                        ("designation_id", "=", tr.required_designation_id.id),
                    ], limit=1)

                if alloc:
                    total = int(getattr(alloc, "total_sanctioned_posts", 0) or 0) \
                        or int(getattr(alloc, "sanctioned_posts", 0) or 0) \
                        or int(getattr(alloc, "total_posts", 0) or 0)

                    if not total:
                        total = int(getattr(tr.required_designation_id, "total_sanctioned_posts", 0) or 0)

                    occupied = int(getattr(alloc, "occupied_posts", 0) or 0)
                    vacant = max(total - occupied, 0)
                else:
                    total = int(getattr(tr.required_designation_id, "total_sanctioned_posts", 0) or 0)
                    occupied = 0
                    vacant = max(total - occupied, 0)

                vacancy_by_transfer_id[tr.id] = {"total": total, "occupied": occupied, "vacant": vacant}
                can_approve_by_transfer_id[tr.id] = bool(tr.required_designation_id)

                _logger.warning(
                    "[TR][VAC] tr=%s alloc_id=%s total=%s occupied=%s vacant=%s req_fac=%s req_desig=%s",
                    tr.id, alloc.id if alloc else None, total, occupied, vacant,
                    tr.required_facility_id.id if tr.required_facility_id else None,
                    tr.required_designation_id.id if tr.required_designation_id else None,
                )

            _logger.warning(
                "[TR][CTX] vac_len=%s keys_sample=%s",
                len(vacancy_by_transfer_id),
                list(vacancy_by_transfer_id.keys())[:10]
            )



        
        elif tab == "transfer_status":
            Transfer = request.env["hrmis.transfer.request"].sudo()
            managed_emp_ids = self._managed_employee_ids()

            is_hr_mgr = request.env.user.has_group("hr.group_hr_manager")
            is_sys = request.env.user.has_group("base.group_system")

            domain = []

            if not (is_hr_mgr or is_sys):
                Status = request.env["hrmis.approval.status"].sudo()

                # All TRs where current user appears in the approval chain (past or present)
                approver_res_ids = Status.search([
                    ("res_model", "=", "hrmis.transfer.request"),
                    ("user_id", "=", request.env.user.id),
                    ("res_id", "!=", False),
                ]).mapped("res_id")

                # Manager OR Approver
                domain = [
                    "|",
                    ("employee_id", "in", managed_emp_ids or [-1]),
                    ("id", "in", approver_res_ids or [-1]),
                ]

            transfer_requests = Transfer.search(
                domain,
                order="submitted_on desc, create_date desc, id desc",
                limit=200
            )

            Allocation = request.env["hrmis.facility.designation"].sudo()

            for tr in transfer_requests:
                total = occupied = vacant = 0
                alloc = False

                if tr.required_facility_id and tr.required_designation_id:
                    alloc = Allocation.search([
                        ("facility_id", "=", tr.required_facility_id.id),
                        ("designation_id", "=", tr.required_designation_id.id),
                    ], limit=1)

                occupied = int(getattr(alloc, "occupied_posts", 0) or 0) if alloc else 0
                total = int(getattr(tr.required_designation_id, "total_sanctioned_posts", 0) or 0) if tr.required_designation_id else 0
                vacant = max(total - occupied, 0)

                vacancy_by_transfer_id[tr.id] = {"total": total, "occupied": occupied, "vacant": vacant}
                can_approve_by_transfer_id[tr.id] = bool(tr.required_designation_id)

        elif tab == "transfer_vacancies":
            district_id = (kw.get("district_id") or "").strip() or False
            facility_id = (kw.get("facility_id") or "").strip() or False
            bps = (kw.get("bps") or "").strip() or False
            designation_id = (kw.get("designation_id") or "").strip() or False

            current_user = request.env.user

            filter_pack = self._get_transfer_vacancy_filters(
                selected_district_id=district_id,
                selected_facility_id=facility_id,
                selected_bps=bps,
                user=current_user,
            )

            tv_groups, tv_summary = self._get_transfer_vacancies_grouped(
                district_id=district_id,
                facility_id=facility_id,
                bps=bps,
                designation_id=designation_id,
                limit=None,
                user=current_user,
            )

            so_users = self._get_section_officer_users()
            tv_summary_by_so = []

            for so in so_users:
                overall = self._get_transfer_summary_for_user(
                    so_user=so,
                    district_id=district_id,
                    facility_id=facility_id,
                    bps=bps,
                    designation_id=designation_id,
                )

                # If unmapped SOs should show 0s, they will automatically because your deny logic returns empty data
                tv_summary_by_so.append({
                    "user_id": so.id,
                    "login": so.login,
                    "name": so.name,
                    "summary": overall or {"total": 0, "occupied": 0, "vacant": 0, "facilities": 0},
                })
        else:
            # fallback safety
            tab = "leave"
            leaves, is_last_approver_by_leave = pending_leave_requests_for_user(uid)
        return request.render(
            "custom_section_officers.hrmis_manage_requests",
            base_ctx(
                "Manage Requests",
                "manage_requests",
                tab=tab,
                leaves=leaves,
                leave_history=leave_history,
                leave_taken_by_leave_id=leave_taken_by_leave_id,
                leave_duration_days_by_leave_id=leave_duration_days_by_leave_id,
                leave_duration_text_by_leave_id=leave_duration_text_by_leave_id,
                is_last_approver_by_leave=is_last_approver_by_leave,
                transfer_requests=transfer_requests,
                vacancy_by_transfer_id=vacancy_by_transfer_id,
                can_approve_by_transfer_id=can_approve_by_transfer_id,
                
                tv_districts=(filter_pack.get("districts") if (tab == "transfer_vacancies" and filter_pack) else []),
                tv_facilities=(filter_pack.get("facilities") if (tab == "transfer_vacancies" and filter_pack) else []),
                tv_bps_values=(filter_pack.get("bps_values") if (tab == "transfer_vacancies" and filter_pack) else []),
                tv_designations=(filter_pack.get("designations") if (tab == "transfer_vacancies" and filter_pack) else []),
                tv_selected_district_id=(int(district_id) if (tab == "transfer_vacancies" and district_id) else False),
                tv_selected_facility_id=(int(facility_id) if (tab == "transfer_vacancies" and facility_id) else False),
                tv_selected_bps=(int(bps) if (tab == "transfer_vacancies" and bps) else False),
                tv_selected_designation_id=(int(designation_id) if (tab == "transfer_vacancies" and designation_id) else False),
                transfer_vacancies_grouped=(tv_groups if tab == "transfer_vacancies" else []),
                transfer_vacancies_summary=(tv_summary if tab == "transfer_vacancies" else {}),
                # tv_summary_by_so=(tv_summary_by_so if tab == "transfer_vacancies" else []),
                is_last_approver_by_tr_id=is_last_approver_by_tr_id,
                last_comment_by_tr_id= last_comment_by_tr_id,
                comments_by_tr_id= comments_by_tr_id,
                remarks_by_tr_id= remarks_by_tr_id,
                remarks_items_by_tr_id= remarks_items_by_tr_id,
                success=success,
                error=error,
            ),
        )


    @http.route(
        ["/hrmis/transfer/<int:transfer_id>/approve"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_transfer_approve(self, transfer_id: int, **post):
        tr = request.env["hrmis.transfer.request"].browse(transfer_id).exists()
        if not tr:
            return request.not_found()

        if tr.state != "submitted":
            return request.redirect("/hrmis/manage/requests?tab=transfer_requests&error=invalid_state")

        comment = (post.get("comment") or "").strip()
        try:
            if comment:
                tr.sudo().message_post(
                    body=comment,
                    message_type="comment",
                    subtype_xmlid="mail.mt_comment",
                    author_id=request.env.user.partner_id.id,
                )
            tr.action_approve()
        except UserError as e:
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&error=%s" % http.url_quote(e.name)
            )
        except Exception:
            _logger.exception("Transfer approval failed for transfer_id=%s", transfer_id)
            return request.redirect("/hrmis/manage/requests?tab=transfer_requests&error=approve_failed")

        return request.redirect("/hrmis/manage/requests?tab=transfer_requests&success=approved")

    @http.route(
        ["/hrmis/transfer/<int:transfer_id>/action"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_transfer_action(self, transfer_id: int, **post):
        tr = request.env["hrmis.transfer.request"].browse(transfer_id).exists()
        if not tr:
            return request.not_found()

        if tr.state != "submitted":
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&error=Transfer+request+is+not+pending"
            )

        decision = (post.get("decision") or "approve").strip().lower()
        comment = (post.get("comment") or "").strip() or "No Comment"

        try:
            if decision == "dismiss":
                tr.with_context(hrmis_dismiss=True).action_reject()
                return request.redirect(
                    "/hrmis/manage/requests?tab=transfer_requests&success=Transfer+request+dismissed"
                )

            tr.action_approve_by_user(comment=comment)
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&success=Transfer+request+approved"
            )

        except UserError as e:
            msg = e.args[0] if e.args else "Action failed"
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&error=%s" % http.url_quote(msg)
            )

        except Exception:
            _logger.exception("Transfer decision failed for transfer_id=%s", transfer_id)
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&error=Action+failed"
            )

    @http.route(
        ["/hrmis/transfer/<int:transfer_id>/reject"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_transfer_reject(self, transfer_id: int, **post):
        tr = request.env["hrmis.transfer.request"].browse(transfer_id).exists()
        if not tr:
            return request.not_found()

        if tr.state != "submitted":
            return request.redirect("/hrmis/manage/requests?tab=transfer_requests&error=invalid_state")

        reject_reason = (post.get("reject_reason") or "").strip()
        comment = (post.get("comment") or "").strip()
        try:
            if reject_reason:
                tr.write({"reject_reason": reject_reason})
            if comment:
                tr.sudo().message_post(
                    body=comment,
                    message_type="comment",
                    subtype_xmlid="mail.mt_comment",
                    author_id=request.env.user.partner_id.id,
                )
            tr.action_reject()
        except UserError as e:
            return request.redirect(
                "/hrmis/manage/requests?tab=transfer_requests&error=%s" % http.url_quote(e.name)
            )
        except Exception:
            _logger.exception("Transfer rejection failed for transfer_id=%s", transfer_id)
            return request.redirect("/hrmis/manage/requests?tab=transfer_requests&error=reject_failed")

        return request.redirect("/hrmis/manage/requests?tab=transfer_requests&success=rejected")

    @http.route(
        ["/hrmis/manage/history/<int:employee_id>"],
        type="http",
        auth="user",
        website=True,
    )
    def hrmis_manage_history(self, employee_id: int, tab: str = "leave", **kw):
        """
        Employee-centric history page for Section Officers.
        """
        Emp = request.env["hr.employee"].sudo()
        employee = Emp.browse(employee_id).exists()
        if not employee:
            return request.not_found()

        # Access control: section officers can only view employees they manage (HR can view).
        is_hr = bool(
            request.env.user.has_group("hr_holidays.group_hr_holidays_user")
            or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
        )
        managed_ok = employee.id in set(self._managed_employee_ids())

        approver_ok = False
        if not is_hr and not managed_ok:
            # ✅ allow if user is in approval chain for ANY transfer request of this employee/group
            group_emp_ids = self._employee_group_ids_for_person(employee) or [employee.id]

            Transfer = request.env["hrmis.transfer.request"].sudo()
            tr_ids = Transfer.search([
                ("employee_id", "in", group_emp_ids),
                ("state", "!=", "draft"),
            ], limit=500).ids

            if tr_ids:
                Status = request.env["hrmis.approval.status"].sudo()
                approver_ok = bool(Status.search_count([
                    ("res_model", "=", "hrmis.transfer.request"),
                    ("user_id", "=", request.env.user.id),
                    ("res_id", "in", tr_ids),
                ]))

        if not (is_hr or managed_ok or approver_ok):
            return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")


        tab = (tab or "leave").strip().lower()
        if tab not in ("leave", "history", "transfer", "disciplinary", "profile"):
            tab = "leave"

        # Facility / district labels (best-effort across schemas)
        facility = getattr(employee, "facility_id", False) or getattr(employee, "hrmis_facility_id", False)
        district = getattr(employee, "district_id", False) or getattr(employee, "hrmis_district_id", False)
        facility_name = facility.name if facility else ""
        district_name = district.name if district else ""

        group_emp_ids = self._employee_group_ids_for_person(employee) or [employee.id]
        Leave = request.env["hr.leave"].sudo()
        Transfer = request.env["hrmis.transfer.request"].sudo()

        leaves_history = Leave.browse([])
        leave_history = Leave.browse([])
        leave_taken_by_type = {}
        transfers_history = Transfer.browse([])

        if tab == "leave":
            leaves_history = Leave.search(
                [("employee_id", "in", group_emp_ids)],
                order="request_date_from desc, id desc",
                limit=200,
            )
            approved = Leave.search(
                [
                    ("employee_id", "in", group_emp_ids),
                    ("state", "in", ("validate", "validate2")),
                ],
                order="id desc",
            )
            for lv in approved:
                lt_id = lv.holiday_status_id.id if lv.holiday_status_id else None
                if not lt_id:
                    continue
                leave_taken_by_type[lt_id] = float(leave_taken_by_type.get(lt_id, 0.0) + self._leave_days_value(lv))

        elif tab == "history":
            leave_history = Leave.search(
                [("employee_id", "in", group_emp_ids)],
                order="request_date_from desc, id desc",
                limit=200,
            )
        elif tab == "transfer":
            transfers_history = Transfer.search(
                [("employee_id", "in", group_emp_ids), ("state", "!=", "draft")],
                order="submitted_on desc, create_date desc, id desc",
                limit=200,
            )
        # tab == "profile": no extra queries required (employee is enough)
        active_menu = kw.get("active_menu")
        if active_menu == "staff":
            active_menu = "staff"
        else:
            active_menu = "manage_requests"
        return request.render(
            "custom_section_officers.hrmis_manage_history",
            base_ctx(
                "Manage History",
                active_menu,
                tab=tab,
                employee=employee,
                facility_name=facility_name,
                district_name=district_name,
                leaves_history=leaves_history,
                leave_taken_by_type=leave_taken_by_type,
                leave_history=leave_history,
                transfers_history=transfers_history,
            ),
        )

        alloc = request.env["hr.leave.allocation"].sudo().browse(allocation_id).exists()
        if not alloc:
            return request.not_found()

        if not can_manage_allocations():
            is_pending_for_me = allocation_pending_for_current_user(alloc)
            is_managed = self._is_record_managed_by_current_user(alloc)
            if not (is_pending_for_me or is_managed):
                return request.redirect("/hrmis/manage/requests?tab=allocation&error=not_allowed")

        return request.render(
            "custom_section_officers.hrmis_allocation_view",
            base_ctx("Allocation request", "manage_requests", allocation=alloc),
        )

    def leave_request_history_for_user(user_id: int, limit: int = 200):
        """
        Fetch leave requests already acted upon by the user or generally completed,
        to populate the 'Leave Request History' tab.
        """
        Leave = request.env["hr.leave"].sudo()

        domains = []

        # Include leaves where the user was an approver
        if "pending_approver_ids" in Leave._fields:
            domains.append([("state", "in", ("validate", "refuse")), ("pending_approver_ids", "in", [user_id])])

        if "validation_status_ids" in Leave._fields and "pending_approver_ids" not in Leave._fields:
            domains.append(
                [
                    ("state", "in", ("validate", "refuse")),
                    ("validation_status_ids.user_id", "=", user_id),
                ]
            )

        # Include user's own leaves
        if "employee_id" in Leave._fields:
            domains.append([("employee_id.user_id", "=", user_id)])

        # Fallback for HR / manager users to see all completed leaves
        if (
            request.env.user
            and (
                request.env.user.has_group("hr_holidays.group_hr_holidays_user")
                or request.env.user.has_group("hr_holidays.group_hr_holidays_manager")
            )
        ):
            domains.append([("state", "in", ("validate", "refuse"))])

        if not domains:
            return Leave.browse([])

        # Combine domains with OR logic if multiple
        if len(domains) == 1:
            return Leave.search(domains[0], order="request_date_from desc, id desc", limit=limit)

        domain = ["|"] + domains[0] + domains[1]
        for extra in domains[2:]:
            domain = ["|"] + domain + extra

        return Leave.search(domain, order="request_date_from desc, id desc", limit=limit)

    # REAL APPROVAL METHOD
    # @http.route(
    #     ["/hrmis/allocation/<int:allocation_id>/approve"],
    #     type="http",
    #     auth="user",
    #     website=True,
    #     methods=["POST"],
    #     csrf=True,
    # )
    # def hrmis_allocation_approve(self, allocation_id: int, **post):
    #     alloc = request.env["hr.leave.allocation"].sudo().browse(allocation_id).exists()
    #     if not alloc:
    #         return request.not_found()

    #     # For SO Manage Requests, allow only managed employees (HR can still manage all allocations).
    #     # Allow approval only when it's pending for the current user.
    #     if not allocation_pending_for_current_user(alloc):
    #         return request.redirect("/hrmis/manage/requests?tab=allocation&error=not_allowed")

    #     try:
    #         if hasattr(alloc, "action_approve"):
    #             alloc.sudo(request.env.user).action_approve()
    #         elif hasattr(alloc, "action_validate"):
    #             alloc.sudo(request.env.user).action_validate()
    #         else:
    #             alloc.sudo().write({"state": "validate"})
    #     except Exception:
    #         return request.redirect("/hrmis/manage/requests?tab=allocation&error=approve_failed")

    #     return request.redirect("/hrmis/manage/requests?tab=allocation&success=approved")

    @http.route(
    ["/hrmis/leave/<int:leave_id>/action"],
    type="http",
    auth="user",
    website=True,
    methods=["POST"],
    csrf=True,
    )
    def hrmis_leave_action(self, leave_id: int, **post):
        lv = request.env["hr.leave"].sudo().browse(leave_id).exists()
        if not lv:
            return request.not_found()

        # Ensure leave is pending for current user
        if not leave_pending_for_current_user(lv):
            return request.redirect("/hrmis/manage/requests?tab=leave&error=not_allowed")

        # Get comment from POST or fallback
        comment = (post.get("comment") or "").strip()
        if not comment:
            comment = "User rejected your approval without a comment"

        action = post.get("action") or "unknown"  # 'approve' or 'dismiss'
        success_messages = {
            "approve": "Leave request approved successfully ✅",
            "dismiss": "Leave request rejected ❌",
        }

        error_messages = {
            "approve": "Approval failed. Please try again ⚠️",
            "dismiss": "Rejection failed. Please try again ⚠️",
            "action_failed": "Action failed due to an unexpected error ⚠️",
        }
        try:
            lv_sudo = lv.sudo()  # always use sudo to bypass access rights

            # Post comment to chatter
            lv_sudo.message_post(
                body=comment,
                message_type="comment",
                subtype_xmlid="mail.mt_comment",
                author_id=request.env.user.partner_id.id,
            )

            # Perform the action
            if action == "approve":
                if hasattr(lv_sudo, "action_approve"):
                    lv_sudo.action_approve()
                elif hasattr(lv_sudo, "action_validate"):
                    lv_sudo.action_validate()
                else:
                    lv_sudo.write({"state": "validate"})
            else:  # dismiss
                if hasattr(lv_sudo, "action_refuse"):
                    lv_sudo.action_refuse()
                elif hasattr(lv_sudo, "action_reject"):
                    lv_sudo.action_reject()
                else:
                    lv_sudo.write({"state": "refuse"})

        except Exception:
            _logger.exception("Leave action failed for leave %s", leave_id)
            return request.redirect("/hrmis/manage/requests?tab=leave&error=%s" % error_messages.get("action_failed"))

        # Redirect with a friendly message
        return request.redirect(
            "/hrmis/manage/requests?tab=leave&success=%s" % success_messages.get(action, "Action completed successfully")
        )




    @http.route(
        ["/hrmis/allocation/<int:allocation_id>/refuse"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_allocation_refuse(self, allocation_id: int, **post):
        alloc = request.env["hr.leave.allocation"].sudo().browse(allocation_id).exists()
        if not alloc:
            return request.not_found()

        # For SO Manage Requests, allow only managed employees (HR can still manage all allocations).
        # Allow refusal only when it's pending for the current user.
        if not allocation_pending_for_current_user(alloc):
            return request.redirect("/hrmis/manage/requests?tab=allocation&error=not_allowed")

        try:
            if hasattr(alloc, "action_refuse"):
                alloc.sudo(request.env.user).action_refuse()
            elif hasattr(alloc, "action_reject"):
                alloc.sudo(request.env.user).action_reject()
            else:
                alloc.sudo().write({"state": "refuse"})
        except Exception:
            return request.redirect("/hrmis/manage/requests?tab=allocation&error=refuse_failed")

        return request.redirect("/hrmis/manage/requests?tab=allocation&success=refused")

    @http.route(
        ["/hrmis/allocation/<int:allocation_id>/dismiss"],
        type="http",
        auth="user",
        website=True,
        methods=["GET", "POST"],
        csrf=True,
    )
    def hrmis_allocation_dismiss(self, allocation_id: int, **post):
        alloc = request.env["hr.leave.allocation"].sudo().browse(allocation_id).exists()
        if not alloc:
            return request.not_found()

        # See note in hrmis_leave_dismiss(): show confirmation on GET to avoid 404.
        if request.httprequest.method == "GET":
            return request.render(
                "custom_section_officers.hrmis_confirm_dismiss",
                base_ctx(
                    "Confirm dismiss",
                    "manage_requests",
                    kind="allocation",
                    record=alloc,
                    post_url=f"/hrmis/allocation/{alloc.id}/dismiss",
                    back_url="/hrmis/manage/requests?tab=allocation",
                ),
            )

        try:
            # Standard hr.leave.allocation does not have a "dismissed" state; use refusal.
            rec = alloc.sudo(request.env.user)
            if hasattr(rec, "action_refuse"):
                rec.action_refuse()
            elif hasattr(rec, "action_reject"):
                rec.action_reject()
            else:
                alloc.sudo().write({"state": "refuse"})
        except Exception:
            return request.redirect("/hrmis/manage/requests?tab=allocation&error=dismiss_failed")

        return request.redirect("/hrmis/manage/requests?tab=allocation&success=dismissed")