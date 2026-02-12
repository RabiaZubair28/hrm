from odoo import models, fields, api
from odoo.exceptions import ValidationError

class HRMISLeaveHistory(models.Model):
    _name = "hrmis.leave.history"
    _description = "HRMIS Leave History"
    _order = "start_date desc, id desc"

    employee_id = fields.Many2one(
        "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
    )

    leave_type_id = fields.Many2one(
        "hr.leave.type", string="Leave Type", required=True
    )

    start_date = fields.Date(string="Start Date", required=True)
    end_date = fields.Date(string="End Date", required=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End Date cannot be earlier than Start Date.")
