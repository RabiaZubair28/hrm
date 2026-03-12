from odoo import models, _
from odoo.exceptions import UserError


class IrModuleModule(models.Model):
    _inherit = "ir.module.module"

    def button_immediate_uninstall(self):
        raise UserError(_("App uninstall has been disabled."))

    def module_uninstall(self):
        raise UserError(_("App uninstall has been disabled."))