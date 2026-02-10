from odoo import models, fields, api
from datetime import datetime

class HrLeave(models.Model):
    _inherit = "hr.leave"

    leave_notification_id = fields.Many2one(
        "leave.notification",
        string="Notification",
        readonly=True,
        copy=False
    )
    notification_no = fields.Char(readonly=True, copy=False)

    @api.model
    def create(self, vals):
        if not vals.get("notification_no"):
            vals["notification_no"] = self.env["ir.sequence"].next_by_code("leave.notification")

        record = super().create(vals)

        employee = record.employee_id
        manager_emp = employee.parent_id  # hr.employee (SO / Manager)

        # SECTION from SO username (login is on res.users)
        section = (
            (manager_emp.user_id and manager_emp.user_id.login)
            or (manager_emp.name if manager_emp else False)
            or "SO"
        )

        section = section.upper() if section else "SO"

        dept_code = "H" 

        emp_initial = (employee.name or "X")[:1].upper()

        merit = employee.hrmis_merit_number 

        # Year
        year = datetime.now().strftime("%y")

        record.notification_no = f"NO.{section}({dept_code}){emp_initial}-{merit}/{year}"
        

        return record

    def action_validate(self):
        res = super().action_validate()

        for rec in self:
            if not rec.leave_notification_id:
                notif = self.env["leave.notification"].create_notification(rec)
                rec.leave_notification_id = notif.id

                if self.env.context.get("from_ui"):
                    return self.env.ref(
                        "leave_letter.action_leave_notification_pdf"
                    ).report_action(notif)

        return res
