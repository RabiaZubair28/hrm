# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
from odoo import models, api

_logger = logging.getLogger(__name__)


class HREmployee(models.Model):
    _inherit = "hr.employee"

    def action_download_employee_info(self):
        """
        Called by the list-view button. Redirects to a controller that returns an XLSX.
        If user selected rows, export only those; otherwise export all employees user can access.
        """
        active_ids = self.env.context.get("active_ids") or []
        _logger.info(
            "[EMP_EXPORT] action_download_employee_info called. active_ids=%s user=%s(%s)",
            active_ids, self.env.user.name, self.env.user.id
        )

        # Build URL (avoid putting huge stuff in context)
        if active_ids:
            ids_str = ",".join(str(i) for i in active_ids)
            url = f"/hrmis/employees/download?ids={ids_str}"
        else:
            url = "/hrmis/employees/download?ids=all"

        _logger.info("[EMP_EXPORT] Redirecting to %s", url)
        return {
            "type": "ir.actions.act_url",
            "url": url,
            "target": "self",
        }
