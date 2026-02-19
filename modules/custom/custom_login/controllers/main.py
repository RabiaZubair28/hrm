
from odoo import http
from odoo.http import request
from odoo.addons.web.controllers.home import Home
from odoo.addons.website.controllers.main import Website
import logging


_logger = logging.getLogger(__name__)

class CustomLogin(Home):

    @http.route('/web/login', type='http', auth='public', website=True, csrf=False, sitemap=False)
    def web_login(self, redirect=None, **kw):

        # If already logged in
        if request.session.uid:
            user = request.env.user
            if getattr(user, 'is_temp_password', False):
                return request.redirect('/force_password_reset')
            return request.redirect('/odoo/custom-time-off')

        # POST → let Odoo authenticate
        if request.httprequest.method == 'POST':
            response = super().web_login(redirect=redirect, **kw)

            # Login successful
            if request.session.uid:
                user = request.env.user
                if getattr(user, 'is_temp_password', False):
                    return request.redirect('/force_password_reset')
                return request.redirect('/odoo/custom-time-off')

            # Login failed → render custom login page
            return request.render(
                'custom_login.custom_login_template',
                {
                    'redirect': redirect,
                    'error': 'Invalid login or password.',
                    'login': kw.get('login', ''),
                }
            )

        # GET → render custom login page
        return request.render(
            'custom_login.custom_login_template',
            {'redirect': redirect}
        )


class ForcePasswordController(http.Controller):

    @http.route('/force_password_reset', type='http', auth='user', website=True)
    def force_password_reset(self, **kw):
        return request.render('custom_login.reset_password')

    @http.route(
        "/force_password_reset/submit",
        type="http",
        auth="user",
        methods=["POST"],
        website=True,
        csrf=True,
    )
    def force_password_reset_submit(self, **post):
        user = request.env.user

        current_password = (post.get("current_password") or "").strip()
        new_password = (post.get("new_password") or "").strip()
        confirm_password = (post.get("confirm_password") or "").strip()

        def _render_error(msg):
            return request.render("custom_login.reset_password", {"error": msg})

        if not current_password or not new_password or not confirm_password:
            return _render_error("All fields are required.")

        if new_password != confirm_password:
            return _render_error("New passwords do not match.")

        try:
            user.sudo()._check_credentials(
                {"type": "password", "password": current_password},
                request.env,
            )
        except Exception:
            return _render_error("Current password is incorrect.")

        user.sudo().write({
            "password": new_password,
            "is_temp_password": False,
        })

        return request.redirect("/odoo/custom-time-off")



class Custom404Controller(http.Controller):

    @http.route('/404', type='http', auth='public', website=True)
    def custom_404(self, **kw):
        resp = request.render("custom_login.custom_404_page")
        resp.status_code = 404
        return resp
    
class Website404Override(Website):

    def _handle_exception(self, exception):
        response = super()._handle_exception(exception)

        status = getattr(response, "status_code", None)
        _logger.warning("[404 OVERRIDE] path=%s status=%s exc=%s",
                        request.httprequest.path, status, repr(exception))

        if status == 404:
            # Render your qweb and set status properly
            resp = request.render("custom_login.custom_404_page")
            resp.status_code = 404
            return resp

        return response