from odoo import http
from odoo.http import request


class HrmisNotificationsController(http.Controller):

    # ---------------------------------------------------------
    # NOTIFICATIONS PAGE
    # ---------------------------------------------------------
    @http.route("/hrmis/notifications/public", type="http", auth="user", website=True)
    def hrmis_notifications(self, **kw):

        notifications = request.env["transfer.notification"].sudo().search(
            [],
            order="issue_date desc, id desc",
            limit=100,
        )

        return request.render(
            "leave_letter.hrmis_notifications_page",
            {
                "notifications": notifications,
                "active_menu": "notifications",
            },
        )

    # ---------------------------------------------------------
    # DOWNLOAD PDF
    # ---------------------------------------------------------
    @http.route(
        "/transfer_letter/pdf/<int:notification_id>",
        type="http",
        auth="user",
        website=True,
        csrf=False,
    )
    def download_transfer_notification(self, notification_id, **kw):

        notif = request.env["transfer.notification"].sudo().browse(notification_id)

        if not notif.exists():
            return request.not_found()

        if not notif.is_downloaded:
            notif.is_downloaded = True

        pdf, _ = request.env["ir.actions.report"].sudo()._render_qweb_pdf(
            "leave_letter.transfer_notification_pdf",
            [notif.id],
        )

        headers = [
            ("Content-Type", "application/pdf"),
            (
                "Content-Disposition",
                f'attachment; filename="Transfer_Notification_{notif.name}.pdf"',
            ),
        ]

        return request.make_response(pdf, headers=headers)
