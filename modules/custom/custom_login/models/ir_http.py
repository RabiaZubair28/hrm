import logging

from odoo import models
from odoo.http import request
from werkzeug.exceptions import NotFound

_logger = logging.getLogger(__name__)


class IrHttp(models.AbstractModel):
    _inherit = "ir.http"

    # -------------------------
    # Helper: one place only
    # -------------------------
    @classmethod
    def _custom_404(cls, reason="unknown"):
        path = (request.httprequest.path or "")
        uid = request.session.uid
        _logger.warning("[CUSTOM 404] reason=%s path=%s uid=%s", reason, path, uid)

        # Ensure request.website exists (fallback path often doesn't have it)
        if not hasattr(request, "website"):
            try:
                website = request.env["website"].sudo().get_current_website()
                request.website = website
                _logger.warning("[CUSTOM 404] attached website id=%s", website.id)
            except Exception as e:
                _logger.warning("[CUSTOM 404] could not attach website: %r", e)

        # Try normal render
        resp = request.render("custom_login.custom_404_page")
        resp.status_code = 404
        resp.headers["Content-Type"] = "text/html; charset=utf-8"
        resp.headers["Cache-Control"] = "no-store"

        # Force non-empty body if something still goes wrong
        data = resp.get_data() or b""
        if not data:
            _logger.warning("[CUSTOM 404] EMPTY BODY from template -> forcing minimal HTML")
            resp.set_data(b"<!doctype html><html><body><h1>404</h1></body></html>")
            data = resp.get_data() or b""

        # Force Content-Length (prevents browser's own 'default 404' page behavior)
        resp.content_length = len(data)
        resp.headers["Content-Length"] = str(len(data))

        _logger.warning("[CUSTOM 404] body_len=%s", len(data))
        return resp


    @classmethod
    def _post_login_redirect(cls, uid, redirect=None):
        user = request.env["res.users"].sudo().browse(uid)

        if getattr(user, "is_temp_password", False):
            return "/force_password_reset"

        return super()._post_login_redirect(uid, redirect)

    @classmethod
    def _dispatch(cls, endpoint):
        path = (request.httprequest.path or "")
        uid = request.session.uid

        _logger.warning(
            "[DISPATCH START] path=%s uid=%s endpoint=%s",
            path, uid, getattr(endpoint, "__name__", str(endpoint)),
        )

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

        # 0) Allowlist: do not interfere with core endpoints/assets
        if path.startswith(allow_prefixes):
            _logger.warning("[ALLOWLIST PASSED] path=%s", path)
            try:
                return super()._dispatch(endpoint)
            except NotFound:
                _logger.warning("[ALLOWLIST 404 - DEFAULT USED] path=%s", path)
                return request.not_found()

        try:
            # 1) Public user: proceed normally
            if not uid:
                _logger.warning("[PUBLIC USER] path=%s", path)
                response = super()._dispatch(endpoint)

            else:
                user = request.env["res.users"].sudo().browse(uid).exists()
                _logger.warning(
                    "[LOGGED IN USER] user=%s path=%s",
                    getattr(user, "login", None),
                    path,
                )

                if not user:
                    response = super()._dispatch(endpoint)
                else:
                    # 2) Force password reset gate (global)
                    if getattr(user, "is_temp_password", False):
                        _logger.warning("[FORCE RESET REDIRECT] path=%s", path)
                        return request.redirect("/force_password_reset")

                    # 3) /odoo restriction (system admin only) except allow route
                    if path.startswith("/odoo"):
                        if path.startswith("/odoo/custom-time-off"):
                            _logger.warning("[ODOO ALLOWED ROUTE] %s", path)
                            response = super()._dispatch(endpoint)
                        elif not user.has_group("base.group_system"):
                            _logger.warning("[ODOO BLOCKED REDIRECT] %s", path)
                            return request.redirect("/odoo/custom-time-off")
                        else:
                            response = super()._dispatch(endpoint)
                    else:
                        response = super()._dispatch(endpoint)

            # 4) If response is 404, replace with custom 404
            status = getattr(response, "status_code", None)
            _logger.warning("[RESPONSE RETURNED] path=%s status=%s", path, status)

            if status == 404:
                _logger.warning("[STATUS 404 DETECTED] path=%s", path)
                return cls._custom_404(reason="response_404")

            return response

        except NotFound:
            _logger.warning("[NotFound EXCEPTION CAUGHT] path=%s", path)
            return cls._custom_404(reason="exception_notfound")

    @classmethod
    def _serve_fallback(cls):
        """
        Odoo 18: called when NO route matches (like /hrmixxcaa).
        """
        path = (request.httprequest.path or "")
        uid = request.session.uid
        _logger.warning("[SERVE_FALLBACK] path=%s uid=%s", path, uid)

        return cls._custom_404(reason="no_route")
