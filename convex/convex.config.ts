import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";
import authz from "@proxie-studio/authz-tenant-kit/convex.config.js";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";

const app = defineApp();
app.use(betterAuth);
app.use(authz);
app.use(rateLimiter);

export default app;
