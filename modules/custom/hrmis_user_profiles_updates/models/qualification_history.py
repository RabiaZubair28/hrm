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


import re

from odoo import models, fields, api
from odoo.exceptions import ValidationError

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
class HrmisQualificationHistory(models.Model):
    _name = "hrmis.qualification.history"
    _description = "Qualification History"
    _order = "start_date asc, id asc"

    def _auto_init(self):
        res = super()._auto_init()
        self.env.cr.execute(
            """
            ALTER TABLE hrmis_qualification_history
            ALTER COLUMN start_date TYPE varchar USING LEFT(start_date::text, 7),
            ALTER COLUMN end_date TYPE varchar USING CASE
                WHEN end_date IS NULL THEN NULL
                ELSE LEFT(end_date::text, 7)
            END
            """
        )
        return res

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
    
    # Keep same field names; store month-only values as YYYY-MM.
    start_date = fields.Char(required=True, index=True)
    end_date = fields.Char(index=True)

    @api.model
    def _normalize_month(self, value):
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
        normalized = []
        for vals in vals_list:
            vals = dict(vals)
            if "start_date" in vals:
                vals["start_date"] = self._normalize_month(vals.get("start_date"))
            if "end_date" in vals:
                vals["end_date"] = self._normalize_month(vals.get("end_date"))
            normalized.append(vals)
        return super().create(normalized)

    def write(self, vals):
        vals = dict(vals)
        if "start_date" in vals:
            vals["start_date"] = self._normalize_month(vals.get("start_date"))
        if "end_date" in vals:
            vals["end_date"] = self._normalize_month(vals.get("end_date"))
        return super().write(vals)

    @api.constrains("start_date", "end_date")
    def _check_dates(self):
        for rec in self:
            if rec.start_date and not _MONTH_RE.fullmatch(rec.start_date):
                raise ValidationError("Start month must be in YYYY-MM format.")
            if rec.end_date and not _MONTH_RE.fullmatch(rec.end_date):
                raise ValidationError("End month must be in YYYY-MM format.")
            if rec.end_date and rec.start_date and rec.end_date < rec.start_date:
                raise ValidationError("End month cannot be earlier than Start month.")

