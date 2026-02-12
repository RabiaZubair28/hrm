from odoo import models, fields, api
from odoo.exceptions import ValidationError

class HRMISPromotionHistory(models.Model):
    _name = "hrmis.promotion.history"
    _description = "HRMIS Promotion History"
    _order = "promotion_date desc, id desc"

    employee_id = fields.Many2one(
        "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
    )

    bps_from = fields.Integer(string="BPS From", required=True)
    bps_to = fields.Integer(string="BPS To", required=True)
    promotion_date = fields.Date(string="Promotion Date", required=True)

    @api.constrains("bps_from", "bps_to")
    def _check_bps(self):
        for rec in self:
            if rec.bps_to <= rec.bps_from:
                raise ValidationError("BPS To must be greater than BPS From.")
