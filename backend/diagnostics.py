"""Bounded diagnostics: never accept/log URLs, bodies, messages or stack traces."""
import json
import logging
import os
import re
import time
import uuid
from typing import Literal
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from backend.storage import DatabaseBusy
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter()
logger = logging.getLogger('uvicorn.error')
RELEASE = os.getenv('RENDER_GIT_COMMIT', '')
RELEASE = RELEASE if re.fullmatch(r'[a-f0-9]{40}', RELEASE) else 'development'


class ClientDiagnostic(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['javascript', 'unhandled_rejection', 'render', 'api']
    release: str = Field(pattern=r'^(development|[a-f0-9-]{36})$', max_length=36)
    status: int = Field(default=0, ge=0, le=599)
    request_id: str | None = Field(default=None, pattern=r'^[a-f0-9]{32}$', max_length=32)


@router.post('/diagnostics/client', status_code=204)
def client_event(body: ClientDiagnostic):
    from backend.server import database, CURRENT_USER
    # Dedicated budget; diagnostics never consume login/recovery attempts.
    key = 'diagnostics:' + CURRENT_USER.get()
    now = time.time()
    with database() as db:
        db.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN attempts.until<? THEN 1 ELSE attempts.count+1 END, until=CASE WHEN attempts.until<? THEN excluded.until ELSE attempts.until END', (key,now+900,now,now))
        count = db.execute('SELECT count FROM attempts WHERE key=?',(key,)).fetchone()[0]
    if count > 30:
        raise HTTPException(429, 'Diagnostic rate limit reached')
    logger.warning(json.dumps({'event':'client_error', **body.model_dump()}))
    return Response(status_code=204)


async def diagnostic_requests(request: Request, call_next):
    request_id = uuid.uuid4().hex
    started = time.perf_counter()
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except DatabaseBusy:
        response = JSONResponse({'detail':'Server busy. Try again shortly.'}, status_code=503, headers={'Retry-After':'2'})
    except Exception:
        # Do not log exception text/locals: database exceptions can contain values.
        response = JSONResponse({'detail':'Unexpected server error', 'request_id':request_id}, status_code=500)
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers['X-Request-ID'] = request_id
    response.headers['Server-Timing'] = f'app;dur={elapsed_ms}'
    if response.status_code >= 500:
        route = getattr(request.scope.get('route'), 'path', 'unknown')
        # Only application-defined API route templates, never the raw request URL.
        route = route if isinstance(route,str) and route.startswith('/api/') else 'unknown'
        logger.error(json.dumps({'event':'server_error','release':RELEASE,'request_id':request_id,
                                 'route':route,'status':response.status_code,'duration_ms':elapsed_ms}))
    return response
