from odoo import api, fields, models, _
from odoo.exceptions import UserError
from odoo.tools.safe_eval import safe_eval
import logging
_logger = logging.getLogger(__name__)



class NoApproverConfigured(Exception):
    """Raised when approval flows are missing."""
    pass


class HrmisApprovalMixin(models.AbstractModel):
    _name = "hrmis.approval.mixin"
    _description = "Generic multilevel approvals"

    approval_step = fields.Integer(default=0, readonly=False)

    approval_status_ids = fields.One2many(
        "hrmis.approval.status",
        compute="_compute_approval_status_ids",
        readonly=True,
    )

    pending_approver_ids = fields.Many2many(
        "res.users",
        relation="hrmis_approval_mixin_pending_user_rel",
        column1="res_id",
        column2="user_id",
        compute="_compute_pending_approvers",
        store=False,
        compute_sudo=True,
        readonly=True,
    )


    approver_user_ids = fields.Many2many(
        "res.users",
        relation="hrmis_approval_mixin_all_user_rel",
        column1="res_id",
        column2="user_id",
        compute="_compute_all_approvers",
        store=True,
        compute_sudo=True,
        readonly=True,
    )


    # -----------------------
    # Hooks (override per module)
    # -----------------------
    def _approval_pending_states(self):
        """Which states mean 'awaiting approval' for this model?"""
        return ("confirm", "validate1")  # override in transfer etc.

    def _approval_done_state(self):
        """Final approved state for this model (if it has state)."""
        return "approved"

    def _approval_finalize(self):
        _logger.error("[FINALIZE] TR=%s called finalize! step=%s state=%s", self.id, self.approval_step, getattr(self, "state", None))

        """Final action when all steps are approved."""
        if "state" in self._fields:
            self.state = self._approval_done_state()

    def _approval_flow_context(self):
        """Context vars available inside flow.domain safe_eval."""
        self.ensure_one()
        return {"record": self}

    def _approval_line_applicable(self, line):
        self.ensure_one()

        # pick correct bps source (adjust field name to your employee model)
        emp_bps = getattr(self.employee_id, "bps", None) or getattr(self.employee_id, "hrmis_bps", None)

        if not emp_bps:
            # if no bps, allow (or deny) - choose policy
            return True

        bps_from = getattr(line, "bps_from", 1) or 1
        bps_to = getattr(line, "bps_to", 99) or 99

        ok = (bps_from <= int(emp_bps) <= bps_to)

        _logger.warning(
            "[LINE APPLICABLE] TR=%s user=%s emp_bps=%s line_bps=%s..%s -> %s",
            self.id, line.user_id.login, emp_bps, bps_from, bps_to, ok
        )
        return ok


    # -----------------------
    # Compute fields
    # -----------------------
    def _compute_approval_status_ids(self):
        Status = self.env["hrmis.approval.status"].sudo()
        for rec in self:
            if not rec.id:
                rec.approval_status_ids = False
                continue
            rec.approval_status_ids = Status.search([
                ("res_model", "=", rec._name),
                ("res_id", "=", rec.id),
            ], order="flow_sequence, sequence, id")

    def _compute_all_approvers(self):
        Status = self.env["hrmis.approval.status"].sudo()
        for rec in self:
            if not rec.id:
                rec.approver_user_ids = False
                continue
            rows = Status.search([
                ("res_model", "=", rec._name),
                ("res_id", "=", rec.id),
            ])
            rec.approver_user_ids = rows.mapped("user_id")

    @api.depends("state", "approval_step")
    def _compute_pending_approvers(self):
        Status = self.env["hrmis.approval.status"].sudo()
        for rec in self:
            if not rec.id:
                rec.pending_approver_ids = False
                continue

            # only when record is in pending state
            if "state" in rec._fields and rec.state not in rec._approval_pending_states():
                rec.pending_approver_ids = False
                continue

            # compute active approvers from status table (NO dependency on approval_status_ids)
            active = rec._get_active_pending_statuses()
            rec.pending_approver_ids = active.mapped("user_id")


    def _get_applicable_flows(self):
        self.ensure_one()
        Flow = self.env["hrmis.approval.flow"].sudo()
        return Flow.search([("model_name", "=", self._name)], order="sequence,id")



    def _get_relevant_so_user(self):
        self.ensure_one()
        emp = self.employee_id
        if not emp:
            return False

        # “Relevant SO (parent_id)” — typical Odoo pattern:
        # hr.employee.parent_id is manager employee, whose user_id is approver user
        manager_emp = emp.parent_id
        if manager_emp and manager_emp.user_id:
            return manager_emp.user_id

        return False


    
    def _ensure_statuses_created(self):
        self.ensure_one()
        Status = self.env["hrmis.approval.status"].sudo()

        flows = self._get_applicable_flows()
        if not flows:
            raise NoApproverConfigured("No approvers are assigned yet...")

        # Set step if not set
        if not self.approval_step:
            self.sudo().approval_step = flows[0].sequence

        existing = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
        ])

        existing_keys = set(
            (s.flow_id.id, s.user_id.id, s.sequence)
            for s in existing
        )

        _logger.warning("[STATUS INIT] %s=%s existing_statuses=%s ids=%s",
                        self._name, self.id, len(existing), existing.ids)

        # ------------------------------------------------------------
        # ✅ Dynamic SO injection (FIRST approver)
        # ------------------------------------------------------------
        so_user = False
        so_seq = False
        so_created = False
        so_reason = None

        if self._name == "hrmis.transfer.request":
            emp = self.employee_id
            # Preferred: employee.manager employee -> user
            so_user = (emp.parent_id.user_id if emp and emp.parent_id else False) or \
                    (emp.user_id.manager_id if emp and emp.user_id and emp.user_id.manager_id else False)

            # Decide SO sequence: put it before the minimum existing flow line sequence.
            # Your seeded lines are 20/30/40/50 so this becomes 10.
            first_flow = flows[0]
            flow_lines = first_flow._ordered_approver_lines()
            min_seq = min(flow_lines.mapped("sequence") or [20])
            so_seq = 10 if min_seq > 10 else max(min_seq - 1, 1)

            _logger.warning(
                "[STATUS INIT][SO] TR=%s emp=%s manager_emp=%s so_user=%s so_seq=%s min_seq=%s",
                self.id,
                emp.id if emp else None,
                emp.parent_id.id if emp and emp.parent_id else None,
                (so_user.login if so_user else None),
                so_seq,
                min_seq
            )

            # Only enforce SO existence when submitted (recommended)
            if self.state == "submitted" and not so_user:
                so_reason = "SO not found (employee has no manager/parent user)"
                _logger.warning("[STATUS INIT][SO] TR=%s SKIP: %s", self.id, so_reason)
            elif so_user:
                key = (first_flow.id, so_user.id, so_seq)
                if key in existing_keys:
                    _logger.warning("[STATUS INIT][SO] TR=%s already exists: flow=%s user=%s seq=%s",
                                    self.id, first_flow.id, so_user.login, so_seq)
                else:
                    Status.create({
                        "flow_id": first_flow.id,
                        "user_id": so_user.id,
                        "sequence": so_seq,
                        "sequence_type": "sequential",  # SO step is always sequential
                        "res_model": self._name,
                        "res_id": self.id,
                        "is_current": False,  # will be set in _recompute_current_statuses()
                        "auto_forward_seconds": 60,

                        
                    })
                    so_created = True
                    existing_keys.add(key)
                    _logger.warning(
                        "[STATUS INIT][SO] create SO status user=%s seq=%s auto=%ss",
                        so_user.login, so_seq, 60
                    )
                    _logger.warning("[STATUS INIT][SO] TR=%s CREATED: flow=%s user=%s seq=%s",
                                    self.id, first_flow.id, so_user.login, so_seq)
                    

        # ------------------------------------------------------------
        # Existing log of flow lines (still useful)
        # ------------------------------------------------------------
        _logger.warning("[STATUS INIT] %s=%s flow_lines=%s",
                        self._name, self.id,
                        [(l.user_id.login, l.sequence, l.bps_from, l.bps_to)
                        for l in flows[0]._ordered_approver_lines()]
        )

        # ------------------------------------------------------------
        # Create remaining flow statuses (DS/AS/SS/Secretary etc.)
        # ------------------------------------------------------------
        created = 0
        for flow in flows:
            lines = flow._ordered_approver_lines()
            for line in lines:
                if not self._approval_line_applicable(line):
                    _logger.warning(
                        "[STATUS INIT][SKIP] %s=%s line=%s seq=%s reason=not_applicable",
                        self._name, self.id,
                        line.user_id.login, line.sequence
                    )
                    continue

                key = (flow.id, line.user_id.id, line.sequence)
                if key in existing_keys:
                    continue

                Status.create({
                    "flow_id": flow.id,
                    "user_id": line.user_id.id,
                    "sequence": line.sequence,
                    "sequence_type": line.sequence_type or flow.mode,
                    "res_model": self._name,
                    "res_id": self.id,
                    "is_current": False,
                    "auto_forward_seconds": int(line.auto_forward_seconds or 0),
                })
                created += 1
                existing_keys.add(key)
                _logger.warning(
                    "[STATUS INIT] create status flow=%s user=%s seq=%s auto=%ss",
                    flow.id, line.user_id.login, line.sequence, int(line.auto_forward_seconds or 0)
                )

        _logger.warning("[STATUS INIT] %s=%s created_missing=%s so_created=%s",
                        self._name, self.id, created, so_created)

        all_s = Status.search(
            [("res_model", "=", self._name), ("res_id", "=", self.id)],
            order="sequence,id"
        )
        _logger.warning("[STATUS INIT] %s=%s final_statuses=%s detail=%s",
                        self._name, self.id, len(all_s),
                        [(s.user_id.login, s.sequence, s.approved, s.is_current) for s in all_s]
        )

        # After ensuring statuses, recompute current flags
        self._recompute_current_statuses()

        # Extra: show who is current after recompute
        cur = all_s.filtered(lambda s: (not s.approved) and s.is_current)
        _logger.warning("[STATUS INIT] %s=%s CURRENT pending=%s",
                        self._name, self.id,
                        [(s.user_id.login, s.sequence) for s in cur])


    
    def _get_active_pending_statuses(self):
        self.ensure_one()
        Status = self.env["hrmis.approval.status"].sudo()
        

        if not Status.search_count([("res_model", "=", self._name), ("res_id", "=", self.id)]):
            self._ensure_statuses_created()
            
        pending = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
            ("flow_id.sequence", "=", self.approval_step),
        ], order="sequence, id")


        if not pending:
            return Status.browse()

        first = pending[0]

        if first.sequence_type != "parallel":
            return first

        seq = first.sequence
        active = pending.filtered(lambda s: s.sequence == seq and s.sequence_type == "parallel")
        return active


    def action_submit_for_approval(self):
        for rec in self:
            if not rec.id:
                raise UserError(_("Save the record before submitting."))
            rec._ensure_statuses_created()
            if "state" in rec._fields and rec.state in ("draft", "new"):
                rec.state = rec._approval_pending_states()[0]

    def action_approve_by_user(self, comment=None):


        _logger.warning("[APPROVE] TR=%s step=%s user=%s", self.id, self.approval_step, self.env.user.login)

        Status = self.env["hrmis.approval.status"].sudo()
        pending_all = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")

        _logger.warning("[APPROVE] pending_all count=%s ids=%s", len(pending_all), pending_all.ids)

        for s in pending_all:
            _logger.warning("[APPROVE][S] id=%s flow_seq=%s seq=%s type=%s is_current=%s user=%s approved=%s",
                s.id, getattr(s, "flow_sequence", None), s.sequence, s.sequence_type,
                getattr(s, "is_current", None), s.user_id.login if s.user_id else None, s.approved
            )

        self.ensure_one()
        self._ensure_statuses_created()

        Status = self.env["hrmis.approval.status"].sudo()

        # ✅ Always compute "current step" from DB instead of trusting approval_step
        all_pending = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")

        if not all_pending:
            # nothing pending -> already completed, just finalize safely
            self.sudo()._approval_finalize()
            return True

        current_flow_seq = all_pending[0].flow_sequence
        if self.approval_step != current_flow_seq:
            self.sudo().approval_step = current_flow_seq

        # ✅ Now fetch pending for *this* step only
        pending_step = all_pending.filtered(lambda s: s.flow_sequence == current_flow_seq)

        # pick active within step (sequential/parallel)
        first = pending_step[0]
        if first.sequence_type == "parallel":
            active = pending_step.filtered(
                lambda s: s.sequence == first.sequence and s.sequence_type == "parallel"
            )
        else:
            active = first

        mine = active.filtered(lambda s: s.user_id == self.env.user)
        if not mine:
            raise UserError(_("You are not authorized to approve at this stage."))

        now = fields.Datetime.now()
        vals = {"approved": True, "approved_on": now}
        
        vals.update({
            "comment": (comment or "No Comment"),
            "commented_on": now,
        })
        
        mine.write(vals)

        if self._get_active_pending_statuses():
            self._recompute_current_statuses()
            return True
        
        pending_after = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")
        _logger.warning("[APPROVE] pending_after count=%s ids=%s", len(pending_after), pending_after.ids)


        # ✅ Check again: is there still someone pending in the same step?
        remaining_step = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
            ("flow_sequence", "=", current_flow_seq),
        ], order="sequence, id")

        if remaining_step:
            # still pending in this step -> stay submitted, do NOT finalize
            return True

        # ✅ Move to next step (next flow_sequence) if it exists
        remaining_any = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")

        if remaining_any:
            self.sudo().approval_step = remaining_any[0].flow_sequence
            return True
        _logger.warning("[APPROVE] TR=%s step=%s user=%s", self.id, self.approval_step, self.env.user.login)

        Status = self.env["hrmis.approval.status"].sudo()
        pending_all = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")

        _logger.warning("[APPROVE] pending_all count=%s ids=%s", len(pending_all), pending_all.ids)
        for s in pending_all:
            _logger.warning("[APPROVE][S] id=%s flow_seq=%s seq=%s type=%s is_current=%s user=%s approved=%s",
                s.id, getattr(s, "flow_sequence", None), s.sequence, s.sequence_type,
                getattr(s, "is_current", None), s.user_id.login if s.user_id else None, s.approved
            )

        # ✅ nothing left anywhere -> finalize
        self.sudo()._approval_finalize()
        self._recompute_current_statuses()
        return True



    def _get_active_pending_users(self):
        """Users who should act *now* (sequential -> 1 user, parallel -> group)."""
        self.ensure_one()
        active = self._get_active_pending_statuses()
        return active.mapped("user_id")


    def _recompute_current_statuses(self):
        Status = self.env["hrmis.approval.status"].sudo()
        now = fields.Datetime.now()

        for rec in self:
            _logger.warning(
                "[AUTO][RECOMP] %s=%s step=%s",
                rec._name, rec.id, rec.approval_step
            )

            Status.search([
                ("res_model", "=", rec._name),
                ("res_id", "=", rec.id),
            ]).write({"is_current": False})

            pending = Status.search([
                ("res_model", "=", rec._name),
                ("res_id", "=", rec.id),
                ("approved", "=", False),
                ("flow_id.sequence", "=", rec.approval_step),
            ], order="sequence, id")

            _logger.warning(
                "[AUTO][RECOMP] %s=%s pending_in_step=%s ids=%s",
                rec._name, rec.id, len(pending), pending.ids
            )

            if not pending:
                continue

            first = pending[0]
            _logger.warning(
                "[AUTO][RECOMP] %s=%s first_pending id=%s user=%s seq=%s type=%s auto=%ss",
                rec._name, rec.id,
                first.id,
                first.user_id.login if first.user_id else None,
                first.sequence,
                first.sequence_type,
                getattr(first, "auto_forward_seconds", None),
            )

            if first.sequence_type == "parallel":
                current = pending.filtered(lambda s: s.sequence == first.sequence and s.sequence_type == "parallel")
            else:
                current = first

            # mark current
            current.write({"is_current": True})

            _logger.warning(
                "[AUTO][RECOMP] %s=%s CURRENT ids=%s users=%s",
                rec._name, rec.id,
                current.ids,
                [u.login for u in current.mapped("user_id")]
            )

            # start timers only once
            to_start = current.filtered(lambda s: not s.became_current_on)
            _logger.warning(
                "[AUTO][RECOMP] %s=%s to_start_timer=%s ids=%s",
                rec._name, rec.id, len(to_start), to_start.ids
            )

            for s in to_start:
                secs = int(s.auto_forward_seconds or 0)
                deadline = fields.Datetime.add(now, seconds=secs) if secs > 0 else False

                _logger.warning(
                    "[AUTO][RECOMP] start_timer status=%s user=%s secs=%s deadline=%s",
                    s.id,
                    s.user_id.login if s.user_id else None,
                    secs,
                    deadline
                )

                s.write({
                    "became_current_on": now,
                    "deadline_at": deadline,
                })


    def _after_auto_forward_recompute(self):
        """Advance step/finalize after cron approvals (keeps existing state logic)."""
        self.ensure_one()
        Status = self.env["hrmis.approval.status"].sudo()

        # still pending in current step?
        remaining_step = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
            ("flow_id.sequence", "=", self.approval_step),
        ], order="sequence, id")

        if remaining_step:
            self._recompute_current_statuses()
            return True

        # move to next step if any
        remaining_any = Status.search([
            ("res_model", "=", self._name),
            ("res_id", "=", self.id),
            ("approved", "=", False),
        ], order="flow_sequence, sequence, id")

        if remaining_any:
            self.sudo().approval_step = remaining_any[0].flow_sequence
            self._recompute_current_statuses()
            return True

        # nothing left: finalize (your existing finalize sets state)
        self.sudo()._approval_finalize()
        self._recompute_current_statuses()
        return True
