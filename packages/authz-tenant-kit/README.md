# @proxie-studio/authz-tenant-kit

RBAC for multi-tenant Convex apps — role/permission checks scoped to an
organization/restaurant hierarchy, an `assignableRoles`
privilege-escalation guard, and tenant-defined custom roles. A private
fork of [`@djpanda/convex-authz`](https://github.com/dbjpanda/convex-authz),
consumed as a workspace package by `packages/backend` in this monorepo.
Not published to npm — see NOTICE for the exact provenance and what was
changed.

## What's different from upstream

- **React support removed.** This fork is consumed by SvelteKit apps.
  `src/react/`, the example app, and upstream's release/CI tooling are
  gone.
- **Scope-chain permission checks.** `Authz.can`/`require`/`canAny` accept
  either a single `Scope` (unchanged) or an ordered array of scopes,
  most-specific first. An organization-wide role assignment can satisfy a
  restaurant-scoped check without a role-assignment row per restaurant.
  See `src/component/unified.ts`'s `checkPermission` and
  `src/client/index.ts`'s `_checkPermission`.
- **`assignableRoles` guard.** Opt-in constructor option enforced inside
  `assignRole`: holding a permission to assign roles doesn't implicitly
  let you assign a role senior to your own. See the `Authz` constructor
  docs in `src/client/index.ts`.

## How this app uses it

See `packages/backend/convex/authzConfig.ts` for the actual configuration
(permissions, role ladder, `assignableRoles` whitelist, custom-roles
whitelist) and `packages/backend/convex/lib/authz.ts` for the
query/mutation/action wrappers every staff-facing endpoint is built from.

```ts
import { Authz, definePermissions, defineRoles } from "@proxie-studio/authz-tenant-kit";
import { components } from "./_generated/api";

const permissions = definePermissions({ orders: { read: true } });
const roles = defineRoles(permissions, { manager: { orders: ["read"] } });

const authz = new Authz(components.authz, { permissions, roles, tenantId: "..." });

// In a query/mutation, with a chain (most-specific first):
await authz.require(ctx, userId, "orders:read", [
  { type: "restaurant", id: restaurantId },
  { type: "organization", id: organizationId },
]);
```

## Custom roles (tenant-defined)

Upstream's v2.4 custom-roles feature — opt-in via the `customRoles`
constructor option — lets an app-defined authority (in our case,
`org_admin`) compose new roles from a whitelist of grantable permissions,
instead of being limited to the hardcoded role ladder. See
`src/client/index.ts`'s `createCustomRole`/`assignCustomRole`/etc. and
`authzConfig.ts` for how it's enabled here.

## Development

```
bun run build       # tsc --project ./tsconfig.build.json
bun run test         # vitest run --typecheck
```

`dist/` is committed — this package has no separate publish step for a
git/workspace dependency (see the reasoning applied identically to
`better-auth-tenant-kit`). Rebuild and re-commit after any `src/` change.
