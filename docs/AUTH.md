# Authentication

Open Notebook uses password authentication by default. For Microsoft Entra ID,
set `AUTH_PROVIDER=entra`; the API then runs the Authorization Code flow with
PKCE and issues an httpOnly session cookie. The browser never receives an Entra
token.

## Microsoft Entra ID setup

1. In the Microsoft Entra admin center, create an app registration for this
   deployment. Choose **Accounts in this organizational directory only** unless
   the deployment has a reason to support another account type.
2. Under **Authentication**, add a **Web** redirect URI:
   `https://<host>/api/auth/callback`.
   This is the public frontend URL. Do not register the API container's internal
   address or port.
3. Create a client secret and store its value in `ENTRA_CLIENT_SECRET`.
4. The sign-in request uses delegated OpenID Connect scopes `openid`, `profile`,
   `email`, and `offline_access`. No Microsoft Graph permission is needed for
   WP2. Grant tenant admin consent only if your organization requires consent
   for these delegated permissions.

## Configuration

Set these values in the API process environment, then restart the API:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `AUTH_PROVIDER` | For Entra | `password` | Set to `entra` to enable Entra OIDC. |
| `ENTRA_TENANT_ID` | For Entra | — | Tenant (directory) ID used to validate issuer and construct Entra endpoints. |
| `ENTRA_CLIENT_ID` | For Entra | — | Application (client) ID from the Entra app registration. |
| `ENTRA_CLIENT_SECRET` | For Entra | — | Client-secret value for the authorization-code exchange. Keep it secret. |
| `ENTRA_REDIRECT_URI` | For Entra | — | Public callback URL, for example `https://notebook.example.com/api/auth/callback`; must exactly match the app registration. |
| `AUTH_ADMIN_EMAILS` | For Entra | — | Comma-separated administrator email allowlist. At least one nonblank address is required. |
| `AUTH_COOKIE_SECURE` | No | Auto-detected | Forces the session-cookie `Secure` flag: `true`/`false`, `1`/`0`, or `yes`/`no`. Leave unset when proxy headers are correct. |
| `AUTH_SESSION_HOURS` | No | `8` | Lifetime of an Entra session. |
| `ENTRA_PROMPT` | No | (omit) | Optional OIDC `prompt` on the authorize request: `select_account`, `login`, `consent`, or `none`. Use `select_account` to show the Microsoft account picker. Invalid values are ignored. |
| `CLIENT_ID` | No | `default` (Entra) | Stable deployment identifier stamped on records. This is not `ENTRA_CLIENT_ID`. |
| `CORS_ORIGINS` | **For Entra production** | `*` | Public HTTPS origin(s) of the deployment, comma-separated, e.g. `https://notebook.example.com`. Required for Entra production: it is also the allowlist the CSRF Origin check (`api/auth/csrf.py`) uses to accept mutating requests, since the API has no proxy-headers middleware and cannot otherwise derive its own public origin from `X-Forwarded-Host`/`X-Forwarded-Proto`. Leaving it at the `*` default makes every state-changing Entra request fail the Origin check. |

Example:

```bash
AUTH_PROVIDER=entra
ENTRA_TENANT_ID=00000000-0000-0000-0000-000000000000
ENTRA_CLIENT_ID=00000000-0000-0000-0000-000000000000
ENTRA_CLIENT_SECRET=replace-with-a-secret-value
ENTRA_REDIRECT_URI=https://notebook.example.com/api/auth/callback
AUTH_ADMIN_EMAILS=admin@example.com,security@example.com
CLIENT_ID=customer-a-production
CORS_ORIGINS=https://notebook.example.com
```

## Deployment topology

The frontend's Next.js rewrite proxies `/api/*` to FastAPI. Keep the browser on
the same public origin as the frontend, so login, callback, and API requests
use paths such as `/api/auth/login` and `/api/auth/callback`. Do not set
`NEXT_PUBLIC_API_URL` to an absolute, cross-origin API URL for an Entra
deployment: the first-party `SameSite=Lax` session cookie would not work as
intended.

For TLS-terminating reverse proxies, forward `X-Forwarded-Proto: https`.
Alternatively set `AUTH_COOKIE_SECURE=true`. Set it to `false` only for local
HTTP debugging.

Every state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) must also pass a
same-origin check: the request's `Origin` (or `Referer`) header must match
either the API's own base URL or an entry in `CORS_ORIGINS`. Behind a reverse
proxy, the API sees the proxy's internal scheme/host, not the public one, so
`CORS_ORIGINS=<public https origin>` must be set explicitly — without it the
check silently rejects every browser write with a 403 once Entra is enabled.
This is unrelated to whether `X-Forwarded-Host` is forwarded; the API does not
read that header for this check.

## Roles and local fallback

When `AUTH_PROVIDER=entra`, startup fails unless every Entra value above is set
and `AUTH_ADMIN_EMAILS` contains at least one email. A user whose normalized
email is in that allowlist becomes an `admin`; every other signed-in user is a
`user`. There is no "first login becomes admin" behavior.

For local development, omit `AUTH_PROVIDER` (or set it to `password`) and set
`OPEN_NOTEBOOK_PASSWORD`. Requests then use the existing Bearer-password flow.
Leaving `OPEN_NOTEBOOK_PASSWORD` unset disables password authentication.

## Sharing (WP2b)

Notebooks and sources are private by default. Owners can share; admins can
allocate to users and app-local groups. Roles are `viewer` and `editor`.
See [SHARING.md](SHARING.md) and
[PDR-003](7-DEVELOPMENT/decisions/PDR-003-per-user-ownership-and-sharing.md).

**Deferred (WBS 4.20–4.22, not in WP2b):** Entra ID group sync; full org
directory user picker; public links / editor reshare / ownership transfer.
