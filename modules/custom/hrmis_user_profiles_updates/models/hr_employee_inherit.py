from odoo import models, fields, api
from odoo.exceptions import ValidationError
from datetime import date

#This model will store the data for request approval temporarily
class HREmployee(models.Model):
    _inherit = 'hr.employee'

    hrmis_service_history_ids = fields.One2many(
        'hrmis.service.history', 
        'employee_id',           
        string="Service History"
    )
    hrmis_training_ids = fields.One2many(
        "hrmis.training.record",
        "employee_id",
        string="Qualifications & Trainings"
    )
    hrmis_employee_id = fields.Char(
    string="Employee ID / Service Number",
    required=True,
    copy=False
    )
    hrmis_cnic = fields.Char(string="CNIC")
    birthday = fields.Date(
        string="Date of Birth",
        required=True
    )
    hrmis_commission_date = fields.Date(string="Commision Date")
    hrmis_father_name = fields.Char(string="Father's Name")
    hrmis_joining_date = fields.Date(string="Joining Date")
    hrmis_pmdc_no = fields.Char(string="PMDC No.")
    hrmis_pmdc_issue_date = fields.Date(string="PMDC Issue Date")
    hrmis_pmdc_expiry_date = fields.Date(string="PMDC Expiry Date")

    hrmis_email = fields.Char(string="Email")
    hrmis_address = fields.Char(string="Address")
    hrmis_postal_code = fields.Char(string="Postal Code")
    gender = fields.Selection([
        ('male', 'Male'),
        ('female', 'Female'),
        ('other', 'Other')
    ], string="Gender")
    
    hrmis_cadre = fields.Many2one(
    'hrmis.cadre',
    string='Cadre',
    required=True
    )

    hrmis_designation = fields.Many2one(
    'hrmis.designation',
    string='Designation',
    required=True 
    )
    
    hrmis_bps = fields.Integer(
    string="BPS Grade"
    ) 
    hrmis_merit_number = fields.Char(string="Merit Number")
    district_id = fields.Many2one(
        'hrmis.district.master',
        string="Current District"
    )

    facility_id = fields.Many2one(
        'hrmis.facility.type',
        string="Current Facility",
        domain="[('district_id','=',district_id)]"
    )


    hrmis_contact_info = fields.Char(string="Contact Info")
    hrmis_leaves_taken = fields.Float(
        string="Total Leaves Taken Since Joining (Days)"
    )

    # service_postings_district_id = fields.Many2one(related="hrmis_service_history_ids.district_id", readonly=True)
    # service_postings_facility_id = fields.Many2one(related="hrmis_service_history_ids.facility_id", readonly=True)

    # service_postings_from_date = fields.Date(related="hrmis_service_history_ids.from_date", readonly=True)
    # service_postings_end_date = fields.Date(related="hrmis_service_history_ids.end_date", readonly=True)
    # service_postings_commission_date = fields.Date(related="hrmis_service_history_ids.commission_date", readonly=True)

    hrmis_cnic_front = fields.Binary(
        string="CNIC Front Scan",
        attachment=True
    )
    hrmis_cnic_front_filename = fields.Char(
        string="CNIC Front Filename"
    )

    hrmis_cnic_back = fields.Binary(
        string="CNIC Back Scan",
        attachment=True
    )
    hrmis_cnic_back_filename = fields.Char(
        string="CNIC Back Filename"
    )
    hrmis_domicile = fields.Char(string="Domicile")
    # ---------------- QUALIFICATION / PROMOTION ---------------- #

    qualification = fields.Char(
        string="Last Qualification Received",
        help="Example: MBBS, FCPS, MCPS, MSPH, MPH, MBA Diploma",
        required=True
    )

    qualification_date = fields.Date(
        string="Qualification Date",
        help="Date of last qualification received",
        required=True
    )

    date_promotion = fields.Date(
        string="Last Promotion Date",
        help="Date of previous promotion",
        required=True
    )

    year_qualification = fields.Date(
        string="Year of Qualification",
        help="Date of last qualification received",
        required=True
    )

    hrmis_pmdc_no = fields.Char(string="PMDC No.")
    hrmis_pmdc_issue_date = fields.Date(string="PMDC Issue Date")
    hrmis_pmdc_expiry_date = fields.Date(string="PMDC Expiry Date")
 
    hrmis_email = fields.Char(string="Email")
    hrmis_address = fields.Char(string="Address")
    hrmis_postal_code = fields.Char(string="Postal Code")
    # qualification_history_ids = fields.One2many(
    #     "hrmis.qualification.history",
    #     "employee_id",
    #     string="Qualification History",
    # )

    # posting_history_ids = fields.One2many(
    #     "hrmis.posting.history",
    #     "employee_id",
    #     string="Posting History",
    # )

    # promotion_history_ids = fields.One2many(
    #     "hrmis.promotion.history",
    #     "employee_id",
    #     string="Promotion History",
    # )

    # leave_history_ids = fields.One2many(
    #     "hrmis.leave.history",
    #     "employee_id",
    #     string="Leave History",
    # )
    # hrmis_service_history_ids = fields.One2many(
    #     "hrmis.service.history",
    #     "employee_id",
    #     string="Service History",
    # )

    hrmis_current_service_history_id = fields.Many2one(
        "hrmis.service.history",
        compute="_compute_current_service_history",
        store=False,  # can be store=True if you want
    )

    service_postings_district_id = fields.Many2one(
        "hrmis.district.master",
        related="hrmis_current_service_history_id.district_id",
        readonly=True,
    )
    service_postings_facility_id = fields.Many2one(
        "hrmis.facility.type",
        related="hrmis_current_service_history_id.facility_id",
        readonly=True,
    )
    service_postings_from_date = fields.Date(
        related="hrmis_current_service_history_id.from_date",
        readonly=True,
    )
    service_postings_end_date = fields.Date(
        related="hrmis_current_service_history_id.end_date",
        readonly=True,
    )
    service_postings_commission_date = fields.Date(
        related="hrmis_current_service_history_id.commission_date",
        readonly=True,
    )

    @api.depends("hrmis_service_history_ids.from_date", "hrmis_service_history_ids.end_date")
    def _compute_current_service_history(self):
        for emp in self:
            # pick the “latest” record by from_date (adjust if you use another rule)
            emp.hrmis_current_service_history_id = emp.hrmis_service_history_ids.sorted(
                key=lambda r: (r.from_date or fields.Date.from_string("1900-01-01"), r.id)
            )[-1:]  # recordset slice returns 0/1 record
    def action_request_profile_update(self):
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': 'Profile Update Request',
            'res_model': 'hrmis.employee.profile.request',
            'view_mode': 'form',
            'target': 'current',
            'context': {
                'default_employee_id': self.id
            }
        }
        