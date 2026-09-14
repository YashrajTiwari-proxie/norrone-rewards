import { authComponent } from "./auth";

// Internal mutations the user.onDelete trigger (convex/auth.ts) runs in.
// Kept in their own file: referencing internal.authTriggers.* from inside
// auth.ts's own initializer is a circular type (the generated api's type
// depends on this file's exports, which would depend on the api).
export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();
