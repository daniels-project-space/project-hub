# CJ token-bundle control-plane contract

This server-to-server contract uses Convex's standard HTTP API. The bearer is
passed only inside `args`; it must be the root capability or belong to one
unique active client with `canWrite: true` and `services: ["cj"]` exactly.
Multi-service and wildcard policies are intentionally rejected. Do not place
the bearer in a browser bundle or log the request body.

Preflight, before consuming CJ's one-time refresh operation:

```http
POST https://<project-hub-convex-deployment>/api/query
Content-Type: application/json

{
  "path": "secrets:preflightCjTokenBundle",
  "args": {
    "service": "cj",
    "vaultToken": "<dedicated-cj-writer-bearer>",
    "expectedRefreshToken": "<current-refresh-token>"
  },
  "format": "json"
}
```

Success envelope (the value contains key names only):

```json
{
  "status": "success",
  "value": {
    "status": "ready",
    "retainedKeys": ["CJ_OPEN_ID", "CJ_ACCESS_TOKEN", "CJ_REFRESH_TOKEN"]
  }
}
```

Atomic replacement after CJ returns the next bundle:

```http
POST https://<project-hub-convex-deployment>/api/mutation
Content-Type: application/json

{
  "path": "secrets:compareAndSwapCjTokenBundle",
  "args": {
    "service": "cj",
    "vaultToken": "<dedicated-cj-writer-bearer>",
    "expectedRefreshToken": "<current-refresh-token>",
    "bundle": {
      "CJ_OPEN_ID": "<1-to-20-digit-open-id>",
      "CJ_ACCESS_TOKEN": "<next-access-token>",
      "CJ_REFRESH_TOKEN": "<next-refresh-token>",
      "CJ_ACCESS_TOKEN_EXPIRY_DATE": "<optional-expiry-string>",
      "CJ_REFRESH_TOKEN_EXPIRY_DATE": "<optional-expiry-string>"
    }
  },
  "format": "json"
}
```

Written envelope:

```json
{
  "status": "success",
  "value": {
    "status": "written",
    "retainedKeys": [
      "CJ_OPEN_ID",
      "CJ_ACCESS_TOKEN",
      "CJ_REFRESH_TOKEN",
      "CJ_ACCESS_TOKEN_EXPIRY_DATE",
      "CJ_REFRESH_TOKEN_EXPIRY_DATE"
    ]
  }
}
```

Omit `expectedRefreshToken` only for a clean first connection. Omit either
optional expiry key to remove its stale row. A preflight may return `conflict`
or `ambiguous`; a mutation may return exactly `{"status":"conflict"}` or
`{"status":"ambiguous"}` with zero writes. Never call CJ when preflight is not
`ready`.
