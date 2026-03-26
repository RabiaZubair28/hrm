from odoo import models, fields, api

class HrmisFacilityDesignation(models.Model):
    _name = 'hrmis.level.care.designation'
    _description = 'HRMIS Facility Designation'
    _order = 'name ASC'

    name = fields.Char(required=True)
    code = fields.Char()

    designation_group_id = fields.Many2one(
        "hrmis.designation.group",
        string="Designation Group",
        ondelete="restrict",
        index=True,
    )

    total_sanctioned_posts = fields.Integer(
        string="Total Sanctioned Posts",
        required=True,
        default=1,
    )

    post_BPS = fields.Integer(
        string="Post BPS",
        required=True,
        default=0,
    )

    active = fields.Boolean(default=True)

    facility_id = fields.Many2one(
        "hrmis.facility.type",
        string="Facility",
        required=True,
        ondelete="restrict",
    )

    facility_name = fields.Char(string="Facility Name")
    level_of_care = fields.Char(string="Level of Care")
    old_value = fields.Boolean(default=True)
    is_temp = fields.Boolean(default=False)

    # legacy_designation_id = fields.Many2one(
    #     "hrmis.designation",
    #     string="Legacy Designation",
    #     ondelete="set null",
    #     index=True,
    # )