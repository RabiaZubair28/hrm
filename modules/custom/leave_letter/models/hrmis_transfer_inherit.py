from datetime import datetime
from odoo import api, fields, models

class HrTransfer(models.Model):
    _inherit = "hrmis.transfer.request"

    transfer_notification_id = fields.Many2one(
        "transfer.notification",
        string="Notification",
        readonly=True,
        copy=False,
    )
    notification_no = fields.Char(readonly=True, copy=False)

    def _finalize_transfer_approval(self):
        # 1) run the real approval (vacancy + employee write + state=approved)
        super()._finalize_transfer_approval()

        # 2) now we're truly approved -> safe to generate notification
        for rec in self:
            if rec.state == "approved":
                rec._ensure_transfer_notification()

    def _ensure_transfer_notification(self):
        self.ensure_one()

        # generate notification_no once
        if not self.notification_no:
            employee = self.employee_id
            manager_emp = employee.parent_id  # or your _responsible_manager_emp(employee)

            section = (
                (manager_emp.user_id and manager_emp.user_id.login)
                or (manager_emp.name if manager_emp else False)
                or "SO"
            )
            section = (section or "SO").upper()

            dept_code = "H"
            emp_initial = (employee.name or "X")[:1].upper()
            merit = employee.hrmis_merit_number or ""

            year = fields.Date.today().strftime("%y")
            self.notification_no = f"NO.{section}({dept_code}){emp_initial}-{merit}/{year}"

        # create notification record once
        if not self.transfer_notification_id:
            notif = self.env["transfer.notification"].create_notification(self)
            if notif:
                self.transfer_notification_id = notif.id
