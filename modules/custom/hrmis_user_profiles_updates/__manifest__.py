{
    'name': "HRMIS User Profiles Updates",
    'version': "1.0",
    'summary': "Staff Personal Information Profile - Read Only for Employees",
    'category': 'Human Resources',
    'author': "Humza Aqeel Shaikh",
    'depends': ['hr'],
    'data': [
        # Security always first
        'security/ir.model.access.csv',
        'security/security.xml',

        # Core master data (DEPENDENCY FIRST)
        'data/hrmis_healthcare_unit_data.xml',
        'data/districts.xml',
        'data/facilities.xml',
        'data/facilities_primary.xml',
        'data/hrmis_cadre.xml',
        'data/designation_groups.xml',
        'data/designations.xml',
        'data/res_user_data.xml',

        # Views
        'views/hrmis_district_views.xml',
        'views/hrmis_facility_type_views.xml',
        'views/hr_employee_inherit.xml',
        'views/hrmis_user_services_views.xml',
        'views/hrmis_training_views.xml',
        'views/hrmis_profile_request_views.xml',
        # Menus last
        'views/hrmis_menu.xml',
        "views/hr_employee_download_button.xml",
    ],

    'assets': {
        'web.assets_frontend': [
            'hrmis_user_profiles_updates/static/src/js/facility_filter.js',
            'hrmis_user_profiles_updates/static/src/js/hrmis_profile_validation.js',
            'hrmis_user_profiles_updates/static/src/js/hrmis_extra_validations.js',
            'hrmis_user_profiles_updates/static/src/js/profile_request_confirm_modal.js',
            'hrmis_user_profiles_updates/static/src/js/search_combobox.js',
            'hrmis_user_profiles_updates/static/src/js/transfer_vacancies_accordion.js',
            'hrmis_user_profiles_updates/static/src/scss/hrmis_user_profile_styles.scss',
          
        ],
    },
    'installable': True,
    'application': False,
}