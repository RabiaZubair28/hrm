from odoo import models, fields, api
from odoo.exceptions import ValidationError

class HRMISQualificationHistory(models.Model):
    _name = "hrmis.qualification.history"
    _description = "HRMIS Qualification History"
    _order = "start_date desc, id desc"

    employee_id = fields.Many2one(
        "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
    )

    degree = fields.Selection(
        [
            ("ms", "MS"),
            ("md", "MD"),
            ('fcps_1', 'FCPS-I'),
            ('fcps_2', 'FCPS-II'),
            ("mcps", "MCPS"),
            ("diploma", "Diploma"),
        ],
        string="Degree",
        required=True,
    )

    specialization = fields.Char(string="Specialization")
    start_date = fields.Date(string="Start Date", required=True)
    end_date = fields.Date(string="End Date")

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End Date cannot be earlier than Start Date.")
