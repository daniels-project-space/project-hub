# Project Hub

Daniel's umbrella dashboard. Deploys to Vercel with Convex backend.

- Code: `daniels-project-space/project-hub`
- Convex deployment: `fantastic-roadrunner-485` (https://fantastic-roadrunner-485.convex.cloud)
- Vercel project: `project-hub`

## Schema

`convex/schema.ts` defines:
- `widgets` — dashboard widget instances
- `projects` — placeholder project tiles
- `secrets` — merged from the old key-vault Supabase project

## Project setup and release

See [the project setup guide](docs/project-setup.md) for the app catalog rules
and the Vercel, Convex, Trigger.dev, and R2 release checklist. A verified
production URL can be linked while an app remains WIP; `live` reflects the
app's readiness, not just whether its dashboard deploys.
