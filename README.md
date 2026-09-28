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
and the Vercel, Convex, Trigger.dev, and R2 release checklist. The catalog is
updated only when the app's production URL has been verified; work in progress
entries link to source without implying a live release.
