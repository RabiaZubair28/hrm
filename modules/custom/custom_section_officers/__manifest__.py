{
    'name': 'Section Officer Extension',
    'version': '1.0.0',
    'summary': 'Extends Staff profile for Section Officer',
    'category': 'HR',
    'author': 'Aneeqa Baig',
    'depends': [
        'hr_holidays_updates',
        'base',
        'hrmis_user_profiles_updates'
    ],
    'data': [
        # 'security/security.xml',
        'security/ir.model.access.csv',
        'views/section_officer_menu.xml',
        'views/section_officer_template.xml',
        'views/manage_requests_templates.xml',
        'views/user_profile_so.xml',
        'views/staff_search.xml',
    ],
    "assets": {
        "web.assets_frontend": [
            "custom_section_officers/static/src/scss/search_staff.scss",
            "custom_section_officers/static/src/js/transfer_vacancies_pagination.js",
            'custom_section_officers/static/src/js/hrmis_so_leave_filters.js',
            'custom_section_officers/static/src/scss/hrmis_so_leave_filters.scss',
        ],
    },
    'installable': True,
    'application': False,
}