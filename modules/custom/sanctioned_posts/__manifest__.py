{
    "name": "HRMIS Sanctioned Posts Upload",
    "version": "1.0",
    "depends": [
        "website",
        "hr_holidays_updates",
        "hrmis_core"
    ],
    "data": [
        "views/hrmis_nav_inherit.xml",
        "views/hrmis_sanctioned_posts_upload.xml",
        "views/emr_api_test_templates.xml",
        "views/user_config_templates.xml",    
        "views/user_queue_templates.xml",
        "data/ir_cron.xml",
         'views/hrmis_employees_nav.xml',
        'views/hrmis_employees_templates.xml',
    ],
    'assets': {
    'web.assets_frontend': [
        'sanctioned_posts/static/src/js/hrmis_user_config_xlsx_sheet_picker.js',
        'sanctioned_posts/static/src/js/xlsx.full.min.js',
        'sanctioned_posts/static/src/css/hrmis_employees.css',
        'sanctioned_posts/static/src/js/hrmis_employees.js',
    ],
},
    
    "installable": True,
    "application": False,
}
