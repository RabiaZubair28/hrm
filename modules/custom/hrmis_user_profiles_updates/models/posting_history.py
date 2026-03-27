from odoo import models, fields, api
from odoo.exceptions import ValidationError

class HrmisPostingHistory(models.Model):
    _name = "hrmis.posting.history"
    _description = "Posting History"
    _order = "start_date desc, id desc"

    request_id = fields.Many2one(
        "hrmis.employee.profile.request",
        required=True,
        ondelete="cascade",
        index=True,
    )

    employee_id = fields.Many2one(
        "hr.employee",
        related="request_id.employee_id",
        store=True,
        index=True,
        readonly=True,
    )

    district_id = fields.Integer(
        string="Previous District",
        required=False,
    )

    facility_id = fields.Integer(
        string="Previous Facility",
        required=False,
    )

    facility_other_name = fields.Char(string="Other Facility")
    designation_id = fields.Many2one("hrmis.level.care.designation", required=True)
    designation_temp_id = fields.Integer(string="Temp Designation")

    designation_other_name = fields.Char(string="Other Designation")
    bps = fields.Integer(string="BPS", required=True)

    start_date = fields.Date(required=True, index=True)
    end_date = fields.Date(index=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End date cannot be earlier than Start date.")
