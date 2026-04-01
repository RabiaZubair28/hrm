{
    "name": "MS DHO Transfers",
    "version": "1.0",
    "category": "HRMIS",
    "summary": "MS DHO Transfers",
    "author": "HRMIS",
    "depends": ["hr_holidays_updates", "hr", "hr_holidays_multilevel_hierarchy", "custom_section_officers", "hrmis_transfer"],
    "data": [
        "views/hidden_tabs.xml",
               "views/ms_dho_navbar.xml",
        "views/ms_dho_transfer_requests.xml",
    ],
    "application": True,
}
