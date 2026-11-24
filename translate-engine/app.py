"""uvicorn entry point: `uvicorn app:app`. All the logic is in service.py."""

import logging

import service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = service.create_app()
