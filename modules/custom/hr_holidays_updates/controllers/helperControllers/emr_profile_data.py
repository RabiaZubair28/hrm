# -*- coding: utf-8 -*-
import logging
import os

from odoo.addons.hrmis_core.constants.emr_districts import STATIC_DISTRICTS
from odoo.addons.hrmis_core.constants.emr_facilities import STATIC_FACILITIES

_logger = logging.getLogger(__name__)


class EmrProfileDataMixin:
    """
    EMR-backed helper mixin for profile form data.

    Behavior:
    - APP_ENV=local -> use static fallback data
    - APP_ENV anything else (or empty/missing) -> use EMR API
    """

    _STATIC_DISTRICTS = STATIC_DISTRICTS
    _STATIC_FACILITIES = STATIC_FACILITIES

    def _get_app_env(self):
        return (os.getenv("APP_ENV") or "").strip().lower()

    def _use_static_emr_data(self, env=None):
        app_env = self._get_app_env()
        use_static = app_env == "local"

        _logger.warning(
            "[HRMIS][EMR] APP_ENV=%s use_static=%s",
            app_env or "<empty>",
            use_static,
        )
        return use_static

    def _get_static_emr_districts(self):
        _logger.warning("[HRMIS][EMR] Using STATIC district fallback data")
        districts = [
            self._normalize_district_row(r)
            for r in (self._STATIC_DISTRICTS or [])
        ]
        return districts, None

    def _get_static_emr_facilities(self, district_id=None, page=1, limit=2500):
        _logger.warning(
            "[HRMIS][EMR] Using STATIC facility fallback data district_id=%s page=%s limit=%s",
            district_id, page, limit,
        )

        rows = list(self._STATIC_FACILITIES or [])

        if district_id:
            try:
                district_id = int(district_id)
                rows = [
                    r for r in rows
                    if ((r.get("district") or {}).get("id") == district_id)
                    or (r.get("district_id") == district_id)
                ]
            except Exception:
                rows = []

        facilities = [self._normalize_facility_row(r) for r in rows]

        meta = {
            "page": page,
            "limit": limit,
            "count": len(facilities),
            "lastPage": 1,
        }
        return facilities, meta, None

    def _emr_get_json(self, env, path, *, params=None, cache=True):
        try:
            resp = env["hrmis.emr.api.client"].sudo().get(
                path,
                params=params,
                cache=cache,
            )

            if not resp.get("ok"):
                msg = resp.get("message") or "EMR request failed."

                if "not allowed for this client" in msg.lower():
                    msg = (
                        "This server is not authorized to access the EMR service. "
                        "Please contact IT support or the system administrator."
                    )

                _logger.error("[HRMIS][EMR] API ERROR path=%s message=%s", path, msg)

                return {
                    "ok": False,
                    "error": resp.get("error"),
                    "status": resp.get("status"),
                    "message": msg,
                    "data": {"data": []},
                    "meta": {},
                }

            return resp

        except Exception as e:
            _logger.exception(
                "[HRMIS][EMR] Failed GET %s params=%s error=%s",
                path, params, e,
            )

            return {
                "ok": False,
                "status": None,
                "error": "client_error",
                "message": str(e),
                "data": {"data": []},
                "meta": {},
            }

    def _extract_api_rows(self, resp):
        if not resp or not isinstance(resp, dict):
            _logger.warning("[HRMIS][EMR] Invalid response structure: %s", resp)
            return []

        payload = resp.get("data")

        if isinstance(payload, dict):
            rows = payload.get("data")
            if isinstance(rows, list):
                return rows
            return []

        rows = resp.get("data")
        if isinstance(rows, list):
            return rows

        return []

    def _extract_api_meta(self, resp):
        meta = {
            "page": 1,
            "limit": 0,
            "count": 0,
            "lastPage": 1,
        }

        if not resp or not isinstance(resp, dict):
            return meta

        payload = resp.get("data")
        if not isinstance(payload, dict):
            return meta

        for key in ("page", "limit", "count", "lastPage"):
            if key in payload:
                meta[key] = payload.get(key)

        return meta

    def _normalize_district_row(self, row):
        row = row or {}
        return {
            "id": row.get("id"),
            "name": row.get("name") or "",
        }

    def _normalize_facility_row(self, row):
        row = row or {}

        district_obj = row.get("district") or {}

        district_id = (
            district_obj.get("id")
            or row.get("district_id")
            or row.get("districtId")
            or row.get("districtID")
        )

        district_name = (
            district_obj.get("name")
            or row.get("district_name")
            or row.get("districtName")
            or ""
        )

        return {
            "id": row.get("id"),
            "name": row.get("name") or "",
            "code": row.get("code") or "",
            "district_id": district_id,
            "district_name": district_name,
            "facility_type": row.get("facility_type") or "",
            "level_of_care": row.get("level_of_care") or "",
        }

    def _get_emr_districts(self, env):
        if self._use_static_emr_data(env):
            return self._get_static_emr_districts()

        resp = self._emr_get_json(env, "/districts", cache=True)

        if not resp.get("ok"):
            return [], resp.get("message") or "Failed to fetch districts from EMR."

        rows = self._extract_api_rows(resp)
        districts = [self._normalize_district_row(r) for r in rows]
        return districts, None

    def _get_emr_facilities(self, env, *, district_id=None, page=1, limit=2500):
        if self._use_static_emr_data(env):
            return self._get_static_emr_facilities(
                district_id=district_id,
                page=page,
                limit=limit,
            )

        resp = self._emr_get_json(
            env,
            "/facilities",
            params={"page": page, "limit": limit},
            cache=True,
        )

        empty_meta = {
            "page": page,
            "limit": limit,
            "count": 0,
            "lastPage": 1,
        }

        if not resp.get("ok"):
            return [], empty_meta, resp.get("message") or "Failed to fetch facilities from EMR."

        rows = self._extract_api_rows(resp)
        meta = self._extract_api_meta(resp)
        facilities = [self._normalize_facility_row(r) for r in rows]

        if district_id:
            facilities = self._filter_facilities_by_district(
                facilities,
                district_id=district_id,
            )
            meta["count"] = len(facilities)

        return facilities, meta, None

    def _get_all_emr_facilities(self, env, *, page=1, limit=2500):
        if self._use_static_emr_data(env):
            return self._get_static_emr_facilities(
                district_id=None,
                page=page,
                limit=limit,
            )

        resp = self._emr_get_json(
            env,
            "/facilities",
            params={"page": page, "limit": limit},
            cache=True,
        )

        empty_meta = {
            "page": page,
            "limit": limit,
            "count": 0,
            "lastPage": 1,
        }

        if not resp.get("ok"):
            return [], empty_meta, resp.get("message") or "Failed to fetch facilities from EMR."

        rows = self._extract_api_rows(resp)
        meta = self._extract_api_meta(resp)
        facilities = [self._normalize_facility_row(r) for r in rows]

        return facilities, meta, None

    def _filter_facilities_by_district(self, facilities, district_id=None):
        if not district_id:
            return []

        try:
            district_id = int(district_id)
        except Exception:
            _logger.warning("[HRMIS][EMR] Invalid district_id for filtering: %s", district_id)
            return []

        return [
            f for f in (facilities or [])
            if f.get("district_id") == district_id
        ]