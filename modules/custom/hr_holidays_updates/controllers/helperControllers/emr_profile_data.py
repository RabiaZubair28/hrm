# -*- coding: utf-8 -*-
import logging

_logger = logging.getLogger(__name__)


class EmrProfileDataMixin:
    """
    EMR-backed helper mixin for profile form data.

    Important:
    - Rest of app should only use normalized rows
    - Endpoint choice stays hidden inside helper
    - When API changes later, only _get_all_emr_facilities() / _get_emr_facilities()
      should need adjustment
    """
    # =========================================================
    # TEMP STATIC FALLBACK
    # Set to False when EMR APIs are back
    # =========================================================
    _USE_EMR_STATIC_FALLBACK = False

    _STATIC_DISTRICTS = [
        {"id": 1, "name": "Karachi"},
        {"id": 2, "name": "Hyderabad"},
        {"id": 3, "name": "Sukkur"},
        {"id": 4, "name": "Larkana"},
        {"id": 5, "name": "Mirpurkhas"},
        {"id": 6, "name": "Shaheed Benazirabad"},
        {"id": 7, "name": "Khairpur"},
        {"id": 8, "name": "Ghotki"},
        {"id": 9, "name": "Badin"},
        {"id": 10, "name": "Tharparkar"},
    ]

    _STATIC_FACILITIES = [
        {
            "id": 2019,
            "name": "Jinnah Postgraduate Medical Centre",
            "code": "JPMC",
            "district": {"id": 1, "name": "Karachi"},
        },
        {
            "id": 2020,
            "name": "Civil Hospital Karachi",
            "code": "CHK",
            "district": {"id": 1, "name": "Karachi"},
        },
        {
            "id": 2021,
            "name": "Abbasi Shaheed Hospital",
            "code": "ASH",
            "district": {"id": 1, "name": "Karachi"},
        },
        {
            "id": 2022,
            "name": "Sindh Government Hospital Liaquatabad",
            "code": "SGHL",
            "district": {"id": 1, "name": "Karachi"},
        },
        {
            "id": 2023,
            "name": "Liaquat University Hospital",
            "code": "LUH",
            "district": {"id": 2, "name": "Hyderabad"},
        },
        {
            "id": 2024,
            "name": "Civil Hospital Hyderabad",
            "code": "CHY",
            "district": {"id": 2, "name": "Hyderabad"},
        },
        {
            "id": 2025,
            "name": "Taluka Hospital Latifabad",
            "code": "THL",
            "district": {"id": 2, "name": "Hyderabad"},
        },
        {
            "id": 2026,
            "name": "Sukkur Civil Hospital",
            "code": "SCH",
            "district": {"id": 3, "name": "Sukkur"},
        },
        {
            "id": 2027,
            "name": "Ghulam Muhammad Mahar Medical Hospital",
            "code": "GMMMH",
            "district": {"id": 3, "name": "Sukkur"},
        },
        {
            "id": 2028,
            "name": "Taluka Hospital Rohri",
            "code": "THR",
            "district": {"id": 3, "name": "Sukkur"},
        },
        {
            "id": 2029,
            "name": "Chandka Medical College Hospital",
            "code": "CMCH",
            "district": {"id": 4, "name": "Larkana"},
        },
        {
            "id": 2030,
            "name": "District Headquarters Hospital Larkana",
            "code": "DHHL",
            "district": {"id": 4, "name": "Larkana"},
        },
        {
            "id": 2031,
            "name": "Civil Hospital Mirpurkhas",
            "code": "CHM",
            "district": {"id": 5, "name": "Mirpurkhas"},
        },
        {
            "id": 2032,
            "name": "Taluka Hospital Digri",
            "code": "THD",
            "district": {"id": 5, "name": "Mirpurkhas"},
        },
        {
            "id": 2033,
            "name": "Peoples Medical University Hospital",
            "code": "PMUH",
            "district": {"id": 6, "name": "Shaheed Benazirabad"},
        },
        {
            "id": 2034,
            "name": "Civil Hospital Nawabshah",
            "code": "CHN",
            "district": {"id": 6, "name": "Shaheed Benazirabad"},
        },
        {
            "id": 2035,
            "name": "Civil Hospital Khairpur",
            "code": "CHKP",
            "district": {"id": 7, "name": "Khairpur"},
        },
        {
            "id": 2036,
            "name": "District Headquarters Hospital Ghotki",
            "code": "DHHG",
            "district": {"id": 8, "name": "Ghotki"},
        },
        {
            "id": 2037,
            "name": "Civil Hospital Badin",
            "code": "CHB",
            "district": {"id": 9, "name": "Badin"},
        },
        {
            "id": 2038,
            "name": "District Headquarters Hospital Mithi",
            "code": "DHHM",
            "district": {"id": 10, "name": "Tharparkar"},
        },
    ]

    def _use_static_emr_data(self):
        return bool(getattr(self, "_USE_EMR_STATIC_FALLBACK", False))

    def _get_static_emr_districts(self):
        _logger.warning("[HRMIS][EMR] Using STATIC district fallback data")
        districts = [self._normalize_district_row(r) for r in (self._STATIC_DISTRICTS or [])]
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
                    msg = "This server is not authorized to access the EMR service. Please contact IT support or the system administrator."

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

        normalized = {
            "id": row.get("id"),
            "name": row.get("name") or "",
            "code": row.get("code") or "",
            "district_id": district_id,
            "district_name": district_name,
            "facility_type": row.get("facility_type") or "",
            "level_of_care": row.get("level_of_care") or "",
        }

        return normalized


    def _get_emr_districts(self, env):
        if self._use_static_emr_data():
            return self._get_static_emr_districts()


        resp = self._emr_get_json(env, "/districts", cache=True)

        if not resp.get("ok"):
            return [], resp.get("message") or "Failed to fetch districts from EMR."

        rows = self._extract_api_rows(resp)
        districts = [self._normalize_district_row(r) for r in rows]
        return districts, None

    def _get_emr_facilities(self, env, *, district_id=None, page=1, limit=2500):
        """
        Preferred district-specific fetch.

        Returns:
            (facilities, meta, error_message)
        """
        if self._use_static_emr_data():
            return self._get_static_emr_facilities(
                district_id=district_id,
                page=page,
                limit=limit,
            )

        empty_meta = {
            "page": 1,
            "limit": limit,
            "count": 0,
            "lastPage": 1,
        }

        if not district_id:
            _logger.warning("[HRMIS][EMR] No district_id provided for district-specific facilities fetch")
            return [], empty_meta, "No district selected for facility fetch."

        resp = self._emr_get_json(
            env,
            f"/facilities",
            params={"page": page, "limit": limit},
            cache=True,
        )

        if not resp.get("ok"):
            return [], empty_meta, resp.get("message") or "Failed to fetch facilities from EMR."

        rows = self._extract_api_rows(resp)
        meta = self._extract_api_meta(resp)
        facilities = [self._normalize_facility_row(r) for r in rows]

        return facilities, meta, None

    def _get_all_emr_facilities(self, env, *, page=1, limit=2500):
        """
        Temporary fallback implementation.
        """
        if self._use_static_emr_data():
            return self._get_static_emr_facilities(
                district_id=None,
                page=page,
                limit=limit,
            )

        fallback_district_id = 1

        _logger.warning(
            "[HRMIS][EMR] _get_all_emr_facilities is temporarily using fallback district endpoint district_id=%s",
            fallback_district_id,
        )

        return self._get_emr_facilities(
            env,
            district_id=fallback_district_id,
            page=page,
            limit=limit,
        )

    def _filter_facilities_by_district(self, facilities, district_id=None):
        if not district_id:
            return []

        try:
            district_id = int(district_id)
        except Exception:
            _logger.warning("[HRMIS][EMR] Invalid district_id for filtering: %s", district_id)
            return []

        filtered = [f for f in (facilities or []) if f.get("district_id") == district_id]

        return filtered