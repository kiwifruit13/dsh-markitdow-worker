"""Interactive NDJSON-over-stdio server (`python -m markitdown_bridge`).

Protocol: one JSON request per stdin line, one JSON response per stdout line.
See service.py for op semantics. Cancellation is cooperative (queued requests
can be dropped; running synchronous conversions cannot be interrupted).
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor

from .service import (
    BridgeError,
    BridgeService,
    ERROR_INVALID_PARAMS,
    emit_json,
    force_utf8_stdio,
)

force_utf8_stdio()


def main() -> int:
    service = BridgeService()
    workers = 4
    try:
        workers = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    except ValueError:
        pass
    executor = ThreadPoolExecutor(max_workers=workers)
    emit_json({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = str(req["id"])
            op = str(req["op"])
            params = req.get("params") or {}
        except (json.JSONDecodeError, KeyError, TypeError) as exc:
            emit_json({"id": None, "ok": False, "error": {"code": ERROR_INVALID_PARAMS, "message": f"malformed request: {exc}"}})
            continue

        def _run(req_id: str = req_id, op: str = op, params: dict = params) -> None:
            try:
                result = service.run_request(req_id, op, params)
                emit_json({"id": req_id, "ok": True, "result": result})
            except BridgeError as exc:
                emit_json({"id": req_id, "ok": False, "error": {"code": exc.code, "message": exc.message}})
            except Exception as exc:  # noqa: BLE001 — last-resort containment
                emit_json({"id": req_id, "ok": False, "error": {"code": "MARKITDOWN_INTERNAL", "message": str(exc)}})

        executor.submit(_run)
    executor.shutdown(wait=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
