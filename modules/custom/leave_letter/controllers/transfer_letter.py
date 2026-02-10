from odoo import http
from odoo.http import request


class LeaveNotificationController(http.Controller):

    @http.route(
        '/transfer_letter/pdf/<int:notification_id>',
        type='http',
        auth='user',
        website=True,
        csrf=False
    )
    def download_transfer_notification(self, notification_id, **kw):
        record = request.env['transfer.notification'].sudo().browse(notification_id)
        notif = request.env['transfer.notification'].sudo().browse(notification_id)

        if notif and not notif.is_downloaded:
            notif.is_downloaded = True
        
        if not record.exists():
            return request.not_found()

        pdf, _ = request.env['ir.actions.report'].sudo()._render_qweb_pdf(
            'leave_letter.transfer_notification_pdf',
            [record.id]
        )

        headers = [
            ('Content-Type', 'application/pdf'),
            ('Content-Disposition', f'attachment; filename="Transfer_Notification_{record.id}.pdf"')
        ]

        return request.make_response(pdf, headers=headers)
