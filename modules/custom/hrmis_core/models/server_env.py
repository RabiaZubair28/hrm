# -*- coding: utf-8 -*-
import os

from odoo import models


class HrmisServerEnv(models.AbstractModel):
    _name = "hrmis.server.env"
    _description = "HRMIS Server Environment Helper"

    def get_app_env(self):
        return (os.getenv("APP_ENV") or "").strip().lower()

    def is_local_server(self):
        return self.get_app_env() == "local"