import os
from odoo import models


class HrmisEmrApiConfig(models.AbstractModel):
    _name = "hrmis.emr.api.config"
    _description = "HRMIS EMR API Configuration (from environment variables)"

    def _env(self, key: str, default=None, required: bool = False):
        val = os.getenv(key, default)
        if required and (val is None or str(val).strip() == ""):
            raise ValueError(f"Missing required environment variable: {key}")
        return val

    def base_url(self) -> str:
        return self._env("EMR_API_BASE_URL", required=True).rstrip("/")

    def secret_key(self) -> str:
        # Can be blank in testing; make required=True when you go live
        return self._env("EMR_API_SECRET_KEY", default="").strip()

    def timeout(self) -> int:
        try:
            return int(self._env("EMR_API_TIMEOUT", default="30"))
        except Exception:
            return 30