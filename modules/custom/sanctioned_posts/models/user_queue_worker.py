# -*- coding: utf-8 -*-
import base64
import io
import logging

from odoo import models, api, SUPERUSER_ID

_logger = logging.getLogger(__name__)

try:
    import openpyxl
except Exception:
    openpyxl = None


QUEUE_PREFIX = "user_import"


class HrmisUserQueueWorker(models.AbstractModel):
    _name = "hrmis.user.queue.worker"
    _description = "HRMIS User Import Queue Worker"

    def _cell_str(self, v):
        if v is None:
            return ""
        if isinstance(v, float) and v.is_integer():
            return str(int(v)).strip()
        return str(v).strip()

    def _user_create_context(self):
        ctx = dict(self.env.context or {})
        ctx.update({
            "no_reset_password": True,
            "tracking_disable": True,
            "mail_create_nolog": True,
            "mail_create_nosubscribe": True,
        })
        return ctx

    def _create_user_in_new_transaction(self, login, password, temp_password, name):
        """
        Create one user in a separate DB transaction.
        This prevents cron timeout / rollback from wiping already-created users.
        """
        with self.env.registry.cursor() as cr:
            env = api.Environment(cr, SUPERUSER_ID, self._user_create_context())
            Users = env["res.users"].sudo()

            existing = Users.search([("login", "=", login)], limit=1)
            if existing:
                return existing.id, existing.login, False  # already existed

            vals = {
                "name": name or login,
                "login": login,
                "password": password or login,
                "temp_password": temp_password or login,
                "hrmis_role": "employee",
            }

            user = Users.create(vals)
            cr.commit()
            return user.id, user.login, True

    def _recover_processing_items(self, q, Users, pending_q, processing_q, done_q):
        """
        If cron died mid-run, items can remain in processing.
        Recovery rule:
        - if login already exists in DB => move straight to done
        - else => move back to pending
        """
        stuck_items = q.list_json(processing_q, 0, -1)
        if not stuck_items:
            return 0, 0

        moved_to_pending = 0
        moved_to_done = 0

        for item in stuck_items:
            login = self._cell_str(item.get("login"))
            existing = Users.search([("login", "=", login)], limit=1) if login else False

            if existing:
                item["_login_final"] = existing.login
                item["_created_user_id"] = existing.id
                if q.push_json(done_q, item):
                    q.lrem_json(processing_q, item, count=1)
                    moved_to_done += 1
            else:
                if q.push_json(pending_q, item):
                    q.lrem_json(processing_q, item, count=1)
                    moved_to_pending += 1

        return moved_to_pending, moved_to_done

    @api.model
    def run_user_import_batch(self, batch_size=50):
        """
        Keep this batch size modest.
        res.users creation is expensive because password hashing happens.
        """
        q = self.env["hrmis.redis.queue"].sudo()
        Users = self.env["res.users"].sudo()
        Job = self.env["hrmis.user.import.job"].sudo()

        job = Job.search([("state", "in", ["queued", "running"])], limit=1, order="id asc")
        if not job:
            return {"processed": 0, "created": 0, "failed": 0}

        if job.state != "running":
            job.write({"state": "running"})

        pending_q = f"{QUEUE_PREFIX}:{job.id}:pending"
        processing_q = f"{QUEUE_PREFIX}:{job.id}:processing"
        done_q = f"{QUEUE_PREFIX}:{job.id}:done"
        failed_q = f"{QUEUE_PREFIX}:{job.id}:failed"

        processed = 0
        created = 0
        failed = 0

        # Recover leftover processing items before new work
        recovered_pending, recovered_done = self._recover_processing_items(
            q, Users, pending_q, processing_q, done_q
        )
        if recovered_pending or recovered_done:
            _logger.warning(
                "[HRMIS][USER_IMPORT][JOB %s] recovered processing: to_pending=%s to_done=%s",
                job.id, recovered_pending, recovered_done,
            )

        for _ in range(int(batch_size or 50)):
            item, raw_json = q.rpoplpush_json(pending_q, processing_q)
            if not item:
                break

            processed += 1

            row_no = item.get("row")
            login = self._cell_str(item.get("login"))
            password = self._cell_str(item.get("password")) or login
            temp_password = self._cell_str(item.get("temp_password")) or login
            name = self._cell_str(item.get("name")) or login

            terminal_marked = False

            try:
                if not login:
                    raise Exception("Missing Pers.no. / login")

                user_id, final_login, was_created_now = self._create_user_in_new_transaction(
                    login=login,
                    password=password,
                    temp_password=temp_password,
                    name=name,
                )

                item["_login_final"] = final_login
                item["_created_user_id"] = user_id

                if not q.push_json(done_q, item):
                    raise Exception("Could not write done queue entry")

                terminal_marked = True

                if was_created_now:
                    created += 1

            except Exception as e:
                item["error"] = str(e)

                if q.push_json(failed_q, item):
                    terminal_marked = True
                    failed += 1

                _logger.warning(
                    "[HRMIS][USER_IMPORT][JOB %s] FAILED row=%s login=%s name=%s reason=%s",
                    job.id, row_no, login, name, str(e),
                )

            finally:
                if terminal_marked:
                    removed = q.lrem_raw(processing_q, raw_json, count=1)
                    if not removed:
                        _logger.warning(
                            "[HRMIS][USER_IMPORT][JOB %s] processing cleanup failed row=%s login=%s",
                            job.id, row_no, login,
                        )
                else:
                    _logger.warning(
                        "[HRMIS][USER_IMPORT][JOB %s] item left in processing row=%s login=%s because terminal queue write failed",
                        job.id, row_no, login,
                    )

        # Reconcile counters from Redis AFTER processing
        done_len = q.length(done_q)
        failed_len = q.length(failed_q)
        pending_len = q.length(pending_q)
        processing_len = q.length(processing_q)

        job.write({
            "processed_count": done_len + failed_len,
            "created_count": done_len,
            "failed_count": failed_len,
            "state": "running" if (pending_len > 0 or processing_len > 0) else "done",
        })

        if pending_len == 0 and processing_len == 0:
            try:
                self._finalize_job_with_report(job, failed_q)
            except Exception as e:
                _logger.exception(
                    "[HRMIS][USER_IMPORT][JOB %s] finalize failed: %s",
                    job.id, str(e),
                )
                job.write({
                    "state": "done",
                    "last_error": str(e),
                })

        _logger.warning(
            "[HRMIS][USER_IMPORT][JOB %s] batch_processed=%s batch_created=%s batch_failed=%s pending_left=%s processing_left=%s done=%s failed=%s",
            job.id, processed, created, failed,
            pending_len, processing_len, done_len, failed_len,
        )

        return {"processed": processed, "created": created, "failed": failed}

    def _finalize_job_with_report(self, job, failed_q: str):
        if job.state == "done" and job.report_attachment_id:
            return

        if openpyxl is None:
            job.write({
                "state": "done",
                "last_error": "openpyxl not installed; skipped report not generated.",
            })
            return

        q = self.env["hrmis.redis.queue"].sudo()
        failed_items = q.list_json(failed_q, 0, -1)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Skipped"

        ws.append([
            "Pers.no.",
            "Row",
            "Personnel Number",
            "Username",
            "Temp Password",
            "Final Login",
            "Reason",
            "Job ID",
            "Uploaded By UID",
            "Uploaded At",
        ])

        for it in failed_items:
            ws.append([
                it.get("login", ""),
                it.get("row", ""),
                it.get("name", ""),
                it.get("login", ""),
                it.get("temp_password", "") or it.get("password", ""),
                it.get("_login_final", ""),
                it.get("error", ""),
                it.get("job_id", ""),
                it.get("uploaded_by_uid", ""),
                it.get("uploaded_at", ""),
            ])

        bio = io.BytesIO()
        wb.save(bio)
        bio.seek(0)

        attachment = self.env["ir.attachment"].sudo().create({
            "name": f"user_import_skipped_job_{job.id}.xlsx",
            "type": "binary",
            "datas": base64.b64encode(bio.getvalue()),
            "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })

        job.write({
            "state": "done",
            "report_attachment_id": attachment.id,
            "last_error": False,
        })

        _logger.warning(
            "[HRMIS][USER_IMPORT][JOB %s] FINALIZED. failed=%s report_attachment_id=%s",
            job.id, len(failed_items), attachment.id
        )