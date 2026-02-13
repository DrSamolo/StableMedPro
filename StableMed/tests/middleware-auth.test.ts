import { test } from "node:test";
import assert from "node:assert/strict";

import { isAdminRole, resolveAdminGuardDecision, resolveProtectedRouteDecision } from "../lib/server/admin-access.ts";

test("non-admin routes pass through even without session", () => {
  const decision = resolveAdminGuardDecision({
    pathname: "/dashboard",
    isAuthenticated: false,
  });

  assert.equal(decision, "allow");
});

test("admin routes redirect anonymous users to login", () => {
  const decision = resolveAdminGuardDecision({
    pathname: "/admin",
    isAuthenticated: false,
  });

  assert.equal(decision, "redirect_login");
});

test("admin routes allow authenticated admins", () => {
  const decision = resolveAdminGuardDecision({
    pathname: "/admin/settings",
    isAuthenticated: true,
    profileRole: "admin",
  });

  assert.equal(decision, "allow");
});

test("admin routes reject authenticated non-admin profiles", () => {
  const managerDecision = resolveAdminGuardDecision({
    pathname: "/admin/users",
    isAuthenticated: true,
    profileRole: "manager",
  });

  const unknownDecision = resolveAdminGuardDecision({
    pathname: "/admin/users",
    isAuthenticated: true,
    profileRole: "owner",
  });

  assert.equal(managerDecision, "redirect_unauthorized");
  assert.equal(unknownDecision, "redirect_unauthorized");
});

test("admin role parsing is normalized and strict", () => {
  assert.equal(isAdminRole(" ADMIN "), true);
  assert.equal(isAdminRole("manager"), false);
  assert.equal(isAdminRole(null), false);
});

test("dashboard routes require authentication in protected-route guard", () => {
  const anonymous = resolveProtectedRouteDecision({
    pathname: "/dashboard/leads",
    isAuthenticated: false,
  });
  const authenticated = resolveProtectedRouteDecision({
    pathname: "/dashboard/leads",
    isAuthenticated: true,
  });

  assert.equal(anonymous, "redirect_login");
  assert.equal(authenticated, "allow");
});
