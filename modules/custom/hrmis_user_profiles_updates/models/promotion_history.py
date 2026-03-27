# from odoo import models, fields, api
# from odoo.exceptions import ValidationError

# class HRMISPromotionHistory(models.Model):
#     _name = "hrmis.promotion.history"
#     _description = "HRMIS Promotion History"
#     _order = "promotion_date desc, id desc"

#     employee_id = fields.Many2one(
#         "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
#     )

#     bps_from = fields.Integer(string="BPS From", required=True)
#     bps_to = fields.Integer(string="BPS To", required=True)
#     promotion_date = fields.Date(string="Promotion Date", required=True)

#     @api.constrains("bps_from", "bps_to")
#     def _check_bps(self):
#         for rec in self:
#             if rec.bps_to <= rec.bps_from:
#                 raise ValidationError("BPS To must be greater than BPS From.")
# from odoo import models, fields, api
# from odoo.exceptions import ValidationError

# class HRMISPromotionHistory(models.Model):
#     _name = "hrmis.promotion.history"
#     _description = "HRMIS Promotion History"
#     _order = "promotion_date desc, id desc"

#     employee_id = fields.Many2one(
#         "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
#     )

#     bps_from = fields.Integer(string="BPS From", required=True)
#     bps_to = fields.Integer(string="BPS To", required=True)
#     promotion_date = fields.Date(string="Promotion Date", required=True)

#     @api.constrains("bps_from", "bps_to")
#     def _check_bps(self):
#         for rec in self:
#             if rec.bps_to <= rec.bps_from:
#                 raise ValidationError("BPS To must be greater than BPS From.")
import re

from odoo import models, fields, api
from odoo.exceptions import ValidationError


_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

class HrmisPromotionHistory(models.Model):
    _name = "hrmis.promotion.history"
    _description = "Promotion History"
    _order = "promotion_date desc, id desc"

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

    bps_from = fields.Integer(required=True)
    bps_to = fields.Integer(required=True)

    # Keep field name unchanged; store month-only values as YYYY-MM.
    promotion_date = fields.Char(required=True, index=True)

    @api.constrains("bps_from", "bps_to")
    def _check_bps(self):
        for rec in self:
            if rec.bps_to <= rec.bps_from:
                raise ValidationError("BPS To must be greater than BPS From.")
            if rec.promotion_date and not _MONTH_RE.fullmatch(rec.promotion_date):
                raise ValidationError("Promotion Date must be in YYYY-MM format.")

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            month_val = (vals.get("promotion_date") or "").strip()
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", month_val):
                vals["promotion_date"] = month_val[:7]
        return super().create(vals_list)

    def write(self, vals):
        month_val = (vals.get("promotion_date") or "").strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", month_val):
            vals["promotion_date"] = month_val[:7]
        return super().write(vals)
