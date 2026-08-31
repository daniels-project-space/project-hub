# Project Hub vault control

`/vault` is an owner-only, write-only control for adding and rotating keys. It
shows service/key metadata only; existing values are never returned to the
browser or rendered by the interface.

Configure these server-only production variables before enabling the page:

- `PROJECT_HUB_VAULT_PASSWORD` — owner passphrase.
- `PROJECT_HUB_VAULT_SESSION_SECRET` — a distinct random value of at least 32 bytes.

Set `PROJECT_HUB_VAULT_SESSION_SECRET` to the **same** value in the Project
Hub Vercel project and the Project Hub Convex deployment. It signs an
eight-hour owner session that Convex verifies before allowing the metadata
catalogue or an upsert. No durable full-vault bearer is stored in Vercel or
sent to the browser.

The Convex deployment needs the `secrets:catalog` and `secrets:upsertOne`
functions from this release. The special Higgsfield OAuth bundle is excluded
from this control and must continue to use its CAS rotation endpoint.

Sessions are signed server-side, are HttpOnly/SameSite=Strict, last eight
hours, and are accepted only by `/api/vault`. Writes also require a same-origin
request.
