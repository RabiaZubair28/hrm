import base64
from io import BytesIO
from odoo import models, fields, api
import qrcode


class TransferNotification(models.Model):
    _name = "transfer.notification"
    _description = "Transfer Notification"

    name = fields.Char(string="Notification No", required=True, default="New")
    category = fields.Selection([("transfer", "Transfer")], default="transfer")

    employee_id = fields.Many2one("hr.employee", string="Officer")
    hrmis_employee_id = fields.Char(string="Employee ID")
    hrmis_cnic = fields.Char(string="CNIC")
    hrmis_father_name = fields.Char(string="Father Name")
    hrmis_joining_date = fields.Date(string="Joining Date")
    hrmis_cadre = fields.Char(string="Cadre")
    hrmis_designation = fields.Char(string="Designation")
    hrmis_bps = fields.Char(string="BPS")

    district_from_id = fields.Many2one("hrmis.district.master", string="From District")
    district_to_id   = fields.Many2one("hrmis.district.master", string="To District")

    facility_from_id = fields.Many2one("hrmis.facility.type", string="From Facility")
    facility_to_id   = fields.Many2one("hrmis.facility.type", string="To Facility")

    issue_date = fields.Date(string="Issue Date", default=fields.Date.today)

    transfer_id = fields.Many2one("hrmis.transfer.request", string="Related Transfer")
    is_downloaded = fields.Boolean(default=False)
    issued_by = fields.Char(string="Issued By", default="SECRETARY HEALTH")
    employee_so = fields.Many2one('hr.employee', related='employee_id.parent_id', string='Section Officer')
    so_signature = fields.Binary(related='employee_so.so_signature', readonly=True)
    # so_signature = fields.Binary(related="employee_id.parent_id.so_signature", readonly=True)

    # ---------------------------------------------------------
    # CREATE NOTIFICATION
    # ---------------------------------------------------------

    @api.model
    def create_notification(self, transfer):
        notif_seq = self.env["ir.sequence"].next_by_code("transfer.notification") or "New"
        emp = transfer.employee_id.sudo()

        return self.sudo().create({
            "name": notif_seq,
            "category": "transfer",
            "employee_id": emp.id,
            "hrmis_employee_id": emp.hrmis_employee_id,
            "hrmis_cnic": emp.cnic,
            "hrmis_father_name": emp.hrmis_father_name,
            "hrmis_joining_date": emp.hrmis_joining_date,
            "hrmis_cadre": emp.cadre_id.name if emp.cadre_id else "",
            "hrmis_designation": emp.hrmis_designation,
            "hrmis_bps": emp.hrmis_bps,

            # ✅ FIXED FIELD NAMES
            "district_from_id": transfer.current_district_id.id if transfer.current_district_id else False,
            "district_to_id": transfer.required_district_id.id if transfer.required_district_id else False,

            "facility_from_id": transfer.current_facility_id.id if transfer.current_facility_id else False,
            "facility_to_id": transfer.required_facility_id.id if transfer.required_facility_id else False,

            "issue_date": fields.Date.today(),
            "transfer_id": transfer.id,
        })

    # ---------------------------------------------------------
    # QR
    # ---------------------------------------------------------

    def get_notification_qr_b64(self):
        self.ensure_one()
        base_url = self.env["ir.config_parameter"].sudo().get_param("web.base.url")
        # url = f"{base_url}/report/pdf/hrmis_transfer.transfer_notification_pdf/{self.id}"
        url = f"{base_url}/report/pdf/leave_letter.transfer_notification_pdf/{self.id}"

        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=6,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)

        img = qr.make_image(fill_color="black", back_color="white")
        buf = BytesIO()
        img.save(buf, format="PNG")

        return base64.b64encode(buf.getvalue()).decode()

    # ---------------------------------------------------------
    # PDF ACTION
    # ---------------------------------------------------------

    def action_download_pdf(self):
        self.ensure_one()
        return self.env.ref("hrmis_transfer.action_transfer_notification_pdf").report_action(self)
