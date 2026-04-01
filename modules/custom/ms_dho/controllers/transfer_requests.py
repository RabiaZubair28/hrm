from __future__ import annotations

from urllib.parse import quote_plus

from odoo import http
from odoo.http import request
from odoo.addons.hrmis_transfer.controllers.main import HrmisTransferController


class MsDhoTransferRequestsController(http.Controller):
    @http.route(["/hrmis/msdho/transfer"], type="http", auth="user", website=True)
    def hrmis_msdho_transfer(self, tab: str = "new", **kw):
        # Access control: MS DHO only
        if not request.env.user.has_group("custom_login.group_ms_dho"):
            return request.not_found()

        tab = (tab or "new").strip().lower()
        if tab not in ("new", "history", "status", "requests"):
            tab = "new"

        # Use the shared context helper so layout behaves consistently.
        from odoo.addons.hr_holidays_updates.controllers.utils import base_ctx

        return request.render(
            "ms_dho.hrmis_msdho_transfer_requests",
            base_ctx(
                "Transfer Requests",
                "msdho_transfer_requests",
                tab=tab,
            ),
        )

    @http.route(
        ["/hrmis/msdho/staff/<int:employee_id>/transfer/submit"],
        type="http",
        auth="user",
        website=True,
        methods=["POST"],
        csrf=True,
    )
    def hrmis_msdho_transfer_submit(self, employee_id: int, **post):
        # Access control: MS DHO only
        if not request.env.user.has_group("custom_login.group_ms_dho"):
            return request.not_found()

        employee = request.env["hr.employee"].sudo().browse(employee_id).exists()
        if not employee:
            return request.not_found()

        # Only allow submitting for self (MS DHO portal use-case)
        try:
            current_emp = request.env.user.employee_ids[:1]
            if not current_emp or current_emp.id != employee.id:
                return request.not_found()
        except Exception:
            return request.not_found()

        post = dict(post or {})
        post["redirect_base"] = "/hrmis/msdho/transfer"
        controller = HrmisTransferController()
        return controller.hrmis_transfer_submit(employee_id, **post)
