from starlette.requests import Request

from api.auth.cookies import cookie_secure


def make_request(
    *,
    scheme: str = "http",
    host: str = "app.example.com",
    forwarded_proto: str | None = None,
) -> Request:
    headers = [(b"host", host.encode())]
    if forwarded_proto is not None:
        headers.append((b"x-forwarded-proto", forwarded_proto.encode()))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "scheme": scheme,
        }
    )


def test_secure_true_for_https_scheme():
    assert cookie_secure(make_request(scheme="https")) is True


def test_secure_true_behind_proxy_via_x_forwarded_proto_even_if_scheme_is_http():
    assert cookie_secure(make_request(scheme="http", forwarded_proto="https")) is True


def test_secure_true_uses_first_value_of_forwarded_proto_list():
    assert (
        cookie_secure(make_request(scheme="http", forwarded_proto="https, http"))
        is True
    )


def test_secure_false_for_localhost_http_without_override():
    assert cookie_secure(make_request(scheme="http", host="localhost")) is False


def test_secure_false_for_loopback_ip_http_without_override():
    assert cookie_secure(make_request(scheme="http", host="127.0.0.1")) is False


def test_secure_defaults_true_for_non_local_plain_http_host():
    assert cookie_secure(make_request(scheme="http", host="app.example.com")) is True


def test_auth_cookie_secure_env_override_forces_true_on_localhost(monkeypatch):
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")

    assert cookie_secure(make_request(scheme="http", host="localhost")) is True


def test_auth_cookie_secure_env_override_forces_false_on_https(monkeypatch):
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")

    assert cookie_secure(make_request(scheme="https")) is False
