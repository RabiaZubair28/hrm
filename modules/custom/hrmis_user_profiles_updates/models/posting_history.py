import re

from odoo import models, fields, api
from odoo.exceptions import ValidationError


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

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

    start_date = fields.Char(required=True, index=True)
    end_date = fields.Char(index=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.start_date and not _MONTH_RE.fullmatch(rec.start_date):
                raise ValidationError("Start month must be in YYYY-MM format.")
            if rec.end_date and not _MONTH_RE.fullmatch(rec.end_date):
                raise ValidationError("End month must be in YYYY-MM format.")
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End date cannot be earlier than Start date.")

    @api.model
    def _normalize_month_value(self, value):
        raw = str(value or "").strip()
        if not raw:
            return False
        if _MONTH_RE.fullmatch(raw):
            return raw
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            return raw[:7]
        return raw

    @api.model_create_multi
    def create(self, vals_list):
        normalized_vals = []
        for vals in vals_list:
            vals = dict(vals)
            if "start_date" in vals:
                vals["start_date"] = self._normalize_month_value(vals.get("start_date"))
            if "end_date" in vals:
                vals["end_date"] = self._normalize_month_value(vals.get("end_date"))
            normalized_vals.append(vals)
        return super().create(normalized_vals)

    def write(self, vals):
        vals = dict(vals)
        if "start_date" in vals:
            vals["start_date"] = self._normalize_month_value(vals.get("start_date"))
        if "end_date" in vals:
            vals["end_date"] = self._normalize_month_value(vals.get("end_date"))
        return super().write(vals)
