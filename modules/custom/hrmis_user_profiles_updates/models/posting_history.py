import re

from odoo import models, fields, api
from odoo.exceptions import ValidationError


_YM_RE = re.compile(r"^\d{4}-\d{2}$")

class HrmisPostingHistory(models.Model):
    _name = "hrmis.posting.history"
    _description = "Posting History"
    _order = "start_month desc, id desc"

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

    start_month = fields.Char(required=True, index=True)
    end_month = fields.Char(index=True)

    @api.constrains("start_month", "end_month")
    def _check_dates(self):
        for rec in self:
            if rec.start_month and not _YM_RE.fullmatch(rec.start_month):
                raise ValidationError("Start month must be in YYYY-MM format.")
            if rec.end_month and not _YM_RE.fullmatch(rec.end_month):
                raise ValidationError("End month must be in YYYY-MM format.")
            if rec.end_month and rec.start_month and rec.end_month < rec.start_month:
                raise ValidationError("End month cannot be earlier than Start month.")
