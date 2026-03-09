import json
import os
import logging
from odoo import models

_logger = logging.getLogger(__name__)

try:
    import redis
except Exception:  # pragma: no cover
    redis = None


class HrmisRedisCache(models.AbstractModel):
    _name = "hrmis.redis.cache"
    _description = "HRMIS Redis Cache Helper"

    def _enabled(self) -> bool:
        return bool(os.getenv("REDIS_HOST")) and redis is not None

    def _client(self):
        if not self._enabled():
            return None
        host = os.getenv("REDIS_HOST", "redis")
        port = int(os.getenv("REDIS_PORT", "6379"))
        db = int(os.getenv("REDIS_DB", "0"))
        password = os.getenv("REDIS_PASSWORD") or None
        return redis.Redis(host=host, 
                            port=port, 
                            db=db, 
                            password=password, 
                            decode_responses=True, 
                            socket_connect_timeout=0.2, 
                            socket_timeout=0.5, 
                            retry_on_timeout=False
                        )

    def _prefix(self) -> str:
        return os.getenv("REDIS_PREFIX", "hrmis:")

    def get_json(self, key: str):
        cli = self._client()
        if not cli:
            return None
        try:
            val = cli.get(self._prefix() + key)
            return json.loads(val) if val else None
        except Exception as e:
            _logger.warning("[HRMIS][REDIS] get failed key=%s err=%s", key, e)
            return None

    def set_json(self, key: str, payload, ttl: int | None = None) -> bool:
        cli = self._client()
        if not cli:
            return False
        try:
            if ttl is None:
                ttl = int(os.getenv("REDIS_DEFAULT_TTL", "300"))
            cli.setex(self._prefix() + key, ttl, json.dumps(payload, ensure_ascii=False))
            return True
        except Exception as e:
            _logger.warning("[HRMIS][REDIS] set failed key=%s err=%s", key, e)
            return False