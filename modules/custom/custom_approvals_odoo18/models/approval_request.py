from odoo import models, fields, api


class ApprovalRequest(models.Model):
    _name = "approval.request"
    _description = "Approval Request"
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'id desc'

    name = fields.Char(string="Title", required=True)
    request_date = fields.Datetime(
        string="Request Date",
        default=lambda self: fields.Datetime.now(),
    )
    requester_id = fields.Many2one(
        'res.users', string="Requested By",
        default=lambda self: self.env.user,
    )

    approval_type_id = fields.Many2one(
        'approval.type', string="Approval Type", required=True
    )

    description = fields.Text(string="Description")

    # Status Flow: draft → pending → approved / rejected
    state = fields.Selection([
        ('draft', 'Draft'),
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ], default='draft')

    action_ids = fields.One2many(
        'approval.action', 'request_id',
        string="Actions"
    )

    approved_by = fields.Many2one('res.users', string="Approved By")
    approved_date = fields.Datetime(string="Approval Date")
    
    payload = fields.Json(string="Payload", copy=False)
    assigned_to = fields.Many2one('res.users', string="Assigned To")
    
    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        for rec in recs:
            # if not assigned and payload has cadre, find mapping
            if not rec.assigned_to and rec.payload and rec.payload.get('cadre'):
                mapping = self.env['hr.cadre.mapping'].search([('cadre_id','=',int(rec.payload.get('cadre')))], limit=1)
                if mapping and mapping.so_ids:
                    rec.assigned_to = mapping.so_ids[0].id
        return recs
    def set_pending(self):
        for rec in self:
            rec.state = 'pending'
            rec.action_ids.create({
                'request_id': rec.id,
                'action': 'submit',
                'user_id': self.env.user.id,
                'note': 'Submitted for approval',
            })

    
    def action_approve(self):
        for rec in self:
            rec.state = 'approved'
            rec.approved_by = self.env.user.id
            rec.approved_date = fields.Datetime.now()
            # audit
            self.env['approval.action'].create({
                'request_id': rec.id,
                'action': 'approve',
                'user_id': self.env.user.id,
                'note': 'Approved by SO'
            })
            # apply snapshot to hr.profile (if we saved profile_id on request)
            # find profile by requester
            profile = self.env['hr.profile'].search([('user_id','=',rec.requester_id.id)], limit=1)
            if profile and rec.payload:
                profile_vals = {}
                # loop keys: be intentional
                for k,v in rec.payload.items():
                    if k in profile._fields:
                        profile_vals[k] = v
                profile.sudo().write(profile_vals)
                profile.sudo().write({'state':'approved'})
                rec.requester_id.sudo().write({'onboarding_state':'approved'})

    def action_reject(self):
        for rec in self:
            rec.state = 'rejected'
            rec.action_ids.create({
                'request_id': rec.id,
                'action': 'reject',
                'user_id': self.env.user.id,
                'note': 'Rejected',
            })