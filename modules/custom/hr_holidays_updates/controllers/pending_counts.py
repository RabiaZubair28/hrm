from __future__ import annotations

from odoo import http
from odoo.http import request


class HrmisPendingCountsController(http.Controller):
    @http.route(
        ["/hrmis/api/pending_counts"],
        type="http",
        auth="user",
        methods=["GET"],
        csrf=False,
        website=True,
    )
    def hrmis_api_pending_counts(self, **kw):
        user = request.env.user
        if not user:
            return request.make_json_response(
                {
                    "ok": True,
                    "pending_manage_leave_count": 0,
                    "pending_profile_update_count": 0,
                    "pending_manage_transfer_count": 0,
                }
            )

        pending_manage_leave_count = 0
        pending_profile_update_count = 0
        pending_manage_transfer_count = 0

        # Leave
        try:
            from odoo.addons.hr_holidays_updates.controllers.leave_data import (
                pending_leave_requests_for_user,
            )
            pending_res = pending_leave_requests_for_user(user.id)
            pending_leaves = pending_res[0] if isinstance(pending_res, (list, tuple)) else pending_res
            pending_manage_leave_count = int(len(pending_leaves))
        except Exception:
            pending_manage_leave_count = 0

        # Profile Update
        try:
            ProfileRequest = request.env["hrmis.employee.profile.request"].sudo()
            pending_profile_update_count = int(
                ProfileRequest.search_count(
                    [("approver_id.user_id", "=", user.id), ("state", "=", "submitted")]
                )
            )
        except Exception:
            pending_profile_update_count = 0

        # Transfer (✅ correct for all approvers)
        try:
            Transfer = request.env["hrmis.transfer.request"].sudo()
            Status = request.env["hrmis.approval.status"].sudo()

            is_hr_mgr = user.has_group("hr.group_hr_manager")
            is_sys = user.has_group("base.group_system")

            if is_hr_mgr or is_sys:
                pending_manage_transfer_count = int(
                    Transfer.search_count([("state", "=", "submitted")])
                )
            else:
                vis_domain = [
                    ("res_model", "=", "hrmis.transfer.request"),
                    ("approved", "=", False),
                    ("user_id", "=", user.id),
                    ("is_current", "=", True),
                ]
                status_rows = Status.search(vis_domain)
                approver_res_ids = status_rows.mapped("res_id")

                pending_manage_transfer_count = int(
                    Transfer.search_count([
                        ("state", "=", "submitted"),
                        ("id", "in", approver_res_ids or [-1]),
                    ])
                )
        except Exception:
            pending_manage_transfer_count = 0

        return request.make_json_response(
            {
                "ok": True,
                "pending_manage_leave_count": pending_manage_leave_count,
                "pending_profile_update_count": pending_profile_update_count,
                "pending_manage_transfer_count": pending_manage_transfer_count,
            }
        )
