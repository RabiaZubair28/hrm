from __future__ import annotations

from odoo import api, fields, models, SUPERUSER_ID
from odoo.exceptions import UserError
import logging
_logger = logging.getLogger(__name__)

class HrmisTransferRequest(models.Model):
    _name = "hrmis.transfer.request"
    _description = "Transfer Request"
    _inherit = ["mail.thread", "mail.activity.mixin", "hrmis.approval.mixin"]
    _order = "id desc"

    name = fields.Char(
        string="Transfer Reference",
        required=True,
        copy=False,
        default="New",
        readonly=True,
    )

    employee_id = fields.Many2one(
        "hr.employee",
        string="Employee",
        required=True,
        
    )

    # Internal: the matching designation record in the *requested* facility, if present.
    # This is used for vacancy checks and seat reservation on approval.
    required_designation_id = fields.Many2one(
        "hrmis.designation",
        string="Matched Designation (Requested Facility)",
        required=False,
        
        domain="[('facility_id', '=', required_facility_id)]",
    )

    current_district_id = fields.Many2one(
        "hrmis.district.master",
        string="Current District",
        required=True,
        
    )
    current_facility_id = fields.Many2one(
        "hrmis.facility.type",
        string="Current Facility",
        required=True,
        
        domain="[('district_id', '=', current_district_id)]",
    )

    required_district_id = fields.Many2one(
        "hrmis.district.master",
        string="Required District",
        required=True,
        
    )
    required_facility_id = fields.Many2one(
        "hrmis.facility.type",
        string="Required Facility",
        required=True,
        
        domain="[('district_id', '=', required_district_id)]",
    )

    justification = fields.Text(string="Justification", required=True)

    submitted_by_id = fields.Many2one(
        "res.users",
        string="Submitted By",
        readonly=True,
        default=lambda self: self.env.user,
    )
    submitted_on = fields.Datetime(string="Submitted On", readonly=True)

    approved_by_id = fields.Many2one("res.users", string="Approved By", readonly=True)
    approved_on = fields.Datetime(string="Approved On", readonly=True)

    rejected_by_id = fields.Many2one("res.users", string="Rejected By", readonly=True)
    rejected_on = fields.Datetime(string="Rejected On", readonly=True)
    reject_reason = fields.Text(string="Rejection Reason")

    state = fields.Selection(
        [
            ("draft", "Draft"),
            ("submitted", "Submitted"),
            ("approved", "Approved"),
            ("rejected", "Rejected"),
        ],
        default="draft",
        
        required=True,
    )

    pending_with = fields.Char(
        string="Pending With",
        compute="_compute_pending_with",
        store=False,
    )

    so_user_id = fields.Many2one(
        "res.users",
        string="Section Officer (Dynamic)",
        readonly=True,
        copy=False,
        help="Resolved from employee's manager/parent at submit time and frozen for this request."
    )

    @api.depends("state", "pending_approver_ids")
    def _compute_pending_with(self):
        for rec in self:
            if rec.state != "submitted":
                rec.pending_with = ""
            else:
                rec.pending_with = ", ".join(rec.pending_approver_ids.mapped("name")) or ""


    def _responsible_manager_emp(self, employee):
        """Best-effort manager resolution across DB variants."""
        if not employee:
            return None
        # 1) Custom field used in some deployments
        if "employee_parent_id" in employee._fields and getattr(employee, "employee_parent_id", False):
            return employee.employee_parent_id
        # 2) Standard Odoo manager field
        if getattr(employee, "parent_id", False):
            return employee.parent_id
        # 3) Department manager
        if (
            "department_id" in employee._fields
            and employee.department_id
            and getattr(employee.department_id, "manager_id", False)
        ):
            return employee.department_id.manager_id
        # 4) Coach fallback
        if "coach_id" in employee._fields and getattr(employee, "coach_id", False):
            return employee.coach_id
        return None

    @api.onchange("employee_id")
    def _onchange_employee_id(self):
        for rec in self:
            if not rec.employee_id:
                continue
            # Auto-fill current posting from employee profile when present.
            if "district_id" in rec.employee_id._fields and rec.employee_id.district_id:
                rec.current_district_id = rec.employee_id.district_id
            if "facility_id" in rec.employee_id._fields and rec.employee_id.facility_id:
                rec.current_facility_id = rec.employee_id.facility_id

    @api.model_create_multi
    def create(self, vals_list):
        # ✅ Prevent creation if no flow configured
        self._assert_transfer_flow_configured()

        seq = self.env["ir.sequence"]
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = seq.next_by_code("hrmis.transfer.request") or "/"
        recs = super().create(vals_list)
        return recs


    def action_submit(self):
        for rec in self:
            if rec.state != "draft":
                continue

            # Resolve & freeze SO first (raises UserError if missing)
            rec._freeze_so_user()

            # ✅ Ensure statuses BEFORE changing state to submitted
            rec._ensure_statuses_created()

            # Only now mark submitted
            rec.write({"state": "submitted", "submitted_on": fields.Datetime.now()})
            rec.message_post(body="Transfer request submitted.")

            # refresh cache if you really need it
            rec.flush_recordset()
            rec._invalidate_cache()
            rec.read(["approval_step", "pending_approver_ids"])

        return True





    def _check_can_decide(self):
        self.ensure_one()
        user = self.env.user
        if user.has_group("hr.group_hr_manager") or user.has_group("base.group_system"):
            return True
        # Manager of employee can decide as well (common HR pattern)
        manager_emp = self._responsible_manager_emp(self.employee_id)
        manager_user = manager_emp.user_id if manager_emp else False
        if manager_user and manager_user.id == user.id:
            return True
        raise UserError("You are not allowed to approve/reject this transfer request.")

    def _reserve_requested_post(self):
        """Increment occupied posts for requested facility+designation (vacant auto-decrements)."""
        self.ensure_one()
        if not self.required_facility_id or not self.required_designation_id:
            raise UserError("Requested facility and designation are required to approve.")

        # Validate designation belongs to requested facility (important because designations are facility-specific here).
        if (
            "facility_id" in self.required_designation_id._fields
            and self.required_designation_id.facility_id
            and self.required_designation_id.facility_id.id != self.required_facility_id.id
        ):
            raise UserError("Requested designation does not belong to the requested facility.")

        Allocation = self.env["hrmis.facility.designation"].sudo()
        allocation = Allocation.search(
            [
                ("facility_id", "=", self.required_facility_id.id),
                ("designation_id", "=", self.required_designation_id.id),
            ],
            limit=1,
        )
        if not allocation:
            allocation = Allocation.create(
                {
                    "facility_id": self.required_facility_id.id,
                    "designation_id": self.required_designation_id.id,
                    "occupied_posts": 0,
                }
            )
            self.env.flush_all()

        # Lock row to prevent race conditions on concurrent approvals.
        self.env.cr.execute(
            "SELECT id FROM hrmis_facility_designation WHERE id=%s FOR UPDATE",
            (allocation.id,),
        )
        self.env.flush_all()
        allocation = Allocation.browse(allocation.id)

        if getattr(allocation, "remaining_posts", 0) <= 0:
            raise UserError("No vacant posts available for the requested designation in the requested facility.")

        allocation.write({"occupied_posts": allocation.occupied_posts + 1})
        self.env.flush_all()

    def _match_employee_designation_for_facility(self, facility):
        """Find the matching designation row for employee in a given facility."""
        self.ensure_one()
        employee = self.employee_id
        if not employee or not facility:
            return self.env["hrmis.designation"].browse([])

        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = getattr(employee, "hrmis_bps", 0) or 0
        if not emp_desig or not emp_bps:
            return self.env["hrmis.designation"].browse([])

        Designation = self.env["hrmis.designation"].sudo()
        name = (getattr(emp_desig, "name", "") or "").strip()
        code_raw = (getattr(emp_desig, "code", "") or "").strip()
        code = code_raw.lower()
        bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

        dom = [
            ("facility_id", "=", facility.id),
            ("active", "=", True),
            ("post_BPS", "=", emp_bps),
        ]
        if code and code not in bad_codes:
            rec = Designation.search(dom + [("code", "=ilike", code_raw)], limit=1)
            if rec:
                return rec
        return Designation.search(dom + [("name", "=ilike", name)], limit=1)

    def _decrement_current_post(self):
        """Decrement occupied posts for the employee's current facility+designation (best-effort)."""
        self.ensure_one()
        employee = self.employee_id
        if not employee:
            return

        # Prefer the request snapshot for "current", fall back to employee profile.
        cur_fac = self.current_facility_id or getattr(employee, "facility_id", False) or getattr(employee, "hrmis_facility_id", False)
        if not cur_fac:
            return

        cur_desig = self._match_employee_designation_for_facility(cur_fac)
        if not cur_desig:
            return

        Allocation = self.env["hrmis.facility.designation"].sudo()
        alloc = Allocation.search(
            [
                ("facility_id", "=", cur_fac.id),
                ("designation_id", "=", cur_desig.id),
            ],
            limit=1,
        )
        if not alloc:
            return

        # Lock row to avoid race conditions.
        self.env.cr.execute(
            "SELECT id FROM hrmis_facility_designation WHERE id=%s FOR UPDATE",
            (alloc.id,),
        )
        self.env.flush_all()
        alloc = Allocation.browse(alloc.id)
        new_val = max((alloc.occupied_posts or 0) - 1, 0)
        alloc.write({"occupied_posts": new_val})
        self.env.flush_all()

    def _apply_employee_transfer(self):
        """Apply the transfer to the employee record (posting + designation)."""
        self.ensure_one()
        employee = self.employee_id
        if not employee:
            return
        if not self.required_facility_id or not self.required_district_id or not self.required_designation_id:
            raise UserError("Required district/facility/designation must be set to apply transfer.")

        vals = {}
        # Update current posting fields across schema variants.
        if "district_id" in employee._fields:
            vals["district_id"] = self.required_district_id.id
        if "hrmis_district_id" in employee._fields:
            vals["hrmis_district_id"] = self.required_district_id.id
        if "facility_id" in employee._fields:
            vals["facility_id"] = self.required_facility_id.id
        if "hrmis_facility_id" in employee._fields:
            vals["hrmis_facility_id"] = self.required_facility_id.id

        # Keep designation consistent with facility-specific designation rows.
        if "hrmis_designation" in employee._fields:
            vals["hrmis_designation"] = self.required_designation_id.id

        if vals:
            employee.sudo().write(vals)
            self.env.flush_all()

    def action_approve(self, comment=None):
        for rec in self:
            if rec.state != "submitted":
                continue

            rec._ensure_statuses_created()

            if rec.env.user not in rec.pending_approver_ids:
                raise UserError("You are not authorized to approve this request at this stage.")

            rec.action_approve_by_user(comment=comment)

        return True


    def action_reject(self):
        for rec in self:
            if rec.state != "submitted":
                continue
            if rec.env.user not in rec.pending_approver_ids and not rec.env.user.has_group("hr.group_hr_manager"):
                raise UserError("You are not authorized to reject this request at this stage.")
            rec.write({
                "state": "rejected",
                "rejected_by_id": rec.env.user.id,
                "rejected_on": fields.Datetime.now(),
            })
            rec.message_post(body="Transfer request rejected.")

            # optional cleanup
            rec.env["hrmis.approval.status"].sudo().search([
                ("res_model", "=", rec._name),
                ("res_id", "=", rec.id),
            ]).unlink()

        return True

    def _finalize_transfer_approval(self):
        """Run the original approval business logic (vacancy + employee update)."""
        self.ensure_one()

        # Leaving the old post: decrement occupied at current posting (best-effort).
        self._decrement_current_post()
        # Joining the new post: reserve seat (will lock + validate vacancy).
        self._reserve_requested_post()
        # Apply the actual transfer on the employee record.
        self._apply_employee_transfer()

        self.write(
            {
                "state": "approved",
                "approved_by_id": self.env.user.id,
                "approved_on": fields.Datetime.now(),
            }
        )
        self.message_post(body="Transfer request approved.")

    

    def _approval_pending_states(self):
        return ("submitted",)

    def _approval_done_state(self):
        return "approved"

    def _approval_line_applicable(self, line):
        _logger.warning(
        "[APPLICABLE] TR=%s emp=%s emp_bps_raw=%s emp_bps_type=%s line_user=%s line_bps=%s..%s",
        self.id,
        self.employee_id.id if self.employee_id else None,
        getattr(self.employee_id, "bps", None),
        type(getattr(self.employee_id, "bps", None)).__name__,
        line.user_id.login,
        line.bps_from, line.bps_to,
    )
        self.ensure_one()
        emp_bps = self._employee_bps_int()
        ok = (line.bps_from or 1) <= emp_bps <= (line.bps_to or 22)
        _logger.warning("[APPLICABLE] TR=%s emp_bps=%s line=%s range=%s..%s ok=%s",
                        self.id, emp_bps, line.user_id.login, line.bps_from, line.bps_to, ok)
        return ok



    def _approval_finalize(self):
        """Called by approval engine only when ALL approvers are done."""
        self.ensure_one()
        if self.state != "submitted":
            return
        self._finalize_transfer_approval()


    def _employee_bps_int(self):
        self.ensure_one()
        emp = self.employee_id
        if not emp:
            return 0

        # try common field names
        candidates = [
            getattr(emp, "bps", None),
            getattr(emp, "hrmis_bps", None),
            getattr(emp, "bps_value", None),
        ]
        for v in candidates:
            if v is None:
                continue
            try:
                return int(v)
            except Exception:
                pass

        # try Many2one like bps_id.code
        bps_id = getattr(emp, "bps_id", None)
        if bps_id and getattr(bps_id, "code", None):
            try:
                return int(bps_id.code)
            except Exception:
                pass

        return 0


    def _resolve_so_user(self):
        """Resolve SO for this request's employee."""
        self.ensure_one()
        emp = self.employee_id

        # Option A (recommended in HR): employee.parent_id is manager employee
        # and manager employee has a user_id.
        so_user = emp.parent_id.user_id if emp and emp.parent_id else False

        # Option B (if you are using res.users.manager_id on employee user):
        # so_user = emp.user_id.manager_id if emp and emp.user_id and emp.user_id.manager_id else so_user

        return so_user
    
    def _freeze_so_user(self):
        """Set so_user_id if empty (or if you want to allow updating in draft)."""
        for rec in self:
            if rec.state not in ("draft", "submitted"):
                continue

            if rec.state == "submitted" and rec.so_user_id:
                # Already frozen
                continue

            so_user = rec._resolve_so_user()
            if not so_user:
                raise UserError(_("No Section Officer found for this employee. Please assign manager/parent first."))

            rec.sudo().write({"so_user_id": so_user.id})
            _logger.warning("[TR][SO] TR=%s freeze so_user=%s(%s)", rec.id, so_user.login, so_user.id)


    def _assert_transfer_flow_configured(self):
        """Hard-stop if no approval flow exists for transfer requests."""
        Flow = self.env["hrmis.approval.flow"].sudo()

        # Prefer model_id.model since you always have it in flow model
        flows = Flow.search([("model_name", "=", self._name)], limit=1)
        if not flows:
            raise UserError("No approvers are assigned yet. Please configure approval flow for Transfer Request first.")





    def init(self):
        """Runs on every module upgrade as well."""
        super().init()
        _logger.warning("🧪 [SEED] init() running — seeding transfer flow...")
        _seed_transfer_flow(self._cr, self.env.registry)



def _seed_transfer_flow(cr, registry):
    env = api.Environment(cr, SUPERUSER_ID, {})

    Flow = env["hrmis.approval.flow"].sudo()
    Line = env["hrmis.approval.flow.line"].sudo()
    Users = env["res.users"].sudo()

    model_name = "hrmis.transfer.request"   
    def get_or_create_user(login, name, email):
        u = Users.search([("login", "=", login)], limit=1)
        if not u:
            u = Users.create({
                "name": name,
                "login": login,
                "email": email,
                "password": "Temp123",
            })
            _logger.warning("👤 [SEED] Created user %s id=%s", login, u.id)
        return u

    u_ds  = get_or_create_user("ds_health", "Deputy Secretary Health", "ds.health@example.com")
    u_as  = get_or_create_user("as_health", "Additional Secretary Health", "as.health@example.com")
    u_ss  = get_or_create_user("ss_health", "Special Secretary Health", "ss.health@example.com")
    u_sec = get_or_create_user("secretary_health", "Secretary Health", "secretary.health@example.com")
    u_min = get_or_create_user("minister_health", "Minister of Health", "minister.health@example.com")

    def get_or_create_flow(name, domain):
        flow = Flow.search([("model_name", "=", model_name), ("name", "=", name)], limit=1)

        vals = {
            "name": name,
            "model_name": model_name,
            "sequence": 1,
            "mode": "sequential",
            "domain": domain,
        }

        if flow:
            flow.write(vals)
            _logger.warning("✅ [SEED] Flow exists/updated id=%s name=%s", flow.id, name)
        else:
            flow = Flow.create(vals)
            _logger.warning("🌱 [SEED] Created flow id=%s name=%s", flow.id, name)

        return flow

    def upsert_line(flow, user, seq, bps_from, bps_to, auto_forward_seconds=0):
        line = Line.search([("flow_id", "=", flow.id), ("user_id", "=", user.id)], limit=1)
        vals = {
            "flow_id": flow.id,
            "user_id": user.id,
            "sequence": seq,
            "sequence_type": "sequential",
            "bps_from": bps_from,
            "bps_to": bps_to,
            # ✅ NEW:
            "auto_forward_seconds": int(auto_forward_seconds or 0),
        }
        if line:
            line.write(vals)
            _logger.warning(
                "✅ [SEED] Updated line flow=%s user=%s seq=%s bps=%s..%s auto=%ss",
                flow.name, user.login, seq, bps_from, bps_to, vals["auto_forward_seconds"]
            )
        else:
            Line.create(vals)
            _logger.warning(
                "🧾 [SEED] Created line flow=%s user=%s seq=%s bps=%s..%s auto=%ss",
                flow.name, user.login, seq, bps_from, bps_to, vals["auto_forward_seconds"]
            )

    AUTO_1_MIN = 60
    AUTO_INF = 0  # infinite
    AUTO_5_MIN = 300  # used for SO injection (not flow lines)

    # Flow for BPS 16..17 => DS → AS → SS → Secretary
    flow_16_17 = get_or_create_flow(
        "Transfer Request Approval (BPS 16-17)",
        "[('employee_id.bps','>=',16),('employee_id.bps','<=',17)]"
    )
    upsert_line(flow_16_17, u_ds,  20, 16, 17, AUTO_1_MIN)
    upsert_line(flow_16_17, u_as,  30, 16, 17, AUTO_1_MIN)
    upsert_line(flow_16_17, u_ss,  40, 16, 17, AUTO_1_MIN)
    upsert_line(flow_16_17, u_sec, 50, 16, 17, AUTO_1_MIN)  # Secretary also 1 minute

    # Flow for BPS 18..19 => DS → AS → SS → Minister
    flow_18_19 = get_or_create_flow(
        "Transfer Request Approval (BPS 18-19)",
        "[('employee_id.bps','>=',18),('employee_id.bps','<=',19)]"
    )
    upsert_line(flow_18_19, u_ds,  20, 18, 19, AUTO_1_MIN)
    upsert_line(flow_18_19, u_as,  30, 18, 19, AUTO_1_MIN)
    upsert_line(flow_18_19, u_ss,  40, 18, 19, AUTO_1_MIN)
    upsert_line(flow_18_19, u_min, 50, 18, 19, AUTO_INF)  # ✅ Minister infinite

    _logger.warning("✅ [SEED] Seeded transfer flows with auto-forward (1 min, minister infinite).")
