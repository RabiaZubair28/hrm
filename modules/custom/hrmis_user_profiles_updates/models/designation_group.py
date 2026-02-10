from odoo import models, fields

class HrmisDesignationGroup(models.Model):
    _name = "hrmis.designation.group"
    _description = "HRMIS Designation Group"
    _order = "name ASC"

    name = fields.Char(
        string="Group Name",
        required=True
    )

    code = fields.Char(
        string="Code",
        help="Short code for the designation group"
    )

    description = fields.Text(
        string="Description"
    )

    active = fields.Boolean(
        default=True
    )

    designation_ids = fields.One2many(
        "hrmis.designation",
        "designation_group_id",
        string="Designations"
    )
