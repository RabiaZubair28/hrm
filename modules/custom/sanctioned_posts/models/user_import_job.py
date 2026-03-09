# -*- coding: utf-8 -*-
from odoo import models, fields

class HrmisUserImportJob(models.Model):
    _name = "hrmis.user.import.job"
    _description = "HRMIS User Import Job"
    _order = "id desc"

    name = fields.Char(required=True, default="User Import Job")
    state = fields.Selection(
        [("queued", "Queued"), ("running", "Running"), ("done", "Done")],
        default="queued",
        required=True,
    )

    queued_count = fields.Integer(default=0)
    processed_count = fields.Integer(default=0)
    created_count = fields.Integer(default=0)
    failed_count = fields.Integer(default=0)

    report_attachment_id = fields.Many2one("ir.attachment", string="Skipped Report")
    last_error = fields.Text()