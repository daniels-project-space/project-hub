# Project setup and release

Project Hub's app dock and Projects widget use [`src/lib/apps.ts`](../src/lib/apps.ts)
as their app catalog. Keep each cloud app's source, runtime, deployment, and
storage identities isolated.

## New project checklist

1. Create the canonical repository under `daniels-project-space` and its
   checkout at `/home/ubuntu/<slug>`. Add project-specific `AGENTS.md`, build
   instructions, and a deployment runbook.
2. Give the app its own Convex deployment, Vercel project, and Trigger.dev
   project. Set each repository config to that app's own identifiers; do not
   reuse another app's deployment or Trigger project.
3. Create the app's R2 bucket when it stores media or large artifacts. Keep
   final render output in the requesting project's bucket. Put credentials in
   the app's scoped server-side vault/runtime settings, never in source,
   browser code, or documentation.
4. Validate the reviewed commit with the app's documented typecheck, tests,
   and production build. Deploy Convex functions and Trigger tasks only to
   their named app deployments, then deploy the UI to the linked Vercel
   project. Check each provider's deployment result and exact production
   alias; a successful local build or push alone does not prove a release.
5. Add or update the app in `src/lib/apps.ts`. Add `vercelUrl` after verifying
   the exact production alias. Keep status separate: `wip` means the app still
   has unfinished readiness gates, even when its dashboard is deployed; use
   `live` only after those gates pass. Include the canonical `githubUrl` and
   keep `idea` for projects without an implementation checkout.
6. If the app is also represented in the Convex `projects` table, update that
   record independently. The static app catalog and user-managed Convex
   project records serve different purposes.

## Render Engine registration

Render Engine is present in the app catalog as **WIP** and links to its
canonical source: `daniels-project-space/render-engine`. Its verified
dashboard alias is `https://render-engine-sable.vercel.app`; its catalog status
remains WIP until its Final GPU lanes complete their qualification checks.
The live Project Hub Convex `projects` row also has slug `render-engine`, the
same dashboard and source URLs, and status `wip`.

The Render Engine repository declares its own Convex deployment
(`prod:jovial-camel-68`), Trigger.dev project (`proj_xklptoivqrifdunydcoo`),
and Vercel project/alias. Its infrastructure bucket is `render-engine`; each
consumer still needs a separate output bucket. Follow the Engine repository's
[`docs/DEPLOYMENT.md`](https://github.com/daniels-project-space/render-engine/blob/main/docs/DEPLOYMENT.md)
for its ordered release checks and qualification requirements. Do not copy
credentials from one project to another or mark the catalog entry live until
those checks and the production alias are verified.
