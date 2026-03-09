from odoo import models, fields

class HrmisTrainingInstitute(models.Model):
    _name = "hrmis.training.institute"
    _description = "Training Institute"

    name = fields.Char(required=True, index=True)
    active = fields.Boolean(default=True)