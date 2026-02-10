from odoo import api, fields, models, SUPERUSER_ID
from odoo.tools.safe_eval import safe_eval
from odoo.exceptions import ValidationError

import logging
_logger = logging.getLogger(__name__)

def _matches_domain(self, record):
    """Return True if this flow applies to the record, based on self.domain."""
    self.ensure_one()
    if not self.domain:
        return True
    try:
        dom = safe_eval(self.domain)
    except Exception:
        _logger.exception("Invalid domain on flow %s (%s)", self.id, self.domain)
        return False
    return bool(record.sudo().filtered_domain(dom))
class HrmisApprovalFlow(models.Model):
    _name = "hrmis.approval.flow"
    _description = "Approval Flow Template"
    _order = "sequence, id"

    name = fields.Char(required=True)

    model_id = fields.Many2one("ir.model", string="Model", required=False, ondelete="cascade")
    model_name = fields.Char(string="Model Technical Name", required=True, index=True)

    sequence = fields.Integer(string="Approver Sequence", default=10)  # step order
    mode = fields.Selection(
        [("sequential", "Sequential"), ("parallel", "Parallel")],
        default="sequential",
        required=True,
    )

    # Optional: filter which records this applies to
    domain = fields.Char(
        string="Domain (optional)",
        help="Example for leaves: [('holiday_status_id','=',leave_type_id)] with context variables."
    )

    approver_line_ids = fields.One2many("hrmis.approval.flow.line", "flow_id")

    def _ordered_approver_lines(self, record=None):
        self.ensure_one()
        lines = self.approver_line_ids.sorted(lambda l: (l.sequence, l.id))
        if not record:
            return lines
        
        # adjust this field name to your employee BPS field
        bps = int(getattr(record.employee_id, "bps", 0) or 0)
        return lines.filtered(lambda l: (l.bps_from or 1) <= bps <= (l.bps_to or 999))

    @api.constrains("model_id", "model_name")
    def _check_model_ref(self):
        for rec in self:
            if not rec.model_name and rec.model_id:
                rec.model_name = rec.model_id.model
            if not rec.model_name:
                raise ValidationError("Model Technical Name is required.")
