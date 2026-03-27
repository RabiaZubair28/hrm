import re

from odoo import models, fields, api
from odoo.exceptions import ValidationError

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


class HrmisProfilePostingStatus(models.Model):
    _name = "hrmis.profile.posting.status"
    _description = "HRMIS Profile Request - Current Posting Status Detail"
    _rec_name = "request_id"

    request_id = fields.Many2one(
        "hrmis.employee.profile.request",
        string="Request",
        required=True,
        ondelete="cascade",
        index=True,
    )

    # The dropdown in XML: hrmis_current_status_frontend
    status = fields.Selection(
        [
            ("currently_posted", "Currently Posted"),
            ("suspended", "Suspended"),
            ("on_leave", "On Leave"),
            ("eol_pgship", "EOL (PGship)"),
            ("reported_to_health_department", "Reported to Health Department"),
            ("deputation", "Deputation"),
        ],
        string="Current Status",
        required=True,
        default="currently_posted",
    )

    # -----------------------
    # Suspension details (XML)
    # -----------------------
    suspension_date = fields.Date(string="Suspension Date")
    suspension_reporting_to = fields.Selection(
        [
            ("health_department", "Health Department"),
            ("facility", "Facility"),
        ],
        string="Suspension Reporting To",
    )

    # -----------------------
    # Suspension details (XML)
    # -----------------------
    suspension_reporting_district_id = fields.Integer(
        string="Suspension Reporting District ID",
    )

    suspension_reporting_facility_id = fields.Integer(
        string="Suspension Reporting Facility ID",
    )
    suspension_reporting_facility_other_name = fields.Char(
        string="Suspension Other Facility",
    )
    
    suspension_reporting_designation_id = fields.Many2one(
        "hrmis.level.care.designation",
        string="Suspension Reporting Designation",
    )

    suspension_reporting_designation_temp_id = fields.Integer(
        string="Suspension Reporting Designation (Temp)"
    )

    suspension_reporting_designation_other_name = fields.Char(
        string="Suspension Other Designation",
    )

    # -----------------------
    # On-leave details (XML)
    # -----------------------
    onleave_type_id = fields.Many2one(
        "hr.leave.type",
        string="On Leave Type",
    )
    onleave_start = fields.Date(string="On Leave Start Date")
    onleave_end = fields.Date(string="On Leave End Date")

    onleave_reporting_to = fields.Selection(
        [
            ("health_department", "Health Department"),
            ("facility", "Facility"),
        ],
        string="On Leave Reporting To",
    )

    onleave_reporting_district_id = fields.Integer(
    string="On Leave Reporting District ID",
    )

    onleave_reporting_facility_id = fields.Integer(
        string="On Leave Reporting Facility ID",
    )
    onleave_reporting_facility_other_name = fields.Char(
        string="On Leave Other Facility",
    )
    onleave_reporting_designation_id = fields.Many2one(
        "hrmis.level.care.designation",
        string="On Leave Reporting Designation",
    )
    onleave_reporting_designation_temp_id = fields.Integer(
        string="On Leave Reporting Designation (Temp)"
    )
    onleave_reporting_designation_other_name = fields.Char(
        string="On Leave Other Designation",
    )


    # -----------------------
    # EOL (PGship) details
    # -----------------------
    eol_institute_id = fields.Many2one(
        "hrmis.training.institute",
        string="Training Institute",
    )
    
    eol_institute_code = fields.Char(
        string="Training Institute (Code)",
        help="Stores frontend string values like 'jpmc', 'duhs' when institute_id is not an integer ID.",
    )
    eol_institute_other_name = fields.Char(string="Other EOL Training Institute")
    eol_degree = fields.Selection(
        [
            ("ms", "MS"),
            ("md", "MD"),
            ("fcps_1", "FCPS-I"),
            ("fcps_2", "FCPS-II"),
            ("mcps", "MCPS"),
            ("mbbs", "MBBS"),
            ("mph", "MPH"),
            ("mba", "MBA (Health Management)"),
            ("msph", "MSPH"),
            ("diploma", "Diploma"),
            ("mba(supply chain)", "MBA (Supply Chain)"),
            ("other", "Other"),
        ],
        string="EOL Degree",
    )

    eol_degree_other_name = fields.Char(string="Other EOL Degree")
    eol_specialization_id = fields.Many2one(
        "hrmis.training.specialization",
        string="Specialization",
    )
    eol_specialization_code = fields.Char(
        string="Specialization (Code)",
        help="Stores frontend string values like 'general_medicine' when specialization_id is not an integer ID.",
    )
    eol_specialization_other_name = fields.Char(string="Other EOL Specialization")

    eol_status = fields.Selection(
        [
            ("ongoing", "Ongoing"),
            ("completed", "Complete"),
        ],
        string="EOL Status",
    )

    eol_start = fields.Date(string="EOL Start Date")
    eol_end = fields.Date(string="EOL End Date")
    
    # -----------------------
    # EOL (PGship) - Primary Posting
    # -----------------------
    eol_primary_district_id = fields.Integer(
        string="EOL Primary Posting District ID",
    )
    
    eol_primary_facility_id = fields.Integer(
        string="EOL Primary Posting Facility ID",
    )

    eol_primary_designation_id = fields.Many2one(
        "hrmis.level.care.designation",
        string="EOL Primary Posting Designation",
    )
    
    eol_primary_designation_temp_id = fields.Integer(
        string="EOL Primary Designation (Temp)"
    )

    eol_primary_bps = fields.Integer(string="EOL Primary Posting BPS")

    # -----------------------
    # Allowed to Work details (XML)
    # -----------------------
    allowed_to_work = fields.Boolean(string="Allowed To Work")

    allowed_district_id = fields.Integer(
        string="Allowed To Work District ID",
    )

    allowed_facility_id = fields.Integer(
        string="Allowed To Work Facility ID",
    )
    allowed_facility_other_name = fields.Char(
        string="Allowed To Work Other Facility",
    )

    allowed_bps = fields.Integer(string="Allowed To Work BPS")
    allowed_designation_id = fields.Many2one(
        "hrmis.level.care.designation",
        string="Allowed To Work Designation",
    )
    
    allowed_designation_temp_id = fields.Integer(
        string="Allowed Designation (Temp)"
    )
    allowed_designation_other_name = fields.Char(
        string="Allowed To Work Other Designation",
    )
    allowed_start_month = fields.Char(
        string="Allowed To Work Start Month",
        help="Store as YYYY-MM.",
    )
    #Deputation details
    deputation_start = fields.Char(string="Deputation Start Month")
    deputation_department = fields.Char(string="Deputation Department")
    deputation_district_id = fields.Integer(string="Deputation District ID")
    deputation_designation = fields.Char(string="Deputation Designation")
    # -----------------------
    # Validation (optional but recommended)
    # -----------------------
    @api.constrains(
        "status",
        "suspension_date",
        "suspension_reporting_to",
        "suspension_reporting_district_id",
        "suspension_reporting_facility_id",
        "onleave_type_id",
        "onleave_start",
        "onleave_end",
        "onleave_reporting_to",
        "onleave_reporting_district_id",
        "onleave_reporting_facility_id",
        "eol_start",
        "eol_end",
        "eol_status",
    )
    def _check_required_by_status(self):
        for r in self:
            # -----------------------
            # Suspended
            # -----------------------
            if r.status == "suspended":
                if not r.suspension_date:
                    raise ValidationError("Suspension Date is required when status is Suspended.")

                if r.suspension_reporting_to == "facility":
                    if not r.suspension_reporting_facility_id:
                        raise ValidationError(
                            "Suspension Reporting Facility is required when reporting to Facility."
                        )
                elif r.suspension_reporting_to == "health_department":
                    # ✅ nothing required
                    pass

            # -----------------------
            # On Leave
            # -----------------------
            if r.status == "on_leave":
                if not r.onleave_type_id or not r.onleave_start or not r.onleave_end:
                    raise ValidationError(
                        "Leave Type, Start Date and End Date are required when status is On Leave."
                    )
                if r.onleave_end and r.onleave_start and r.onleave_end < r.onleave_start:
                    raise ValidationError("On Leave End Date cannot be before Start Date.")

                if r.onleave_reporting_to == "facility":
                    if not r.onleave_reporting_facility_id:
                        raise ValidationError(
                            "On Leave Reporting Facility is required when reporting to Facility."
                        )
                elif r.onleave_reporting_to == "health_department":
                    # ✅ nothing required
                    pass

            # -----------------------
            # EOL (PGship)
            # -----------------------
            # if r.status == "eol_pgship":
            #     if not r.eol_start:
            #         raise ValidationError("EOL Start Date is required when status is EOL (PGship).")
            #     if r.eol_status == "completed" and not r.eol_end:
            #         raise ValidationError("EOL End Date is required when EOL status is Complete.")

    # -----------------------
    # Onchanges
    # -----------------------
    @api.onchange("status")
    def _onchange_status(self):
        for r in self:
            if r.status != "eol_pgship":
                r.eol_institute_id = False
                r.eol_institute_code = False
                r.eol_institute_other_name = False
                r.eol_specialization_id = False
                r.eol_specialization_code = False
                r.eol_specialization_other_name = False
                r.eol_status = False
                r.eol_start = False
                r.eol_end = False

    @api.onchange("suspension_reporting_to")
    def _onchange_suspension_reporting_to(self):
        for r in self:
            if r.suspension_reporting_to == "health_department":
                r.suspension_reporting_district_id = False
                r.suspension_reporting_facility_id = False

    @api.onchange("onleave_reporting_to")
    def _onchange_onleave_reporting_to(self):
        for r in self:
            if r.onleave_reporting_to == "health_department":
                r.onleave_reporting_district_id = False
                r.onleave_reporting_facility_id = False

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
        for vals in vals_list:
            if "allowed_start_month" in vals:
                vals["allowed_start_month"] = self._normalize_month_value(vals.get("allowed_start_month"))
            if "deputation_start" in vals:
                vals["deputation_start"] = self._normalize_month_value(vals.get("deputation_start"))
        return super().create(vals_list)

    def write(self, vals):
        vals = dict(vals or {})
        if "allowed_start_month" in vals:
            vals["allowed_start_month"] = self._normalize_month_value(vals.get("allowed_start_month"))
        if "deputation_start" in vals:
            vals["deputation_start"] = self._normalize_month_value(vals.get("deputation_start"))
        return super().write(vals)

    def _auto_init(self):
        cr = self.env.cr
        cr.execute(
            """
            ALTER TABLE hrmis_profile_posting_status
            ALTER COLUMN allowed_start_month TYPE varchar,
            ALTER COLUMN deputation_start TYPE varchar
            USING CASE
                WHEN allowed_start_month IS NOT NULL THEN to_char(allowed_start_month, 'YYYY-MM')
                ELSE NULL
            END,
            USING CASE
                WHEN deputation_start IS NOT NULL THEN to_char(deputation_start, 'YYYY-MM')
                ELSE NULL
            END
            """
        )
        return super()._auto_init()