import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";
import authz from "@proxie-studio/authz-tenant-kit/convex.config.js";

const app = defineApp();
app.use(betterAuth);
app.use(authz);

export default app;
