# from odoo import models, fields, api
# from odoo.exceptions import ValidationError

# class HRMISQualificationHistory(models.Model):
#     _name = "hrmis.qualification.history"
#     _description = "HRMIS Qualification History"
#     _order = "start_date desc, id desc"

#     employee_id = fields.Many2one(
#         "hr.employee", string="Employee", required=True, ondelete="cascade", index=True
#     )

#     degree = fields.Selection(
#         [
#             ("ms", "MS"),
#             ("md", "MD"),
#             ('fcps_1', 'FCPS-I'),
#             ('fcps_2', 'FCPS-II'),
#             ("mcps", "MCPS"),
#             ("diploma", "Diploma"),
#         ],
#         string="Degree",
#         required=True,
#     )

#     # specialization = fields.Char(string="Specialization")
#     specialization = fields.Selection([
#         ("general_medicine", "General Medicine"),
#         ("family_medicine", "Family Medicine"),
#         ("medicine", "Medicine"),
#         ("emergency_medicine", "Emergency Medicine"),
#         ("pediatrics", "Pediatrics"),
#         ("pediatric_surgery", "Pediatric Surgery"),
#         ("cardiology", "Cardiology"),
#         ("neurology", "Neurology"),
#         ("psychiatry", "Psychiatry"),
#         ("dermatology", "Dermatology"),
#         ("endocrinology", "Endocrinology"),
#         ("pulmonology", "Pulmonology"),
#         ("nephrology", "Nephrology"),
#         ("gastroenterology", "Gastroenterology"),
#         ("oncology", "Oncology"),
#         ("hematology", "Hematology"),
#         ("general_surgery", "General Surgery"),
#         ("surgery", "Surgery"),
#         ("neurosurgery", "Neurosurgery"),
#         ("plastic_surgery", "Plastic Surgery"),
#         ("urology", "Urology"),
#         ("orthopedics", "Orthopedics"),
#         ("gynecology", "Gynecology"),
#         ("obstetrics_gynecology", "Obstetrics and Gynaecology"),
#         ("radiology", "Radiology"),
#         ("pathology", "Pathology"),
#         ("anesthesia", "Anesthesia"),
#         ("anesthesiology", "Anesthesiology"),
#         ("physiotherapy", "Physiotherapy"),
#         ("nutrition", "Nutrition"),
#         ("ophthalmology", "Ophthalmology"),
#         ("ent", "ENT"),
#         ("dentistry", "Dentistry"),
#         ("orthodontist", "Orthodontist"),
#         ("other", "Other"),
#     ], string="Specialization")
#     start_date = fields.Date(string="Start Date", required=True)
#     end_date = fields.Date(string="End Date")
#     ongoing = fields.Boolean(string="Present")
#     @api.constrains("start_date", "end_date")
#     def _check_dates(self):
#         for rec in self:
#             if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
#                 raise ValidationError("End Date cannot be earlier than Start Date.")


from odoo import models, fields, api
from odoo.exceptions import ValidationError
class HrmisQualificationHistory(models.Model):
    _name = "hrmis.qualification.history"
    _description = "Qualification History"
    _order = "start_date asc, id asc"

    request_id = fields.Many2one(
        "hrmis.employee.profile.request",
        string="Request",
        required=True,
        ondelete="cascade",
        index=True,
    )
    employee_id = fields.Many2one(
        "hr.employee",
        string="Employee",
        required=True,
        ondelete="cascade",
        index=True,
    )

    degree = fields.Selection(
        [
            ("ms", "MS"),
            ("md", "MD"),
            ("fcps_1", "FCPS-I"),
            ("fcps_2", "FCPS-II"),
            ("mcps", "MCPS"),
            ("diploma", "Diploma"),
            ("other", "Other"),
        ],
        string="Degree",
        required=True,
    )
    degree_other_name = fields.Char()  # NEW
    specialization = fields.Char(string="Specialization")
    # specialization = fields.Char(string="Specialization")

    status = fields.Selection(
        [("ongoing", "Ongoing"), ("completed", "Completed")],
        string="Status",
        default="ongoing",
        required=True,
    )

    start_date = fields.Date(string="Start Date", required=True)
    end_date = fields.Date(string="End Date")


    specialization = fields.Selection([
        ("general_medicine", "General Medicine"),
        ("family_medicine", "Family Medicine"),
        ("medicine", "Medicine"),
        ("emergency_medicine", "Emergency Medicine"),
        ("pediatrics", "Pediatrics"),
        ("pediatric_surgery", "Pediatric Surgery"),
        ("cardiology", "Cardiology"),
        ("neurology", "Neurology"),
        ("psychiatry", "Psychiatry"),
        ("dermatology", "Dermatology"),
        ("endocrinology", "Endocrinology"),
        ("pulmonology", "Pulmonology"),
        ("nephrology", "Nephrology"),
        ("gastroenterology", "Gastroenterology"),
        ("oncology", "Oncology"),
        ("hematology", "Hematology"),
        ("general_surgery", "General Surgery"),
        ("surgery", "Surgery"),
        ("neurosurgery", "Neurosurgery"),
        ("plastic_surgery", "Plastic Surgery"),
        ("urology", "Urology"),
        ("orthopedics", "Orthopedics"),
        ("gynecology", "Gynecology"),
        ("obstetrics_gynecology", "Obstetrics and Gynaecology"),
        ("radiology", "Radiology"),
        ("pathology", "Pathology"),
        ("anesthesia", "Anesthesia"),
        ("anesthesiology", "Anesthesiology"),
        ("physiotherapy", "Physiotherapy"),
        ("nutrition", "Nutrition"),
        ("ophthalmology", "Ophthalmology"),
        ("ent", "ENT"),
        ("dentistry", "Dentistry"),
        ("orthodontist", "Orthodontist"),
        ("other", "Other"),
], string="Specialization")
    # ✅ controller creates start_date/end_date (YYYY-MM-01)
    start_date = fields.Date(required=True, index=True)
    end_date = fields.Date(index=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End date cannot be earlier than Start date.")

