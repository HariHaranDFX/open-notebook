# Task 1 — AuthProvider protocol + PasswordAuthProvider extract

## Status

DONE

## Assumptions

- `AUTH_PROVIDER=entra` must fail explicitly until the Entra provider arrives in
  Task 5.
- The password provider retains the existing open mode when
  `OPEN_NOTEBOOK_PASSWORD` is unset.

## Delivered

- Replaced `api/auth.py` with the `api/auth/` package.
- Added `AuthenticatedUser`, `AuthProvider`, `PasswordAuthProvider`,
  `build_auth_provider()`, and `AuthMiddleware`.
- Kept the application’s existing excluded middleware paths and OPTIONS bypass.
- Attached the resolved user (or `None` in open password mode) to
  `request.state.user`.
- Switched `api/main.py` to `AuthMiddleware`.
- Added password-provider tests for a valid bearer, invalid bearer, and open
  password mode.

## TDD evidence

### RED

Command:

```text
uv run pytest tests/test_auth_password_provider.py -v
```

Output:

```text
ImportError while importing test module
tests/test_auth_password_provider.py:5: in <module>
    from api.auth.password import PasswordAuthProvider
E   ModuleNotFoundError: No module named 'api.auth.password'; 'api.auth' is not a package
============================== 1 error in 6.41s ==============================
```

The test failed because the requested package and provider did not yet exist.

### GREEN

Command:

```text
uv run pytest tests/test_auth_password_provider.py -v
```

Output:

```text
collected 3 items

tests/test_auth_password_provider.py::test_password_provider_accepts_matching_bearer PASSED
tests/test_auth_password_provider.py::test_password_provider_rejects_bad_password PASSED
tests/test_auth_password_provider.py::test_password_provider_disables_auth_when_password_is_unset PASSED

============================== 3 passed in 2.00s ==============================
```

## Verification

```text
uv run pytest tests/test_auth_password_provider.py tests/test_config_endpoint_no_leak.py -v
7 passed, 2 warnings in 26.80s

uv run ruff check api/auth api/main.py tests/test_auth_password_provider.py
All checks passed!

git diff --cached --check
passed
```

The two pytest warnings are existing third-party deprecations from
`starlette.testclient` and `surreal_commands`; no test failures occurred.

## Self-review

- Confirmed the old `api/auth.py` was deleted, avoiding module/package shadowing.
- Confirmed no dependencies were added.
- Confirmed `secrets.compare_digest` remains the password comparison.
- Confirmed the Entra factory path raises `NotImplementedError` rather than
  wiring an incomplete provider.
- Reviewed the staged diff for scope; it contains only Task 1 auth extraction,
  app wiring, and tests.

## Commit

- `e98c9ce feat(wp2): extract AuthProvider protocol and PasswordAuthProvider`

---

## Review fix — Password-mode 401 details

### TDD evidence

The middleware regression test initially failed for all three password-mode
failures because each response returned `{"detail": "Unauthorized"}`.

After the fix:

```text
uv run pytest tests/test_auth_password_provider.py -v
6 passed, 1 warning in 2.03s

ruff check api/auth tests/test_auth_password_provider.py
All checks passed!
```

The warning is the existing Starlette `TestClient`/httpx deprecation.

### Delivered

- Restored `Missing authorization header`, `Invalid authorization header format`,
  and `Invalid password` JSON details for enabled password authentication.
- Preserved `WWW-Authenticate: Bearer` on all three responses.
- Kept open password mode unchanged when no password is configured.
