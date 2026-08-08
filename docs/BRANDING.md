# Deployment Branding

Open Notebook supports one trusted brand per deployment. The frontend reads a
JSON document named by `BRAND_CONFIG_PATH`, validates it at process startup, and
caches the result for that process. A client switch therefore needs a frontend
restart, but no code edit, database change, or image rebuild.

This is deployment configuration, not a tenant-facing theme editor. Do not place
secrets in the file: its validated values are intentionally sent to the browser.
The server path itself is not exposed by an endpoint.

## Configuration contract

Start from [`config/brand.default.json`](../config/brand.default.json) or the
deliberately different [`config/brand.example-client.json`](../config/brand.example-client.json).
Unknown properties are rejected.

| Property | Required | Meaning |
|---|---:|---|
| `appName` | Yes | Non-empty deployment identity. It is not translated. |
| `logoUrl` | Yes | Light/default logo. |
| `logoDarkUrl` | No | Dark-theme logo; the default logo is reused when omitted. |
| `faviconUrl` | No | Browser icon; no icon metadata is added when omitted. |
| `actionLight` | Yes | Six-digit hex primary-action color for light mode. |
| `actionDark` | Yes | Six-digit hex primary-action color for dark mode. |
| `supportUrl` | No | Deployment help URL used by the connection-error support link. The upstream documentation remains the fallback. |

Asset and support URLs must be either root-relative paths such as
`/brand/logo.svg` or absolute `https:` URLs. Protocol-relative, `http:`, `data:`,
`javascript:`, backslash, malformed, and path-traversal values are rejected.

Action colors must use `#RRGGBB`. Each is paired with one of the fixed approved
foregrounds and must reach WCAG AA contrast of at least 4.5:1. Invalid JSON,
missing fields, unknown fields, unsafe URLs, invalid colors, and inadequate
contrast stop the frontend process with a concise error naming the file and
field; file contents are never included in that error.

## What a brand can and cannot change

Brand configuration controls the application name, logo, favicon, primary
action pair, and optional support destination. The name is inserted into each
existing translation; it is never translated itself.

Typography, radii, canvas and surface colors, selection, provenance, keyboard
focus, permissions, and success/info/warning/error meanings remain fixed by
[`DESIGN.md`](../DESIGN.md). Brand configuration cannot supply fonts, arbitrary
CSS, general design tokens, or semantic colors.

## Assets

For HTTPS-hosted assets, put the approved URL directly in the JSON. No volume
mount or Next.js image allowlist is needed.

For local assets, use root-relative `/brand/...` URLs and make those files
available at `frontend/public/brand` for a host process or
`/app/frontend/public/brand` in the container. Keep explicit SVG or raster image
dimensions, meaningful brand names, and equivalent light/dark logo treatments.
Do not encode scripts, external trackers, or secrets in customer assets.

The example client file references placeholder Northstar assets that are not
checked in. Supply matching files in the asset directory or replace those paths
with approved HTTPS URLs before visual review.

## Local same-build switch

Build the frontend once:

```powershell
cd frontend
npm run build
```

Start that build with the repository default:

```powershell
$env:BRAND_CONFIG_PATH = (Resolve-Path ..\config\brand.default.json).Path
npm run start
```

Stop only the frontend process, point the environment variable at the other
document, and start the same `.next` build again:

```powershell
$env:BRAND_CONFIG_PATH = (Resolve-Path ..\config\brand.example-client.json).Path
npm run start
```

On POSIX shells, use `export BRAND_CONFIG_PATH="$(realpath
../config/brand.example-client.json)"`. Do not run `npm run build` between the
two starts. The name, logo paths, favicon, action colors, and support link should
change together.

## Docker Compose

The tracked [`docker-compose.yml`](../docker-compose.yml) contains opt-in,
commented branding entries. Uncomment the `BRAND_CONFIG_PATH` environment entry
and the selected JSON mount together:

```yaml
environment:
  - BRAND_CONFIG_PATH=/app/config/brand.json
volumes:
  - ./config/brand.example-client.json:/app/config/brand.json:ro
  - ./brand-assets:/app/frontend/public/brand:ro # only for /brand/... URLs
```

Then recreate only the application container:

```sh
docker compose up -d --force-recreate open_notebook
```

Changing the mounted JSON or assets followed by the same recreate command uses
the existing image. HTTPS assets need no asset mount.

## Review and rollback

Before release, inspect the login and application shell in both light and dark
modes. Confirm the configured name, light/dark logo behavior, favicon, primary
buttons, keyboard focus, selected evidence, provenance, semantic statuses, and
the connection-error support destination. Test keyboard navigation and zoom;
customer identity must not weaken the fixed accessibility roles.

To roll back a host process, unset `BRAND_CONFIG_PATH` and restart the frontend,
or point it explicitly to `config/brand.default.json`. For Compose, comment the
custom environment entry and mounts and recreate `open_notebook`; the image's
checked-in development default is then used.

The repository default is for development and upstream continuity. Before a
commercial launch, replace it at deployment time with the approved customer
name, assets, accessible action colors, and support destination.
