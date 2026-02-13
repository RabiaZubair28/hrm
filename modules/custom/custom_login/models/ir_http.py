from odoo import models
from odoo.http import request

class IrHttp(models.AbstractModel):
    _inherit = 'ir.http'

    @classmethod
    def _post_login_redirect(cls, uid, redirect=None):
        user = request.env['res.users'].sudo().browse(uid)

        # If login succeeded AND temp password is set
        if user.is_temp_password:
            return '/force_password_reset'

        return super()._post_login_redirect(uid, redirect)
    
    @classmethod
    @classmethod
    def _dispatch(cls, endpoint):
        path = (request.httprequest.path or "")

        # -------------------------
        # 0) Allowlist (always allow)
        # -------------------------
        # - reset endpoints + login/logout + assets must never be blocked
        allow_prefixes = (
            "/web/login",
            "/web/session/logout",
            "/web/static/",
            "/web/assets/",
            "/web/content/",
            "/web/image/",
            "/web/binary/",
            "/web/service-worker.js",
            "/force_password_reset",
            "/force_password_reset/submit",
        )

        if path.startswith(allow_prefixes):
            return super()._dispatch(endpoint)

        # -------------------------
        # 1) If not logged in, proceed normally
        # -------------------------
        uid = request.session.uid
        if not uid:
            return super()._dispatch(endpoint)

        user = request.env["res.users"].sudo().browse(uid).exists()
        if not user:
            return super()._dispatch(endpoint)

        # -------------------------
        # 2) Force password reset gate (global)
        # -------------------------
        # If user has temp password flag -> redirect anywhere to reset page
        # (Except allowlist above)
        if getattr(user, "is_temp_password", False):
            # optional logs:
            # _logger.info("User %s forced to reset password. path=%s", user.login, path)
            return request.redirect("/force_password_reset")

        # -------------------------
        # 3) Your existing /odoo restriction (system admin only)
        # -------------------------
        if path.startswith("/odoo"):

            # ✅ Allow specific routes
            if path.startswith("/odoo/custom-time-off"):
                return super()._dispatch(endpoint)

            # 🔐 Only system admin can access /odoo*
            if not user.has_group("base.group_system"):
                return request.redirect("/odoo/custom-time-off")

        return super()._dispatch(endpoint)

