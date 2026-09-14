import { describe, expect, it, vi } from "vitest";
import { definePermissions, defineRoles, Authz } from "./index.js";
import type { ComponentApi } from "../component/_generated/component.js";

function createMockComponent() {
  return {
    indexed: {
      getUserRolesFast: "indexed.getUserRolesFast",
    },
    unified: {
      checkPermission: "unified.checkPermission",
      assignRoleUnified: "unified.assignRoleUnified",
    },
  } as unknown as ComponentApi;
}

const permissions = definePermissions({
  restaurants: { manage: true },
});
const roles = defineRoles(permissions, {
  employee: { restaurants: [] },
  manager: { restaurants: ["manage"] },
  owner: { restaurants: ["manage"] },
  org_admin: { restaurants: ["manage"] },
});

describe("Authz assignableRoles guard", () => {
  it("allows assignment when the actor's role permits the target role", async () => {
    const component = createMockComponent();
    const authz = new Authz(component, {
      permissions,
      roles,
      tenantId: "test-tenant",
      assignableRoles: {
        org_admin: ["employee", "manager", "owner"],
        owner: ["employee", "manager"],
      },
    });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue([{ role: "owner", scopeKey: "restaurant:r1" }]),
      runMutation: vi.fn().mockResolvedValue("assignment_id"),
    };

    await authz.assignRole(ctx, "user_1", "manager", { type: "restaurant", id: "r1" }, undefined, "actor_1");

    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.unified.assignRoleUnified,
      expect.objectContaining({ role: "manager", assignedBy: "actor_1" })
    );
  });

  it("denies assignment when the target role exceeds what the actor's role permits", async () => {
    const component = createMockComponent();
    const authz = new Authz(component, {
      permissions,
      roles,
      tenantId: "test-tenant",
      assignableRoles: {
        org_admin: ["employee", "manager", "owner"],
        owner: ["employee", "manager"],
      },
    });
    const ctx = {
      runQuery: vi.fn().mockResolvedValue([{ role: "owner", scopeKey: "restaurant:r1" }]),
      runMutation: vi.fn().mockResolvedValue("assignment_id"),
    };

    // Owner trying to assign org_admin (senior to their own role) must be rejected.
    await expect(
      authz.assignRole(ctx, "user_1", "org_admin", { type: "restaurant", id: "r1" }, undefined, "actor_1")
    ).rejects.toThrow(/do not permit assigning role/);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("requires an actorId when assignableRoles is configured", async () => {
    const component = createMockComponent();
    const authz = new Authz(component, {
      permissions,
      roles,
      tenantId: "test-tenant",
      assignableRoles: { org_admin: ["employee"] },
    });
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn(),
    };

    await expect(
      authz.assignRole(ctx, "user_1", "employee", { type: "restaurant", id: "r1" })
    ).rejects.toThrow(/requires an actorId/);
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  it("checks every link of a scope chain and unions assignable targets across matched roles", async () => {
    const component = createMockComponent();
    const authz = new Authz(component, {
      permissions,
      roles,
      tenantId: "test-tenant",
      assignableRoles: {
        org_admin: ["employee", "manager", "owner"],
      },
    });
    // No role at the restaurant scope, but an org-wide org_admin role.
    const ctx = {
      runQuery: vi
        .fn()
        .mockResolvedValueOnce([]) // restaurant:r1 — nothing here
        .mockResolvedValueOnce([{ role: "org_admin", scopeKey: "organization:org1" }]), // organization:org1
      runMutation: vi.fn().mockResolvedValue("assignment_id"),
    };

    await authz.assignRole(
      ctx,
      "user_1",
      "manager",
      [{ type: "restaurant", id: "r1" }, { type: "organization", id: "org1" }],
      undefined,
      "actor_1"
    );

    expect(ctx.runQuery).toHaveBeenCalledTimes(2);
    expect(ctx.runMutation).toHaveBeenCalledWith(
      component.unified.assignRoleUnified,
      // Assigned scope is the first (most specific) link of the chain, not the whole chain.
      expect.objectContaining({ role: "manager", scope: { type: "restaurant", id: "r1" } })
    );
  });

  it("does not enforce anything when assignableRoles is not configured (backward compatible)", async () => {
    const component = createMockComponent();
    const authz = new Authz(component, { permissions, roles, tenantId: "test-tenant" });
    const ctx = {
      runQuery: vi.fn(),
      runMutation: vi.fn().mockResolvedValue("assignment_id"),
    };

    await authz.assignRole(ctx, "user_1", "org_admin", { type: "restaurant", id: "r1" });

    expect(ctx.runQuery).not.toHaveBeenCalled();
    expect(ctx.runMutation).toHaveBeenCalled();
  });
});
