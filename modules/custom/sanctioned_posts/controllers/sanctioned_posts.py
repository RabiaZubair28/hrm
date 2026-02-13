from odoo import http
from odoo.http import request
from odoo.exceptions import AccessError, UserError, ValidationError
from io import BytesIO
import base64
import re
import datetime
import csv
from io import StringIO

try:
    import openpyxl
except Exception:
    openpyxl = None


class HrmisSanctionedPostsController(http.Controller):

    # ---- helpers ----
    def _ensure_admin(self):
        if not request.env.user.has_group("base.group_system"):
            raise AccessError("You are not allowed to access this page.")

    def _digits_only(self, s: str) -> str:
        return re.sub(r"\D+", "", s or "")

    def _last4_digits(self, s) -> str:
        d = self._digits_only("" if s is None else str(s))
        return d[-4:] if len(d) >= 4 else d.zfill(4)

    def _dob_digits(self, dob_val) -> str:
        """
        As per requirement: DOB without dashes/slashes.
        If excel date => format YYYYMMDD
        If string => strip non-digits (02-19-2021 => 02192021)
        """
        if isinstance(dob_val, (datetime.date, datetime.datetime)):
            return dob_val.strftime("%Y%m%d")
        return self._digits_only("" if dob_val is None else str(dob_val))

    def _normalize_columns(self, header_row_values):
        header = [("" if v is None else str(v).strip()) for v in header_row_values]
        columns, used = [], set()
        for i, h in enumerate(header, start=1):
            name = h if h else f"Column {i}"
            base = name
            n = 2
            while name in used:
                name = f"{base} ({n})"
                n += 1
            used.add(name)
            columns.append(name)
        return columns

    def _find_col(self, columns, candidates):
        """
        candidates: list of possible header names (case-insensitive)
        returns the actual column name as in columns[] or None
        """
        m = {c.lower(): c for c in columns}
        for cand in candidates:
            key = cand.lower()
            if key in m:
                return m[key]
        return None

    def _template(self):
        # Keep your existing external id (as you already used)
        return "sanctioned_posts.hrmis_sanctioned_posts_upload_page"

    # ---- routes ----
    @http.route("/hrmis/sanctioned_posts/upload", type="http", auth="user", website=True)
    def upload_page(self, **kw):
        self._ensure_admin()
        return request.render(self._template(), {
            "active_menu": "sanctioned_posts",
            "upload_result": None,
            "upload_error": None,
            "attachment_id": None,
        })

    @http.route("/hrmis/sanctioned_posts/upload_xlsx", type="http", auth="user",
                website=True, csrf=True, methods=["POST"])
    def upload_xlsx(self, **post):
        self._ensure_admin()

        if openpyxl is None:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "openpyxl is not installed on the server. Install it to read .xlsx files.",
                "attachment_id": None,
            })

        file_storage = request.httprequest.files.get("xlsx_file")
        if not file_storage or not file_storage.filename:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "No file selected. Please upload an .xlsx file.",
                "attachment_id": None,
            })

        if not file_storage.filename.lower().endswith(".xlsx"):
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "Invalid file type. Please upload an .xlsx file.",
                "attachment_id": None,
            })

        try:
            content = file_storage.read()

            # Store file so "Create Users" can reuse it without re-upload
            attachment = request.env["ir.attachment"].sudo().create({
                "name": file_storage.filename,
                "type": "binary",
                "datas": base64.b64encode(content),
                "mimetype": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "res_model": "res.users",
            })

            wb = openpyxl.load_workbook(filename=BytesIO(content), data_only=True)
            ws = wb.active

            columns = self._normalize_columns([c.value for c in ws[1]])

            rows = []
            count = 0
            for row_cells in ws.iter_rows(min_row=2, values_only=True):
                if not row_cells or all((v is None or str(v).strip() == "") for v in row_cells):
                    continue
                count += 1

                if len(rows) < 10:
                    row_dict = {}
                    for idx, col_name in enumerate(columns):
                        val = row_cells[idx] if idx < len(row_cells) else ""
                        row_dict[col_name] = "" if val is None else val
                    rows.append(row_dict)

            upload_result = {
                "count": count,
                "columns": columns,
                "top10": rows,
            }

            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": upload_result,
                "upload_error": None,
                "attachment_id": attachment.id,
            })

        except Exception as e:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": f"Failed to read XLSX: {e}",
                "attachment_id": None,
            })

    @http.route(
        "/hrmis/sanctioned_posts/create_users",
        type="http",
        auth="user",
        website=True,
        csrf=True,
        methods=["POST"],
    )
    def create_users(self, **post):
        self._ensure_admin()

        attachment_id = int(post.get("attachment_id") or 0)
        if not attachment_id:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "Missing attachment_id. Please upload the XLSX again.",
                "attachment_id": None,
                "creds_attachment_id": None,
                "creds_preview": [],
            })

        attachment = request.env["ir.attachment"].sudo().browse(attachment_id)
        if not attachment.exists():
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "Uploaded file not found. Please upload again.",
                "attachment_id": None,
                "creds_attachment_id": None,
                "creds_preview": [],
            })

        if openpyxl is None:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": "openpyxl is not installed on the server.",
                "attachment_id": attachment.id,
                "creds_attachment_id": None,
                "creds_preview": [],
            })

        try:
            content = base64.b64decode(attachment.datas or b"")
            wb = openpyxl.load_workbook(filename=BytesIO(content), data_only=True)
            ws = wb.active

            columns = self._normalize_columns([c.value for c in ws[1]])

            # Your headers: CNIC, DOB, PHONE
            cnic_col = self._find_col(columns, ["cnic"])
            dob_col = self._find_col(columns, ["dob", "date of birth", "date_of_birth"])
            phone_col = self._find_col(columns, ["phone", "mobile", "mobile_no", "mobile no"])
            name_col = self._find_col(columns, ["name", "employee name", "employee_name", "full name", "full_name"])

            if not cnic_col or not dob_col or not phone_col:
                raise UserError(
                    "Missing required columns. Required: CNIC, DOB, PHONE.\n"
                    f"Detected columns: {', '.join(columns)}"
                )

            Users = request.env["res.users"].sudo()
            Attach = request.env["ir.attachment"].sudo()

            created = 0
            skipped = 0
            errors = []
            processed = 0

            seen_logins = set()

            # Store ALL created credentials for CSV
            created_creds_all = []  # list of (login, password)
            # Show only first N on page
            creds_preview = []
            preview_limit = 50

            batch = []
            batch_creds = []   # parallel list of (login,password) for the batch
            batch_size = 500

            def add_cred(login, password):
                created_creds_all.append((login, password))
                if len(creds_preview) < preview_limit:
                    creds_preview.append({"login": login, "password": password})

            def flush_batch():
                nonlocal created, batch, batch_creds, skipped, errors
                if not batch:
                    return
                try:
                    new_users = Users.create(batch)
                    # assume recordset order matches input order (usually yes)
                    for _u, (lg, pw) in zip(new_users, batch_creds):
                        add_cred(lg, pw)
                    created += len(batch)
                    request.env.cr.commit()
                    batch = []
                    batch_creds = []
                except Exception as e:
                    # Rollback and isolate bad rows (duplicate login etc.)
                    request.env.cr.rollback()
                    for vals, (lg, pw) in zip(batch, batch_creds):
                        try:
                            Users.create(vals)
                            add_cred(lg, pw)
                            created += 1
                        except Exception as e2:
                            skipped += 1
                            if len(errors) < 50:
                                errors.append(f"Skipped {lg}: {str(e2)}")
                    request.env.cr.commit()
                    batch = []
                    batch_creds = []

            for row_index, row_cells in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                if not row_cells or all((v is None or str(v).strip() == "") for v in row_cells):
                    continue

                processed += 1

                row = {}
                for idx, col in enumerate(columns):
                    row[col] = row_cells[idx] if idx < len(row_cells) else None

                cnic = ("" if row.get(cnic_col) is None else str(row.get(cnic_col)).strip())
                if not cnic:
                    skipped += 1
                    if len(errors) < 50:
                        errors.append(f"Row {row_index}: Missing CNIC")
                    continue

                login = cnic

                # duplicates inside same upload
                if login in seen_logins:
                    skipped += 1
                    continue
                seen_logins.add(login)

                # duplicates already in DB
                if Users.search([("login", "=", login)], limit=1):
                    skipped += 1
                    continue

                dob_digits = self._dob_digits(row.get(dob_col))
                phone_last4 = self._last4_digits(row.get(phone_col))
                cnic_last4 = self._last4_digits(login)

                password = f"{cnic_last4}{dob_digits}{phone_last4}"

                name = ""
                if name_col:
                    name = row.get(name_col) or ""
                name = (str(name).strip() if name else "") or login

                batch.append({
                    "name": name,
                    "login": login,
                    "password": password,
                    "hrmis_role": "employee",
                })
                batch_creds.append((login, password))

                if len(batch) >= batch_size:
                    flush_batch()

            flush_batch()

            # Build downloadable CSV for ALL created credentials
            csv_buf = StringIO()
            writer = csv.writer(csv_buf)
            writer.writerow(["login", "password"])
            for lg, pw in created_creds_all:
                writer.writerow([lg, pw])

            creds_attachment = Attach.create({
                "name": "created_users_credentials.csv",
                "type": "binary",
                "datas": base64.b64encode(csv_buf.getvalue().encode("utf-8")),
                "mimetype": "text/csv",
                "res_model": "res.users",
            })

            upload_result = {
                "count": processed,
                "columns": columns,
                "top10": [],
                "created": created,
                "skipped": skipped,
                "errors": errors,
            }

            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": upload_result,
                "upload_error": None,
                "attachment_id": attachment.id,
                "creds_attachment_id": creds_attachment.id,
                "creds_preview": creds_preview,
            })

        except Exception as e:
            return request.render(self._template(), {
                "active_menu": "sanctioned_posts",
                "upload_result": None,
                "upload_error": f"Import failed: {e}",
                "attachment_id": attachment.id,
                "creds_attachment_id": None,
                "creds_preview": [],
            })

    # (optional) keep /hrmis/sanctioned_posts route if you want, but ensure template exists
    @http.route('/hrmis/sanctioned_posts', type='http', auth='user', website=True)
    def sanctioned_posts(self, **kw):
        self._ensure_admin()
        # If you don't have hr_holidays_updates.sanctioned_posts_template, you can redirect to upload:
        return request.redirect("/hrmis/sanctioned_posts/upload")
