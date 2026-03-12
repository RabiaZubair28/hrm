import logging

from odoo import api, fields, models, SUPERUSER_ID

_logger = logging.getLogger(__name__)


class HrLeaveValidatorSeeder(models.Model):
    _inherit = "hr.leave.type"

    