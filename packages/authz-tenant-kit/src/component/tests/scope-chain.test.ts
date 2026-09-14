/**
 * Tests for the Proxie fork's scope-chain extension to checkPermission —
 * see NOTICE. An org-wide role assignment (effectivePermissions row at
 * scopeKey "organization:org1") should satisfy a restaurant-scoped check
 * when the caller passes a chain [restaurant, organization], without any
 * row existing at the restaurant scope itself.
 */

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema.js";
import { api } from "../_generated/api.js";

const modules = import.meta.glob("../**/*.ts");
const TENANT = "test-tenant";

describe("unified checkPermission scopeChain", () => {
  it("falls back from a specific scope to a broader one in the chain", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("effectivePermissions", {
        tenantId: TENANT,
        userId: "user_1",
        permission: "orders:read",
        scopeKey: "organization:org1",
        effect: "allow",
        sources: ["manager"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.unified.checkPermission, {
      tenantId: TENANT,
      userId: "user_1",
      permission: "orders:read",
      scopeChain: [
        { type: "restaurant", id: "restaurant1" },
        { type: "organization", id: "org1" },
      ],
    });

    expect(result.allowed).toBe(true);
  });

  it("a specific-scope deny short-circuits before reaching a broader allow", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("effectivePermissions", {
        tenantId: TENANT,
        userId: "user_1",
        permission: "orders:read",
        scopeKey: "organization:org1",
        effect: "allow",
        sources: ["manager"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("effectivePermissions", {
        tenantId: TENANT,
        userId: "user_1",
        permission: "orders:read",
        scopeKey: "restaurant:restaurant1",
        effect: "deny",
        sources: ["suspension"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await t.query(api.unified.checkPermission, {
      tenantId: TENANT,
      userId: "user_1",
      permission: "orders:read",
      scopeChain: [
        { type: "restaurant", id: "restaurant1" },
        { type: "organization", id: "org1" },
      ],
    });

    expect(result.allowed).toBe(false);
  });

  it("denies when no scope in the chain grants the permission", async () => {
    const t = convexTest(schema, modules);

    const result = await t.query(api.unified.checkPermission, {
      tenantId: TENANT,
      userId: "user_1",
      permission: "orders:read",
      scopeChain: [
        { type: "restaurant", id: "restaurant1" },
        { type: "organization", id: "org1" },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("No permission granted");
  });

  it("a single-element chain behaves identically to the legacy `scope` argument", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      await ctx.db.insert("effectivePermissions", {
        tenantId: TENANT,
        userId: "user_1",
        permission: "orders:read",
        scopeKey: "restaurant:restaurant1",
        effect: "allow",
        sources: ["owner"],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const viaScope = await t.query(api.unified.checkPermission, {
      tenantId: TENANT,
      userId: "user_1",
      permission: "orders:read",
      scope: { type: "restaurant", id: "restaurant1" },
    });
    const viaChain = await t.query(api.unified.checkPermission, {
      tenantId: TENANT,
      userId: "user_1",
      permission: "orders:read",
      scopeChain: [{ type: "restaurant", id: "restaurant1" }],
    });

    expect(viaChain).toEqual(viaScope);
  });
});
