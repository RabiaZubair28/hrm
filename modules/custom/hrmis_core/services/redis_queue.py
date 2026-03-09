# -*- coding: utf-8 -*-
import json
import os
import logging
from odoo import models

_logger = logging.getLogger(__name__)

try:
    import redis
except Exception:
    redis = None


class HrmisRedisQueue(models.AbstractModel):
    _name = "hrmis.redis.queue"
    _description = "HRMIS Redis Queue Helper (List-based)"


    def pop_json(self, queue_name: str):
        cli_pack = self._client()
        if not cli_pack:
            return None
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            val = cli.lpop(key)
            return json.loads(val) if val else None
        except Exception:
            return None

    def list_json(self, queue_name: str, start=0, end=20):
        cli_pack = self._client()
        if not cli_pack:
            return []
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            vals = cli.lrange(key, start, end)
            return [json.loads(v) for v in vals]
        except Exception:
            return []


    def _client(self):
        if redis is None:
            return None
        host = os.getenv("REDIS_HOST", "")
        if not host:
            return None
        port = int(os.getenv("REDIS_PORT", "6379"))
        db = int(os.getenv("REDIS_DB", "0"))
        password = os.getenv("REDIS_PASSWORD") or None
        prefix = os.getenv("REDIS_PREFIX", "hrmis:")
        # small timeouts so redis-down doesn't hurt requests
        cli = redis.Redis(
            host=host,
            port=port,
            db=db,
            password=password,
            decode_responses=True,
            socket_connect_timeout=0.2,
            socket_timeout=0.5,
            retry_on_timeout=False,
        )
        return cli, prefix

    def key(self, name: str) -> str:
        cli_pack = self._client()
        if not cli_pack:
            return ""
        _, prefix = cli_pack
        return f"{prefix}queue:{name}"

    def push_json(self, queue_name: str, payload: dict) -> bool:
        cli_pack = self._client()
        if not cli_pack:
            _logger.warning("[HRMIS][REDIS][QUEUE] Redis not available; skipping push.")
            return False
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            cli.rpush(key, raw)
            return True
        except Exception as e:
            _logger.warning("[HRMIS][REDIS][QUEUE] push failed queue=%s err=%s", queue_name, e)
            return False



    def length(self, queue_name: str) -> int:
        cli_pack = self._client()
        if not cli_pack:
            return 0
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            return int(cli.llen(key))
        except Exception:
            return 0
        

    def rpoplpush_json(self, src_queue: str, dst_queue: str):
        cli_pack = self._client()
        if not cli_pack:
            return None, None
        cli, prefix = cli_pack
        src = f"{prefix}queue:{src_queue}"
        dst = f"{prefix}queue:{dst_queue}"
        try:
            raw = cli.rpoplpush(src, dst)   # raw JSON string
            return (json.loads(raw) if raw else None), raw
        except Exception:
            return None, None
        
    def lrem_raw(self, queue_name: str, raw_json: str, count: int = 1) -> int:
        cli_pack = self._client()
        if not cli_pack or not raw_json:
            return 0
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            return int(cli.lrem(key, count, raw_json))
        except Exception:
            return 0

    def lrem_json(self, queue_name: str, payload: dict, count: int = 1) -> int:
        cli_pack = self._client()
        if not cli_pack:
            return 0
        cli, prefix = cli_pack
        key = f"{prefix}queue:{queue_name}"
        try:
            raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
            return int(cli.lrem(key, count, raw))
        except Exception:
            return 0
        

    def hset_json(self, key: str, field: str, payload: dict) -> bool:
        cli_pack = self._client()
        if not cli_pack:
            return False
        cli, prefix = cli_pack
        k = f"{prefix}{key}"
        try:
            cli.hset(k, field, json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            return False

    def hget_json(self, key: str, field: str):
        cli_pack = self._client()
        if not cli_pack:
            return None
        cli, prefix = cli_pack
        k = f"{prefix}{key}"
        try:
            val = cli.hget(k, field)
            return json.loads(val) if val else None
        except Exception:
            return None

    def hdel(self, key: str, field: str) -> bool:
        cli_pack = self._client()
        if not cli_pack:
            return False
        cli, prefix = cli_pack
        k = f"{prefix}{key}"
        try:
            cli.hdel(k, field)
            return True
        except Exception:
            return False