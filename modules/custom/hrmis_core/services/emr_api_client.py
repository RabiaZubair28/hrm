import logging
import requests
import hashlib
import json

from odoo import models

from odoo.addons.hrmis_core.utils.cache_policy import (
    EMR_ENDPOINT_TTL,
    EMR_ENDPOINT_TTL_PREFIX,
    EMR_DEFAULT_TTL,
)


_logger = logging.getLogger(__name__)




class HrmisEmrApiClient(models.AbstractModel):
    _name = "hrmis.emr.api.client"
    _description = "HRMIS EMR API Client (central reusable service)"

    def _cfg(self):
        return self.env["hrmis.emr.api.config"]

    def _build_url(self, path: str) -> str:
        return f"{self._cfg().base_url()}/{(path or '').lstrip('/')}"

    def _auth_headers(self) -> dict:
        """
        For testing you can leave secret empty and this will do nothing.
        For production, you can use Bearer auth or switch to HMAC etc.
        """
        secret = self._cfg().secret_key()
        if not secret:
            return {}
        return {"Authorization": f"Bearer {secret}"}
    
    def _cache_key(self, method: str, url: str, params=None, json_body=None) -> str:
        raw = {
            "m": method.upper(),
            "u": url,
            "p": params or {},
            "b": json_body or {},
        }
        s = json.dumps(raw, sort_keys=True, ensure_ascii=False)
        return "emr:" + hashlib.sha256(s.encode("utf-8")).hexdigest()

    def _normalize_path(self, path: str) -> str:
        p = (path or "/").strip()
        if not p.startswith("/"):
            p = "/" + p
        return p

    def _smart_ttl(self, path: str) -> int:
        """
        Returns TTL in seconds based on endpoint policy.
        Exact match wins, otherwise prefix rules, otherwise default.
        """
        p = self._normalize_path(path)

        # 1) Exact match
        if p in EMR_ENDPOINT_TTL:
            return int(EMR_ENDPOINT_TTL[p])

        # 2) Prefix match (longest prefix wins)
        best = None
        for prefix, ttl in EMR_ENDPOINT_TTL_PREFIX.items():
            if p.startswith(prefix):
                if best is None or len(prefix) > len(best[0]):
                    best = (prefix, ttl)
        if best:
            return int(best[1])

        # 3) Default
        return int(EMR_DEFAULT_TTL)

    def request(
        self,
        method: str,
        path: str,
        *,
        params=None,
        json_body=None,
        data=None,
        headers=None,
        timeout=None,
        cache: bool = False,
        cache_ttl: int | None = None,
    ):
        method = method.upper()
        url = self._build_url(path)
        _timeout = timeout or self._cfg().timeout()

        cache_key = None
        if cache and method == "GET":
            raw_key = {
                "m": method,
                "u": url,
                "p": params or {},
            }
            key_string = json.dumps(raw_key, sort_keys=True, ensure_ascii=False)
            cache_key = "emr:" + hashlib.sha256(key_string.encode("utf-8")).hexdigest()

            cached_data = self.env["hrmis.redis.cache"].sudo().get_json(cache_key)
            if cached_data is not None:
                return {
                    "ok": True,
                    "status": 200,
                    "url": url,
                    "error": None,
                    "message": "cache_hit",
                    "data": cached_data,
                    "raw": None,
                    "cached": True,
                }

        req_headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        req_headers.update(self._auth_headers())
        if headers:
            req_headers.update(headers)

        try:
            resp = requests.request(
                method=method,
                url=url,
                params=params,
                json=json_body,
                data=data,
                headers=req_headers,
                timeout=_timeout,
            )
        except requests.RequestException as e:
            _logger.exception("[HRMIS EMR API] Network error %s %s: %s", method, url, e)
            return {
                "ok": False,
                "status": None,
                "url": url,
                "error": "network_error",
                "message": str(e),
                "data": None,
                "raw": None,
                "cached": False,
            }

        content_type = (resp.headers.get("Content-Type") or "").lower()

        if "application/json" in content_type:
            try:
                payload = resp.json()
            except Exception:
                payload = {"raw": resp.text}
        else:
            payload = {"raw": resp.text}

        ok = 200 <= resp.status_code < 300

        if not ok:
            _logger.warning(
                "[HRMIS EMR API] Non-2xx %s %s -> %s body=%s",
                method, url, resp.status_code,
                (resp.text[:1200] if resp.text else "")
            )

        if cache and method == "GET" and ok and resp.status_code == 200 and cache_key:
            ttl_to_use = cache_ttl if cache_ttl is not None else self._smart_ttl(path)
            self.env["hrmis.redis.cache"].sudo().set_json(cache_key, payload, ttl=ttl_to_use)

        return {
            "ok": ok,
            "status": resp.status_code,
            "url": url,
            "error": None if ok else "http_error",
            "message": None if ok else "Request failed",
            "data": payload if ok else None,
            "raw": payload if not ok else None,
            "cached": False,
        }

    def get(self, path: str, **kw):
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw):
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw):
        return self.request("PUT", path, **kw)

    def patch(self, path: str, **kw):
        return self.request("PATCH", path, **kw)

    def delete(self, path: str, **kw):
        return self.request("DELETE", path, **kw)