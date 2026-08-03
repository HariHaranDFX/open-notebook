# WP2 SDD Progress Ledger

Branch: wp-2-entra-auth
Plan: docs/superpowers/plans/2026-08-03-wp2-entra-auth.md
Spec: docs/superpowers/specs/2026-08-03-wp2-entra-auth-design.md
Started: 2026-08-03


Task 1: complete (commits 96f5928..cbbd3f0, review clean)


Task 1: complete (commits 96f5928..cbbd3f0, review clean)

Task 2: complete (commits cbbd3f0..06fa979, review clean; minors: ==24 assert, user_id RecordID coercion)

Task 3: complete (06fa979..cc67824, cookie name+8h fixed, review approved by controller after fix)

Task 4: complete (cc67824..3b3c737, CSRF cookie/entra fix approved)

Task 5: complete (3b3c737..d920ff0, EntraOIDCProvider BFF); P1 security fixes applied
post-review: server-side oauth_state (migration 25) replaces unsigned cookie verifier,
cookie_secure() helper (AUTH_COOKIE_SECURE + X-Forwarded-Proto) replaces
request.url.scheme-only Secure check.

Task 5: complete (3b3c737..4333bb2, oauth_state+Secure cookies fixed, 822 passed)

Task 6: complete (9258178)

Task 7: complete (owner-only notebook/source access + user_id RecordID coercion fix)

