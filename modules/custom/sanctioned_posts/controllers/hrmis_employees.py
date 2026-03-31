# -*- coding: utf-8 -*-
import math

from odoo import http
from odoo.http import request
from odoo.osv import expression
from werkzeug.exceptions import Forbidden


class HrmisEmployeesController(http.Controller):
    PAGE_SIZE = 15

    def _ensure_admin(self):
        user = request.env.user
        if not user or not user.has_group('base.group_system'):
            raise Forbidden()

    def _safe_int(self, value, default=0):
        try:
            return int(value)
        except Exception:
            return default

    def _selection_label_map(self, model, field_name):
        field = model._fields.get(field_name)
        if not field or not getattr(field, "selection", None):
            return {}
        selection = field.selection
        if callable(selection):
            selection = selection(model.env)
        return dict(selection or [])

    def _load_district_map(self):
        district_map = {}
        try:
            from odoo.addons.hrmis_core.constants.emr_districts import STATIC_DISTRICTS
            for d in STATIC_DISTRICTS or []:
                district_map[int(d.get("id"))] = d.get("name") or f"District #{d.get('id')}"
        except Exception:
            pass
        return district_map

    def _load_facility_map(self):
        facility_map = {}
        try:
            from odoo.addons.hrmis_core.constants.emr_facilities import STATIC_FACILITIES
            for f in STATIC_FACILITIES or []:
                facility_map[int(f.get("id"))] = f.get("name") or f"Facility #{f.get('id')}"
        except Exception:
            pass
        return facility_map

    def _build_search_domain(self, q):
        if not q:
            return []

        q = q.strip()
        return expression.OR([
            [('hrmis_merit_number', 'ilike', q)],
            [('hrmis_cnic', 'ilike', q)],
            [('hrmis_pmdc_no', 'ilike', q)],
            [('hrmis_contact_info', 'ilike', q)],
            [('hrmis_domicile', 'ilike', q)],
            [('employee_id.name', 'ilike', q)],
            [('user_id.login', 'ilike', q)],
            [('facility_other_name', 'ilike', q)],
        ])

    @http.route(['/hrmis/employees'], type='http', auth='user', website=True)
    def hrmis_employees_page(self, **kwargs):
        self._ensure_admin()

        page = self._safe_int(kwargs.get('page', 1), 1)
        page = max(page, 1)

        q = (kwargs.get('q') or '').strip()
        state = (kwargs.get('state') or '').strip()
        gender = (kwargs.get('gender') or '').strip()
        current_status = (kwargs.get('current_status') or '').strip()
        cadre_id = self._safe_int(kwargs.get('cadre_id') or 0, 0)

        EmployeeRequest = request.env['hrmis.employee.profile.request'].sudo()
        Cadre = request.env['hrmis.cadre'].sudo()

        domain = []

        if state:
            domain.append(('state', '=', state))
        if gender:
            domain.append(('gender', '=', gender))
        if current_status:
            domain.append(('hrmis_current_status_frontend', '=', current_status))
        if cadre_id:
            domain.append(('hrmis_cadre', '=', cadre_id))
        if q:
            domain = expression.AND([domain, self._build_search_domain(q)])

        total = EmployeeRequest.search_count(domain)
        offset = (page - 1) * self.PAGE_SIZE

        records = EmployeeRequest.search(
            domain,
            order='id desc',
            limit=self.PAGE_SIZE,
            offset=offset,
        )

        state_map = self._selection_label_map(EmployeeRequest, 'state')
        gender_map = self._selection_label_map(EmployeeRequest, 'gender')
        current_status_map = self._selection_label_map(EmployeeRequest, 'hrmis_current_status_frontend')

        district_map = self._load_district_map()
        facility_map = self._load_facility_map()

        rows = []
        for rec in records:
            district_name = district_map.get(rec.district_id) if rec.district_id else ''
            if rec.district_id and not district_name:
                district_name = f"District #{rec.district_id}"

            facility_name = ''
            facility_is_other = False
            if rec.facility_other_name:
                facility_name = rec.facility_other_name
                facility_is_other = True
            elif rec.facility_id:
                facility_name = facility_map.get(rec.facility_id) or f"Facility #{rec.facility_id}"

            designation_name = rec.hrmis_designation.name if rec.hrmis_designation else ''
            designation_is_other = False
            if not designation_name and rec.hrmis_temp_designation:
                designation_name = f"Custom designation #{rec.hrmis_temp_designation}"
                designation_is_other = True

            rows.append({
                'id': rec.id,
                'employee_name': rec.employee_id.name or '-',
                'login': rec.user_id.login or '-',
                'merit_number': rec.hrmis_merit_number or '-',
                'state': rec.state or '',
                'state_label': state_map.get(rec.state, rec.state or '-'),
                'cnic': rec.hrmis_cnic or '-',
                'pmdc_no': rec.hrmis_pmdc_no or '-',
                'gender': rec.gender or '',
                'gender_label': gender_map.get(rec.gender, rec.gender or '-'),
                'cadre_name': rec.hrmis_cadre.name if rec.hrmis_cadre else '-',
                'designation_name': designation_name or '-',
                'designation_is_other': designation_is_other,
                'bps': rec.hrmis_bps or '-',
                'district_name': district_name or '-',
                'facility_name': facility_name or '-',
                'facility_is_other': facility_is_other,
                'contact_info': rec.hrmis_contact_info or '-',
                'domicile': rec.hrmis_domicile or '-',
                'current_status': rec.hrmis_current_status_frontend or '',
                'current_status_label': current_status_map.get(
                    rec.hrmis_current_status_frontend,
                    rec.hrmis_current_status_frontend or '-'
                ),
            })

        pager = request.website.pager(
            url='/hrmis/employees',
            total=total,
            page=page,
            step=self.PAGE_SIZE,
            scope=5,
            url_args={
                'q': q,
                'state': state,
                'gender': gender,
                'current_status': current_status,
                'cadre_id': cadre_id or '',
            }
        )

        values = {
            'active_menu': 'employees',
            'rows': rows,
            'total': total,
            'page': page,
            'page_size': self.PAGE_SIZE,
            'pager': pager,
            'q': q,
            'state': state,
            'gender': gender,
            'current_status': current_status,
            'cadre_id': cadre_id,
            'state_options': [(k, v) for k, v in state_map.items()],
            'gender_options': [(k, v) for k, v in gender_map.items()],
            'current_status_options': [(k, v) for k, v in current_status_map.items()],
            'cadres': Cadre.search([], order='name asc'),
            'total_pages': int(math.ceil(total / float(self.PAGE_SIZE))) if total else 1,
        }
        return request.render('sanctioned_posts.hrmis_employees_page', values)