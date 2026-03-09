import json
from odoo import http
from odoo.http import request
import logging

_logger = logging.getLogger(__name__)

class HrmisEmrApiTestController(http.Controller):

    @http.route("/hrmis/emr_api/test", type="http", auth="user", website=True, methods=["GET", "POST"], csrf=True)
    def emr_api_test_page(self, **post):
        endpoint = (post.get("endpoint") or "/breeds").strip() or "/breeds"

        ctx = {
            "active_menu": "emr_api_test",
            "endpoint": endpoint,
            "api_result_text": None,
            "api_status": None,
            "error_msg": None,
        }

        # Only call API on POST
        if request.httprequest.method == "POST":
            try:
                res = request.env["hrmis.emr.api.client"].sudo().get(endpoint, cache=True)

                if res.get("cached"):
                    _logger.warning("DATA FROM REDIS")
                else:
                    _logger.warning("DATA FROM API")

                ctx["api_status"] = res.get("status")
                if res.get("ok"):
                    ctx["api_result_text"] = json.dumps(res.get("data"), indent=2, ensure_ascii=False)
                else:
                    # Show full response to debug
                    ctx["api_result_text"] = json.dumps(res, indent=2, ensure_ascii=False)

            except Exception as e:
                ctx["error_msg"] = str(e)

        return request.render("sanctioned_posts.emr_api_test_templates", ctx)