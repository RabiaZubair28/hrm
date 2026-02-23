# from odoo import models, fields, api
# from odoo.exceptions import ValidationError

# class HRMISPostingHistory(models.Model):
#     _name = "hrmis.posting.history"
#     _description = "HRMIS Posting History"
#     _order = "start_date desc, id desc"

#     employee_id = fields.Many2one(
#         "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
#     )

#     district_id = fields.Many2one(
#         "hrmis.district.master", string="District", required=True
#     )

#     facility_id = fields.Many2one(
#         "hrmis.facility.type",
#         string="Facility",
#         domain="[('district_id','=',district_id)]",
#     )

#     designation_id = fields.Many2one(
#         "hrmis.designation", string="Designation", required=True
#     )

#     bps = fields.Integer(string="BPS")
#     start_date = fields.Date(string="Start Date", required=True)
#     end_date = fields.Date(string="End Date")

#     is_current = fields.Boolean(
#         string="Current Posting",
#         compute="_compute_is_current",
#         store=True,
#     )

#     @api.depends("end_date")
#     def _compute_is_current(self):
#         for rec in self:
#             rec.is_current = not bool(rec.end_date)

#     @api.constrains("start_date", "end_date")
#     def _check_dates(self):
#         for rec in self:
#             if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
#                 raise ValidationError("End Date cannot be earlier than Start Date.")
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

    district_id = fields.Many2one("hrmis.district.master", required=True)
    facility_id = fields.Many2one(
        "hrmis.facility.type",
        domain="[('district_id','=',district_id)]",
    )
    facility_other_name = fields.Char(string="Other Facility")

    designation_id = fields.Many2one("hrmis.designation", required=True)
    bps = fields.Integer(string="BPS", required=True)

    start_date = fields.Date(required=True, index=True)
    end_date = fields.Date(index=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End date cannot be earlier than Start date.")
