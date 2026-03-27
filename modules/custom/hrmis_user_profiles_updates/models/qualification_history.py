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
    # add this (uncomment / restore)
    training_institute_id = fields.Many2one(
        "hrmis.training.institute",
        string="Training Institute",
    )

    # keep your existing code field (already present)
    qual_institute_code = fields.Char(
        string="Training Institute (Code)",
        help="Stores frontend string values like 'jpmc', 'duhs' when institute_id is not an integer ID.",
    )

    # rename is optional, but recommended for clarity
    # if you don’t want a DB rename, keep your existing field name:
    training_institute_other_name = fields.Char(string="Other Training Institute")
    degree = fields.Selection(
        [
            ("ms", "MS"),
            ("md", "MD"),
            ("fcps_1", "FCPS-I"),
            ("fcps_2", "FCPS-II"),
            ("mcps", "MCPS"),
            ("diploma", "Diploma"),
            ("mbbs", "MBBS"),
            ("mph", "MPH"),
            ("mba", "MBA(Health Management)"),
            ("msph", "MSPH"),
            ("mba(supply chain)", "MBA (Supply Chain)"),
            ("other", "Other"),
        ],
        string="Degree",
        required=True,
    )
    degree_other_name = fields.Char()  # NEW
    # specialization = fields.Char(string="Specialization")
    # specialization = fields.Char(string="Specialization")

    status = fields.Selection(
        [("ongoing", "Ongoing"), ("completed", "Completed")],
        string="Status",
        default="ongoing",
        required=True,
    )

    # start_date = fields.Date(string="Start Date", required=True)
    # end_date = fields.Date(string="End Date")


    specialization = fields.Selection([
("general_medicine", "General Medicine"),
("pediatrics", "Pediatrics"),
("cardiology", "Cardiology"),
("neurology", "Neurology"),
("dermatology", "Dermatology"),
("psychiatry", "Psychiatry"),
("endocrinology", "Endocrinology"),
("pulmonology", "Pulmonology"),
("nephrology", "Nephrology"),
("gastroenterology", "Gastroenterology"),
("oncology", "Oncology"),
("family_medicine", "Family Medicine"),
("general_surgery", "General Surgery"),
("obstetrics_gynecology", "Obstetrics & Gynaecology"),
("orthopedics", "Orthopedics"),
("ophthalmology", "Ophthalmology"),
("ent", "ENT"),
("neurosurgery", "Neurosurgery"),
("plastic_surgery", "Plastic Surgery"),
("urology", "Urology"),
("anesthesiology", "Anesthesiology"),
("pediatric_surgery", "Pediatric Surgery"),
("radiology", "Radiology"),
("pathology", "Pathology"),
("hematology", "Hematology"),
("physiotherapy", "Physiotherapy"),
("nutrition", "Nutrition"),
("dentistry", "Dentistry"),
("orthodontist", "Orthodontist"),
("emergency_medicine", "Emergency medicine"),
("other", "Other"),
], string="Specialization")
    specialization_other_name = fields.Char(string="Other Specialization")
    
    # ✅ controller creates start_date/end_date (YYYY-MM-01)
    start_date = fields.Date(required=True, index=True)
    end_date = fields.Date(index=True)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End date cannot be earlier than Start date.")

