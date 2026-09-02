"""
Pytest configuration file.

This file ensures that the project root is in the Python path,
allowing tests to import from the api and open_notebook modules.
"""

import os
import sys
from pathlib import Path

# Ensure password auth is disabled for tests BEFORE any imports
# The PasswordAuthMiddleware skips auth when this env var is not set
# Set to empty string instead of deleting to prevent it from being reloaded
os.environ["OPEN_NOTEBOOK_PASSWORD"] = ""

# Load environment variables from .env file
# This must be done BEFORE any imports that depend on environment variables
import dotenv
from dotenv import load_dotenv

# Load .env file from project root
dotenv_path = Path(__file__).parent.parent / ".env"
if dotenv_path.exists():
    load_dotenv(dotenv_path)
    print(f"Loaded environment variables from {dotenv_path}")
else:
    print(f"Warning: .env file not found at {dotenv_path}")

# Deployment auth and browser-policy settings must not leak into the test app.
# Individual auth/CORS tests set these explicitly with monkeypatch.
for test_owned_setting in (
    "AUTH_PROVIDER",
    "AUTH_COOKIE_SECURE",
    "CORS_ORIGINS",
    "ENTRA_PROMPT",
    "OPEN_NOTEBOOK_PASSWORD_FILE",
):
    os.environ.pop(test_owned_setting, None)
os.environ["OPEN_NOTEBOOK_PASSWORD"] = ""

# api.main also calls load_dotenv() during import. The test process has already
# loaded the service settings it needs, so prevent that second call from
# restoring deployment auth/CORS values cleared above.
dotenv.load_dotenv = lambda *args, **kwargs: False

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))
