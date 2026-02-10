from odoo import api, fields, models, SUPERUSER_ID
import logging
_logger = logging.getLogger(__name__)

class HrmisApprovalStatus(models.Model):
    _name = "hrmis.approval.status"
    _description = "Approval Status per Record"
    _order = "flow_sequence, sequence, id"

    flow_id = fields.Many2one("hrmis.approval.flow", required=True, ondelete="cascade")
    flow_sequence = fields.Integer(related="flow_id.sequence", string="Flow Step", store=True, index=True)

    user_id = fields.Many2one("res.users", required=True, index=True)
    sequence = fields.Integer(string="Approver Sequence", default=10, index=True)
    sequence_type = fields.Selection(
        [("sequential", "Sequential"), ("parallel", "Parallel")],
        default="sequential",
        required=True,
    )
    is_current = fields.Boolean(default=False, index=True)

    res_model = fields.Char(required=True, index=True)
    res_id = fields.Integer(required=True, index=True)

    approved = fields.Boolean(default=False, index=True)
    approved_on = fields.Datetime()
    comment = fields.Text()
    commented_on = fields.Datetime()
    auto_forward_seconds = fields.Integer(default=0, index=True)
    became_current_on = fields.Datetime(index=True)
    deadline_at = fields.Datetime(index=True)

    _sql_constraints = [
        (
            "uniq_flow_record_user_seq",
            "unique(flow_id, res_model, res_id, user_id, sequence)",
            "Duplicate approver step is not allowed for the same record.",
        ),
    ]

    @api.model
    def cron_auto_forward_approvals(self, limit=300):
        now = fields.Datetime.now()
        Status = self.sudo()

        _logger.warning(
            "[AUTO][CRON] START now=%s limit=%s",
            now, limit
        )

        expired = Status.search([
            ("approved", "=", False),
            ("is_current", "=", True),
            ("auto_forward_seconds", ">", 0),
            ("deadline_at", "!=", False),
            ("deadline_at", "<=", now),
        ], limit=limit, order="deadline_at asc, id asc")

        _logger.warning(
            "[AUTO][CRON] expired_found=%s ids=%s",
            len(expired), expired.ids
        )

        if not expired:
            # extra: show what is current but not expired
            current = Status.search([
                ("approved", "=", False),
                ("is_current", "=", True),
            ], limit=20, order="deadline_at asc, id asc")

            _logger.warning(
                "[AUTO][CRON] no expired. current_pending=%s sample=%s",
                len(current),
                [
                    (s.id, s.res_model, s.res_id,
                    s.user_id.login if s.user_id else None,
                    s.auto_forward_seconds, s.deadline_at)
                    for s in current
                ]
            )
            return True

        # group by record
        grouped = {}
        for s in expired:
            grouped.setdefault((s.res_model, s.res_id), Status.browse())
            grouped[(s.res_model, s.res_id)] |= s

        _logger.warning(
            "[AUTO][CRON] grouped_records=%s keys=%s",
            len(grouped),
            list(grouped.keys())
        )

        for (res_model, res_id), statuses in grouped.items():
            _logger.warning(
                "[AUTO][CRON] PROCESS record=%s,%s statuses=%s users=%s",
                res_model, res_id,
                statuses.ids,
                [u.login for u in statuses.mapped("user_id")]
            )

            record = self.env[res_model].sudo().browse(res_id)
            if not record.exists():
                _logger.warning("[AUTO][CRON] SKIP missing record %s,%s", res_model, res_id)
                continue

            statuses.write({
                "approved": True,
                "approved_on": now,
                "comment": "Auto forwarded.",
                "commented_on": now,
            })

            _logger.warning(
                "[AUTO][CRON] APPROVED statuses=%s",
                statuses.ids
            )

            if hasattr(record, "_after_auto_forward_recompute"):
                try:
                    record._after_auto_forward_recompute()
                    _logger.warning(
                        "[AUTO][CRON] RECOMPUTE OK record=%s,%s step=%s",
                        res_model, res_id, getattr(record, "approval_step", None)
                    )
                except Exception:
                    _logger.exception(
                        "[AUTO][CRON] RECOMPUTE FAILED record=%s,%s",
                        res_model, res_id
                    )
            else:
                _logger.warning(
                    "[AUTO][CRON] record has no _after_auto_forward_recompute(): %s,%s",
                    res_model, res_id
                )

        _logger.warning("[AUTO][CRON] END")
        return True
