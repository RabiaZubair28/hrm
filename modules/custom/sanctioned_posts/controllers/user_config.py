# -*- coding: utf-8 -*-
import json
import logging
from io import BytesIO
from datetime import datetime, date
import uuid
from urllib.parse import quote
from odoo import http, fields
from odoo.http import request

_logger = logging.getLogger(__name__)

try:
    import openpyxl
except Exception:
    openpyxl = None


QUEUE_NAME = "user_import"

def _norm(s):
    return (s or "").strip().lower()


def _parse_dob(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    s = str(value).strip()
    for fmt in ("%d.%m.%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except Exception:
            pass
    return s 


class HrmisUserConfigController(http.Controller):

    @http.route("/hrmis/user_config", type="http", auth="user", website=True, methods=["GET"], csrf=True)
    def user_config_page(self, **kw):
        Users = request.env["res.users"].sudo()

        # "today" in server date; if you want user tz-day we can adjust later
        today = fields.Date.today()
        start_dt = fields.Datetime.to_datetime(f"{today} 00:00:00")

        total_users = Users.search_count([])
        users_created_today = Users.search_count([("create_date", ">=", start_dt)])

        q = request.env["hrmis.redis.queue"].sudo()
        queue_len = q.length(QUEUE_NAME)
        latest_job = request.env["hrmis.user.import.job"].sudo().search([], limit=1, order="id desc")
        

        ctx = {
            "active_menu": "user_config",
            "metrics": {
                "total_users": total_users,
                "users_created_today": users_created_today,
                "queue_len": queue_len,
            },
            "flash_success": kw.get("flash_success"),
            "flash_error": kw.get("flash_error"),
            "last_queued_preview": kw.get("last_queued_preview"),
        }
        ctx["latest_job"] = latest_job
        return request.render("sanctioned_posts.hrmis_user_config_page", ctx)

    @http.route("/hrmis/user_config/upload", type="http", auth="user", website=True, methods=["POST"], csrf=True)
    def user_config_upload(self, **post):
        if openpyxl is None:
            return self._redirect_err("openpyxl not installed in container. Install it to parse XLSX.")

        f = request.httprequest.files.get("xlsx_file")
        if not f:
            return self._redirect_err("No file received.")

        sheet_name = (post.get("sheet_name") or "").strip()

        try:
            wb = openpyxl.load_workbook(filename=BytesIO(f.read()), data_only=True)

            # NEW: choose sheet
            if sheet_name:
                if sheet_name not in wb.sheetnames:
                    return self._redirect_err(
                        "Invalid sheet selected: %s. Available sheets: %s"
                        % (sheet_name, ", ".join(wb.sheetnames))
                    )
                ws = wb[sheet_name]
            else:
                # fallback: if JS not loaded / older browser
                ws = wb.active

        except Exception as e:
            return self._redirect_err(f"Failed to read XLSX: {e}")

        headers = [(_norm(c.value)) for c in ws[1]]

        def find_col(*names):
            wanted = {_norm(n) for n in names}
            for idx, h in enumerate(headers):
                if h in wanted:
                    return idx
            return None

        col_name = find_col("name of medical officer", "name")
        col_dob = find_col("date of birth", "dob")
        col_dom = find_col("domicile code", "domicile_code")
        col_sen = find_col("Sen: No", "sen: no", "sen no", "s.no", "s no", "serial", "serial no", "sr", "sr no")

        if col_name is None or col_dob is None or col_dom is None or col_sen is None:
            return self._redirect_err(
                "Missing required columns. Need: Sen: No, Name of Medical Officer, Date of Birth, Domicile code."
            )

        q = request.env["hrmis.redis.queue"].sudo()
        Job = request.env["hrmis.user.import.job"].sudo()

        job = Job.create({
            "name": f"User Import - {fields.Datetime.now()}",
            "state": "queued",
            "queued_count": 0,
            "processed_count": 0,
            "created_count": 0,
            "failed_count": 0,
        })

        pending_q = f"{QUEUE_NAME}:{job.id}:pending"

        queued = 0
        preview_rows = []

        for r in range(2, ws.max_row + 1):
            row = ws[r]
            name = row[col_name].value
            dob = row[col_dob].value
            dom = row[col_dom].value
            sen_no = row[col_sen].value

            if not name and not dob and not dom:
                continue

            payload = {
                "job_id": job.id,
                "sen_no": str(sen_no).strip() if sen_no is not None else "",
                "name": (str(name).strip() if name else ""),
                "dob": _parse_dob(dob),
                "domicile_code": (str(dom).strip() if dom else ""),
                "row": r,
                "uploaded_by_uid": request.env.user.id,
                "uploaded_at": fields.Datetime.now().isoformat(),
                "queue_id": uuid.uuid4().hex,
            }

            ok = q.push_json(pending_q, payload)
            if ok:
                queued += 1
                if len(preview_rows) < 5:
                    preview_rows.append(payload)

        job.write({
            "queued_count": queued,
            "state": "queued",
        })

        today = fields.Date.today()
        start_dt = fields.Datetime.to_datetime(f"{today} 00:00:00")

        latest_job = job
        ctx = {
            "active_menu": "user_config",
            "metrics": {
                "total_users": request.env["res.users"].sudo().search_count([]),
                "users_created_today": request.env["res.users"].sudo().search_count([("create_date", ">=", start_dt)]),
                # show pending queue for this job
                "queue_len": q.length(pending_q),
            },
            "flash_success": f"Queued {queued} users into Redis queue for Job #{job.id} (Sheet: {sheet_name or ws.title})",
            "flash_error": None,
            "last_queued_preview": json.dumps(preview_rows, indent=2, ensure_ascii=False),
            "latest_job": latest_job,
            "job_pending_key": pending_q,
        }

        return request.render("sanctioned_posts.hrmis_user_config_page", ctx)

    def _redirect_err(self, msg: str):
        return request.redirect("/hrmis/user_config?flash_error=%s" % quote(msg or "", safe=""))
    
    @http.route("/hrmis/user_config/queue", type="http", auth="user", website=True, methods=["GET"], csrf=True)
    def user_queue_page(self, **kw):
        q = request.env["hrmis.redis.queue"].sudo()
        Job = request.env["hrmis.user.import.job"].sudo()

        latest_job = Job.search([], limit=1, order="id desc")

        # Default empty values
        pending = processing = done = failed = 0
        pending_list = []
        failed_list = []
        done_list = []

        pending_q = processing_q = done_q = failed_q = None

        if latest_job:
            pending_q = f"{QUEUE_NAME}:{latest_job.id}:pending"
            processing_q = f"{QUEUE_NAME}:{latest_job.id}:processing"
            done_q = f"{QUEUE_NAME}:{latest_job.id}:done"
            failed_q = f"{QUEUE_NAME}:{latest_job.id}:failed"

            pending = q.length(pending_q)
            processing = q.length(processing_q)
            done = q.length(done_q)
            failed = q.length(failed_q)

            pending_list = q.list_json(pending_q, 0, 9)
            failed_list = q.list_json(failed_q, 0, 9)
            done_list = q.list_json(done_q, 0, 9)

        ctx = {
            "active_menu": "user_config",
            "latest_job": latest_job,

            "pending": pending,
            "processing": processing,
            "done": done,
            "failed": failed,

            "pending_list": pending_list,
            "failed_list": failed_list,
            "done_list": done_list,

            "pending_q": pending_q,
            "processing_q": processing_q,
            "done_q": done_q,
            "failed_q": failed_q,
        }
        return request.render("sanctioned_posts.hrmis_user_queue_page", ctx)
    
    @http.route("/hrmis/user_config/process", type="http", auth="user", website=True, methods=["GET"], csrf=False)
    def user_config_process(self, **kw):
        return request.redirect("/hrmis/user_config/queue")