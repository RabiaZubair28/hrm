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

    _STATIC_TRANSFER_VACANCIES = [
        {"facility_id": 2019, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 4, "occupied_posts": 2},
        {"facility_id": 2020, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 3, "occupied_posts": 1},
        {"facility_id": 2021, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 2, "occupied_posts": 1},
        {"facility_id": 2022, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 3, "occupied_posts": 2},
        {"facility_id": 2023, "designation_name": "Cardiologist", "designation_code": "CARD", "post_bps": 18, "total_sanctioned_posts": 4, "occupied_posts": 1},
        {"facility_id": 2024, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 3, "occupied_posts": 2},
        {"facility_id": 2025, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 2, "occupied_posts": 0},
        {"facility_id": 2026, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 3, "occupied_posts": 1},
        {"facility_id": 2027, "designation_name": "Cardiologist", "designation_code": "CARD", "post_bps": 18, "total_sanctioned_posts": 4, "occupied_posts": 3},
        {"facility_id": 2028, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 2, "occupied_posts": 1},
        {"facility_id": 2029, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 5, "occupied_posts": 3},
        {"facility_id": 2030, "designation_name": "Gynecologist", "designation_code": "GYN", "post_bps": 18, "total_sanctioned_posts": 3, "occupied_posts": 2},
        {"facility_id": 2031, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 3, "occupied_posts": 1},
        {"facility_id": 2032, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 2, "occupied_posts": 1},
        {"facility_id": 2033, "designation_name": "Cardiologist", "designation_code": "CARD", "post_bps": 18, "total_sanctioned_posts": 4, "occupied_posts": 2},
        {"facility_id": 2034, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 3, "occupied_posts": 2},
        {"facility_id": 2035, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 3, "occupied_posts": 1},
        {"facility_id": 2036, "designation_name": "Staff Nurse", "designation_code": "SN", "post_bps": 16, "total_sanctioned_posts": 2, "occupied_posts": 1},
        {"facility_id": 2037, "designation_name": "Medical Officer", "designation_code": "MO", "post_bps": 17, "total_sanctioned_posts": 2, "occupied_posts": 0},
        {"facility_id": 2038, "designation_name": "Gynecologist", "designation_code": "GYN", "post_bps": 18, "total_sanctioned_posts": 2, "occupied_posts": 1},
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
        _logger.info(
            "[HRMIS][EMR] Calling API path=%s params=%s cache=%s",
            path, params, cache,
        )

        try:
            resp = env["hrmis.emr.api.client"].sudo().get(
                path,
                params=params,
                cache=cache,
            )

            _logger.info(
                "[HRMIS][EMR] Response path=%s ok=%s status=%s cached=%s",
                path,
                resp.get("ok"),
                resp.get("status"),
                resp.get("cached"),
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
                _logger.info("[HRMIS][EMR] Extracted %s rows from payload", len(rows))
                return rows
            return []

        rows = resp.get("data")
        if isinstance(rows, list):
            _logger.info("[HRMIS][EMR] Extracted %s rows from direct data", len(rows))
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

        _logger.info("[HRMIS][EMR] Meta extracted: %s", meta)
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
        }

        _logger.info(
            "[HRMIS][EMR] Normalized facility id=%s name=%s district_id=%s district_name=%s",
            normalized["id"],
            normalized["name"],
            normalized["district_id"],
            normalized["district_name"],
        )

        return normalized

    def _get_emr_districts(self, env):
        if self._use_static_emr_data():
            return self._get_static_emr_districts()

        _logger.info("[HRMIS][EMR] Fetching districts")

        resp = self._emr_get_json(env, "/districts", cache=True)

        if not resp.get("ok"):
            return [], resp.get("message") or "Failed to fetch districts from EMR."

        rows = self._extract_api_rows(resp)
        districts = [self._normalize_district_row(r) for r in rows]

        _logger.info("[HRMIS][EMR] District fetch complete. count=%s", len(districts))
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

        _logger.info(
            "[HRMIS][EMR] Fetching facilities by district district_id=%s page=%s limit=%s",
            district_id, page, limit,
        )

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

        _logger.info(
            "[HRMIS][EMR] Filtered facilities for district_id=%s count=%s",
            district_id,
            len(filtered),
        )
        return filtered

    def _get_static_transfer_rows(self):
        districts, _ = self._get_static_emr_districts()
        facilities, _meta, _ = self._get_static_emr_facilities(
            district_id=None,
            page=1,
            limit=2500,
        )

        district_map = {
            int(d.get("id") or 0): d for d in (districts or []) if int(d.get("id") or 0)
        }
        facility_map = {
            int(f.get("id") or 0): f for f in (facilities or []) if int(f.get("id") or 0)
        }

        rows = []
        for row in self._STATIC_TRANSFER_VACANCIES or []:
            facility_id = int(row.get("facility_id") or 0)
            facility = facility_map.get(facility_id)
            if not facility:
                continue

            district = district_map.get(int(facility.get("district_id") or 0), {})
            rows.append(
                {
                    "facility_id": facility_id,
                    "facility_name": facility.get("name") or "",
                    "facility_code": facility.get("code") or "",
                    "district_id": district.get("id") or facility.get("district_id") or 0,
                    "district_name": district.get("name") or facility.get("district_name") or "",
                    "designation_name": row.get("designation_name") or "",
                    "designation_code": row.get("designation_code") or "",
                    "post_bps": int(row.get("post_bps") or 0),
                    "total_sanctioned_posts": int(row.get("total_sanctioned_posts") or 0),
                    "occupied_posts": int(row.get("occupied_posts") or 0),
                }
            )
        return rows

    def _transfer_row_matches_employee(self, employee, row):
        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = int(getattr(employee, "hrmis_bps", 0) or 0)
        if not emp_desig or not emp_bps:
            return False

        row_bps = int(row.get("post_bps") or 0)
        if row_bps and row_bps != emp_bps:
            return False

        emp_code_raw = (getattr(emp_desig, "code", "") or "").strip()
        emp_code = emp_code_raw.lower()
        emp_name = (getattr(emp_desig, "name", "") or "").strip().lower()
        row_code = (row.get("designation_code") or "").strip().lower()
        row_name = (row.get("designation_name") or "").strip().lower()
        bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

        if emp_code and emp_code not in bad_codes and row_code and row_code not in bad_codes:
            return row_code == emp_code or row_name == emp_name
        return bool(row_name and row_name == emp_name)

    def _get_transfer_static_hcu(self, env):
        return env["hrmis.healthcare.unit"].sudo().browse(1).exists()

    def _get_or_create_transfer_static_district(self, env, row):
        row = row or {}
        name = (row.get("district_name") or row.get("name") or "").strip()
        if not name:
            return env["hrmis.district.master"].browse()

        District = env["hrmis.district.master"].sudo()
        district = District.search([("name", "=", name)], limit=1)
        if district:
            return district

        return District.create(
            {
                "name": name,
                "code": f"TMP-{int(row.get('district_id') or row.get('id') or 0)}",
                "active": True,
            }
        )

    def _get_or_create_transfer_static_facility(self, env, row, district):
        row = row or {}
        name = (row.get("facility_name") or row.get("name") or "").strip()
        code = (row.get("facility_code") or row.get("code") or "").strip() or f"TMP-{int(row.get('facility_id') or row.get('id') or 0)}"
        if not name or not district:
            return env["hrmis.facility.type"].browse()

        Facility = env["hrmis.facility.type"].sudo()
        facility = Facility.search(
            [("name", "=", name), ("district_id", "=", district.id)],
            limit=1,
        )
        if not facility and code:
            facility = Facility.search([("facility_code", "=", code)], limit=1)
        if facility:
            return facility

        hcu = self._get_transfer_static_hcu(env)
        if not hcu:
            return env["hrmis.facility.type"].browse()

        return Facility.create(
            {
                "name": name,
                "district_id": district.id,
                "description": "Temporary facility created from static transfer API data.",
                "capacity": 0,
                "facility_code": code,
                "category": "hospital",
                "hcu_id": hcu.id,
                "active": True,
                "is_temp": True,
            }
        )

    def _get_or_create_transfer_static_designation(self, env, employee, facility, row):
        if not employee or not facility:
            return env["hrmis.designation"].browse()

        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = int(getattr(employee, "hrmis_bps", 0) or 0)
        if not emp_desig or not emp_bps:
            return env["hrmis.designation"].browse()

        Designation = env["hrmis.designation"].sudo()
        emp_code_raw = (getattr(emp_desig, "code", "") or "").strip()
        emp_code = emp_code_raw.lower()
        emp_name = (getattr(emp_desig, "name", "") or "").strip()
        bad_codes = {"", "nan", "none", "null", "n/a", "na", "-"}

        dom = [("facility_id", "=", facility.id), ("active", "=", True), ("post_BPS", "=", emp_bps)]
        designation = env["hrmis.designation"].browse()
        if emp_code and emp_code not in bad_codes:
            designation = Designation.search(dom + [("code", "=ilike", emp_code_raw)], limit=1)
        if not designation:
            designation = Designation.search(dom + [("name", "=ilike", emp_name)], limit=1)
        if designation:
            return designation

        return Designation.create(
            {
                "name": row.get("designation_name") or emp_name or "Temporary Designation",
                "code": row.get("designation_code") or emp_code_raw or False,
                "designation_group_id": getattr(getattr(emp_desig, "designation_group_id", False), "id", False) or False,
                "total_sanctioned_posts": max(int(row.get("total_sanctioned_posts") or 0), 1),
                "post_BPS": max(emp_bps, 1),
                "facility_id": facility.id,
                "active": True,
                "is_temp": True,
            }
        )

    def _ensure_transfer_static_allocation(self, env, facility, designation, row):
        if not facility or not designation:
            return env["hrmis.facility.designation"].browse()

        Allocation = env["hrmis.facility.designation"].sudo()
        allocation = Allocation.search(
            [("facility_id", "=", facility.id), ("designation_id", "=", designation.id)],
            limit=1,
        )
        if allocation:
            return allocation

        return Allocation.create(
            {
                "facility_id": facility.id,
                "designation_id": designation.id,
                "occupied_posts": max(int(row.get("occupied_posts") or 0), 0),
            }
        )

    def _get_static_transfer_destinations_payload(self, env, employee):
        emp_desig = getattr(employee, "hrmis_designation", False)
        emp_bps = int(getattr(employee, "hrmis_bps", 0) or 0)
        if not emp_desig or not emp_bps:
            return {
                "ok": True,
                "employee_designation": getattr(emp_desig, "name", "") if emp_desig else "",
                "employee_bps": emp_bps,
                "districts": [],
                "facilities": [],
            }

        current_fac = getattr(employee, "facility_id", False) or getattr(employee, "hrmis_facility_id", False)
        current_fac_name = (getattr(current_fac, "name", "") or "").strip().lower()
        current_dist_name = (
            (getattr(getattr(current_fac, "district_id", False), "name", "") or "").strip().lower()
            if current_fac
            else ""
        )

        districts_payload = []
        facilities_payload = []
        seen_district_ids = set()
        seen_facility_ids = set()

        for row in self._get_static_transfer_rows():
            if not self._transfer_row_matches_employee(employee, row):
                continue

            if current_fac_name and current_fac_name == (row.get("facility_name") or "").strip().lower() and \
               current_dist_name == (row.get("district_name") or "").strip().lower():
                continue

            district = self._get_or_create_transfer_static_district(env, row)
            facility = self._get_or_create_transfer_static_facility(env, row, district)
            designation = self._get_or_create_transfer_static_designation(env, employee, facility, row)
            allocation = self._ensure_transfer_static_allocation(env, facility, designation, row)

            if not district or not facility or not designation:
                continue
            if facility.id in seen_facility_ids:
                continue

            seen_facility_ids.add(facility.id)
            if district.id not in seen_district_ids:
                seen_district_ids.add(district.id)
                districts_payload.append({"id": district.id, "name": district.name})

            total = int(row.get("total_sanctioned_posts") or getattr(designation, "total_sanctioned_posts", 0) or 0)
            occupied = int(getattr(allocation, "occupied_posts", 0) or row.get("occupied_posts") or 0)
            vacant = max(total - occupied, 0)

            facilities_payload.append(
                {
                    "id": facility.id,
                    "name": facility.name,
                    "district_id": district.id,
                    "designation_id": designation.id,
                    "designation_name": designation.name,
                    "designation_code": designation.code or row.get("designation_code") or "",
                    "post_bps": emp_bps,
                    "total": total,
                    "occupied": occupied,
                    "vacant": vacant,
                }
            )

        districts_payload.sort(key=lambda x: x.get("name") or "")
        facilities_payload.sort(key=lambda x: (x.get("district_id") or 0, x.get("name") or ""))

        return {
            "ok": True,
            "employee_designation": emp_desig.name,
            "employee_bps": emp_bps,
            "districts": districts_payload,
            "facilities": facilities_payload,
        }