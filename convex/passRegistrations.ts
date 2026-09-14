import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Internal CRUD backing Apple's PassKit Web Service protocol
 * (convex/httpPassService.ts) and the push-update trigger
 * (convex/walletNode.ts's pushWalletUpdates). Device registration itself
 * isn't customer-identifying beyond the serialNumber (= customer id)
 * already in scope wherever these are called from.
 */

export const register = internalMutation({
	args: {
		deviceLibraryIdentifier: v.string(),
		passTypeIdentifier: v.string(),
		serialNumber: v.string(),
		pushToken: v.string()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("passRegistrations")
			.withIndex("by_device_type_serial", (q) =>
				q
					.eq("deviceLibraryIdentifier", args.deviceLibraryIdentifier)
					.eq("passTypeIdentifier", args.passTypeIdentifier)
					.eq("serialNumber", args.serialNumber)
			)
			.unique();

		if (existing) {
			if (existing.pushToken !== args.pushToken) await ctx.db.patch(existing._id, { pushToken: args.pushToken });
			return { alreadyRegistered: true };
		}

		await ctx.db.insert("passRegistrations", args);
		return { alreadyRegistered: false };
	}
});

export const unregister = internalMutation({
	args: {
		deviceLibraryIdentifier: v.string(),
		passTypeIdentifier: v.string(),
		serialNumber: v.string()
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("passRegistrations")
			.withIndex("by_device_type_serial", (q) =>
				q
					.eq("deviceLibraryIdentifier", args.deviceLibraryIdentifier)
					.eq("passTypeIdentifier", args.passTypeIdentifier)
					.eq("serialNumber", args.serialNumber)
			)
			.unique();
		if (existing) await ctx.db.delete(existing._id);
		return { found: existing !== null };
	}
});

/** Every serial this device has registered for this pass type — used for the "which passes changed" poll. */
export const listByDeviceAndType = internalQuery({
	args: { deviceLibraryIdentifier: v.string(), passTypeIdentifier: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("passRegistrations")
			.withIndex("by_device_type_serial", (q) =>
				q.eq("deviceLibraryIdentifier", args.deviceLibraryIdentifier).eq("passTypeIdentifier", args.passTypeIdentifier)
			)
			.collect();
		return rows.map((r) => r.serialNumber);
	}
});

/** Every device registered for one customer's pass — who to push to when their points/tier change. */
export const listBySerial = internalQuery({
	args: { serialNumber: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("passRegistrations")
			.withIndex("by_serial", (q) => q.eq("serialNumber", args.serialNumber))
			.collect();
	}
});

export const removeById = internalMutation({
	args: { id: v.id("passRegistrations") },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.id);
	}
});
