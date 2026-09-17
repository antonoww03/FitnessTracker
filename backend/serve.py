"""Serve the production frontend and API together on one origin."""
import os
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles

from backend.server import app

FRONTEND_BUILD = Path(__file__).resolve().parents[1] / 'frontend' / 'build'
if not (FRONTEND_BUILD / 'index.html').is_file():
    raise RuntimeError('Frontend build missing. Run npm ci and npm run build in frontend first.')

# API routes are registered first, so /api stays on FastAPI.
app.mount('/', StaticFiles(directory=FRONTEND_BUILD, html=True), name='frontend')

if __name__ == '__main__':
    uvicorn.run(app, host=os.getenv('HOST', '127.0.0.1'), port=int(os.getenv('PORT', '8000')))
