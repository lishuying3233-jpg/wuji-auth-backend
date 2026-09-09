from __future__ import annotations

import os

from python_worker.app.server import app


if __name__ == '__main__':
    import uvicorn

    port = int(os.getenv('WUJI_API_PORT', '8765'))
    uvicorn.run(app, host='127.0.0.1', port=port, log_level='info')


__all__ = ['app']
