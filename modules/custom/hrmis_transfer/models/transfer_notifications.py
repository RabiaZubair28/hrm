from __future__ import annotations

from odoo import api, models


class HrmisTransferRequestNotifications(models.Model):
    _inherit = "hrmis.transfer.request"

    def _hrmis_push(self, users, title: str, body: str):
        Notification = self.env["hrmis.notification"].sudo()
        for user in users or self.env["res.users"].browse([]):
            if not user:
                continue
            Notification.create(
                {
                    "user_id": user.id,
                    "title": title,
                    "body": body,
                    "res_model": "hrmis.transfer.request",
                    "res_id": self.id if len(self) == 1 else None,
                }
            )

    def _transfer_description(self):
        """Return a human-readable transfer snippet with facility/district info."""
        self.ensure_one()
        cur_fac = self.current_facility_id.name if self.current_facility_id else "N/A"
        cur_dist = self.current_district_id.name if self.current_district_id else "N/A"
        req_fac = self.required_facility_id.name if self.required_facility_id else "N/A"
        req_dist = self.required_district_id.name if self.required_district_id else "N/A"
        return (
            f"Your transfer request from {cur_fac}, {cur_dist} "
            f"to {req_fac}, {req_dist}"
        )

    def _notify_employee(self, body: str):
        if self.env.context.get("hrmis_skip_employee_notifications"):
            return
        for rec in self:
            emp = rec.employee_id
            user = emp.user_id if emp and emp.user_id else None
            if not user:
                continue
            rec._hrmis_push(user, "Transfer request update", body)

    def _notify_next_approver(self, users):
        """Notify only the *current* approver(s) (i.e., whoever is active now)."""
        for rec in self:
            users = users or self.env["res.users"].browse([])
            users = users.filtered(lambda u: u and u.active)
            if not users:
                continue

            desc = rec._transfer_description()
            emp_name = rec.employee_id.name or "an employee"
            approver_desc = desc.replace("Your", f"{emp_name}'s", 1)
            rec._hrmis_push(
                users,
                "Transfer request pending approval",
                f"{approver_desc} needs your action.",
            )

    def action_submit(self):
        res = super().action_submit()
        for rec in self:
            if rec.state == "submitted":
                desc = rec._transfer_description()
                rec._notify_employee(f"{desc} has been submitted.")
        return res

    def action_approve(self, comment=None):
        """
        Send transfer alerts to approvers *step-by-step*.

        After an approver approves (action_approve button), notify ONLY the newly-current
        next approver (DS -> AS -> ...). This avoids sending alerts to everyone on submit.
        """
        before_active_by_id = {
            rec.id: set(rec._get_active_pending_users().ids) for rec in self
        }

        res = super().action_approve(comment=comment)

        for rec in self:
            after_users = rec._get_active_pending_users()
            after_ids = set(after_users.ids)
            before_ids = before_active_by_id.get(rec.id, set())

            # Only notify when the "current approver" changes (i.e., chain advanced).
            if not after_ids or after_ids == before_ids:
                continue

            # Safety: never re-notify the approver who just approved.
            if rec.env.user.id in after_ids:
                continue

            rec._notify_next_approver(after_users)

        return res

    @api.model_create_multi
    def create(self, vals_list):
        recs = super().create(vals_list)
        # If created already in submitted state (unlikely), still notify employee.
        for rec in recs:
            if rec.state == "submitted":
                desc = rec._transfer_description()
                rec._notify_employee(f"{desc} has been submitted.")
        return recs

    def write(self, vals):
        old_states = {}
        if "state" in vals:
            old_states = {r.id: r.state for r in self}

        res = super().write(vals)

        if "state" in vals:
            for rec in self:
                old = old_states.get(rec.id)
                new = rec.state
                if not old or old == new:
                    continue
                desc = rec._transfer_description()
                # Submitted notification is handled in action_submit() to avoid duplicates.
                if new == "approved":
                    rec._notify_employee(f"{desc} has been accepted.")
                elif new == "rejected":
                    rec._notify_employee(f"{desc} has been dismissed.")
        return res