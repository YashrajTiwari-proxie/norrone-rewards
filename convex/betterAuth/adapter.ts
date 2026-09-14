import { createApi } from "@convex-dev/better-auth";
import schema from "./schema";
import { createAuthOptions } from "../auth";

// Registers the betterAuth component's actual create/findOne/findMany/
// updateOne/updateMany/deleteOne/deleteMany Convex functions — without
// this file, components.betterAuth in the generated api has no `adapter`
// property, and createClient (auth.ts) fails to type-check against it.
export const { create, findOne, findMany, updateOne, updateMany, deleteOne, deleteMany } = createApi(
	schema,
	createAuthOptions
);
