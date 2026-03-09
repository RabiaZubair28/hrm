# -*- coding: utf-8 -*-
import base64
import io
import logging
from datetime import date, datetime
from odoo import models, api

_logger = logging.getLogger(__name__)

try:
    import openpyxl
except Exception:
    openpyxl = None


QUEUE_PREFIX = "user_import" 


class HrmisUserQueueWorker(models.AbstractModel):
    _name = "hrmis.user.queue.worker"
    _description = "HRMIS User Import Queue Worker"

    @api.model
    def run_user_import_batch(self, batch_size=300):
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

        processed = created = failed = 0

        def _clean_token(s: str) -> str:
            s = (s or "").strip().lower()
            return "".join(ch for ch in s if ch.isalnum())

        def _split_first_last(full_name: str):
            raw = (full_name or "").strip()
            parts = [p for p in raw.replace(".", " ").split() if p.strip()]
            parts = [p for p in parts if p.lower() not in ("dr", "mr", "mrs", "ms", "prof")]
            if not parts:
                return "", ""
            if len(parts) == 1:
                t = _clean_token(parts[0])
                return t, ""   # last missing
            return _clean_token(parts[0]), _clean_token(parts[-1])

        def _parse_dob(dob_val):
            if not dob_val:
                return None
            if isinstance(dob_val, datetime):
                return dob_val
            if isinstance(dob_val, date):
                return datetime(dob_val.year, dob_val.month, dob_val.day)

            s = str(dob_val).strip()
            for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y"):
                try:
                    if fmt == "%Y-%m-%d":
                        return datetime.strptime(s[:10], fmt)
                    return datetime.strptime(s, fmt)
                except Exception:
                    pass
            return None

        def _make_login(first: str, last: str, dob_dt: datetime) -> str:
            if not first or not dob_dt:
                return ""
            if not last:
                last = first
            return f"{first}.{last}.{dob_dt.strftime('%d%m')}"

        def _make_password(last: str, dob_dt: datetime, domicile_code: str) -> str:
            if not last or not dob_dt or not domicile_code:
                return ""
            return f"{last}{dob_dt.strftime('%d%m%Y')}{domicile_code.strip().lower()}"

        # Process batch
        for _ in range(int(batch_size)):
            item, raw_json = q.rpoplpush_json(pending_q, processing_q)
            if not item:
                break

            processed += 1

            sen_no = (item.get("sen_no") or "").strip()
            row_no = item.get("row")

            name = (item.get("name") or "").strip()
            dob_raw = item.get("dob")
            domicile_code = (item.get("domicile_code") or "").strip()

            first, last = _split_first_last(name)
            dob_dt = _parse_dob(dob_raw)

            base_login = _make_login(first, last, dob_dt)
            base_password = _make_password((last or first), dob_dt, domicile_code)

            item["_login_base"] = base_login
            item["_password_base"] = base_password

            try:
                # validations
                if not name:
                    raise Exception("Missing name")
                if not first:
                    raise Exception("Could not parse first name")
                if not dob_dt:
                    raise Exception("DOB format not recognized")
                if not domicile_code:
                    raise Exception("Missing domicile_code")
                if not base_login:
                    raise Exception("Could not build login")
                if not base_password:
                    raise Exception("Could not build password")

                # duplication rule: base -> dr.base -> fail
                login_to_use = base_login

                base_exists = bool(Users.search([("login", "=", base_login)], limit=1))
                if base_exists:
                    base_no_dr = base_login[3:] if base_login.startswith("dr.") else base_login
                    dr_login = f"dr.{base_no_dr}"

                    dr_exists = bool(Users.search([("login", "=", dr_login)], limit=1))
                    if dr_exists:
                        raise Exception("Username duplicate beyond 2 (base and dr. already exist)")
                    login_to_use = dr_login

                vals = {
                    "name": name,
                    "login": login_to_use,
                    "email": login_to_use,
                    "temp_password": base_password,
                    "hrmis_role": "employee",
                    "manager_id": 4,
                }

                with self.env.cr.savepoint():
                    Users.create(vals)

                created += 1
                item["_login_final"] = login_to_use
                q.push_json(done_q, item)

            except Exception as e:
                failed += 1
                item["error"] = str(e)
                item["_login_final"] = None
                q.push_json(failed_q, item)

                _logger.warning(
                    "[HRMIS][USER_IMPORT][JOB %s] FAILED sen_no=%s row=%s name=%s reason=%s",
                    job.id, sen_no, row_no, name, str(e),
                )

            finally:
                # ✅ always remove exact raw item from processing
                removed = q.lrem_raw(processing_q, raw_json, count=1)
                if not removed:
                    _logger.warning(
                        "[HRMIS][USER_IMPORT][JOB %s] processing cleanup failed (raw mismatch) sen_no=%s row=%s",
                        job.id, sen_no, row_no,
                    )

        # single commit at end (cron-friendly)
        self.env.cr.commit()

        job.write({
            "processed_count": job.processed_count + processed,
            "created_count": job.created_count + created,
            "failed_count": job.failed_count + failed,
        })

        if q.length(pending_q) == 0 and q.length(processing_q) == 0:
            self._finalize_job_with_report(job, failed_q)

        _logger.warning(
            "[HRMIS][USER_IMPORT][JOB %s] processed=%s created=%s failed=%s pending_left=%s processing_left=%s",
            job.id, processed, created, failed,
            q.length(pending_q), q.length(processing_q),
        )

        return {"processed": processed, "created": created, "failed": failed}
    
    def _finalize_job_with_report(self, job, failed_q: str):
        if job.state == "done":
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
            "Sen No",
            "Row",
            "Name",
            "DOB",
            "Domicile Code",
            "Base Login",
            "Final Login",
            "Password",
            "Reason",
            "Job ID",
            "Uploaded By UID",
            "Uploaded At",
        ])

        for it in failed_items:
            ws.append([
                it.get("sen_no", ""),
                it.get("row", ""),
                it.get("name", ""),
                it.get("dob", ""),
                it.get("domicile_code", ""),
                it.get("_login_base", ""),
                it.get("_login_final", ""),
                it.get("_password_base", ""),
                it.get("error", ""),
                it.get("job_id", ""),
                it.get("uploaded_by_uid", ""),
                it.get("uploaded_at", ""),
            ])

        bio = io.BytesIO()
        wb.save(bio)
        bio.seek(0)

        data_b64 = base64.b64encode(bio.getvalue())

        attachment = self.env["ir.attachment"].sudo().create({
            "name": f"user_import_skipped_job_{job.id}.xlsx",
            "type": "binary",
            "datas": data_b64,
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