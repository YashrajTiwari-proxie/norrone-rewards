#!/usr/bin/env bun
/**
 * Concurrency + load smoke test against a REAL, live Convex deployment
 * (not convex-test's in-memory backend — this is specifically to exercise
 * Convex's actual optimistic-concurrency-control behavior under real
 * network timing, which an in-memory test harness can't reproduce).
 *
 * What it checks:
 *   1. Idempotency race: N concurrent PUT requests with the SAME
 *      idempotencyKey must apply exactly once.
 *   2. Duplicate-customer race: N concurrent creates with the SAME
 *      externalId must succeed exactly once (the rest 409).
 *   3. Coupon-redeem race: N concurrent redeems of the SAME coupon code
 *      must succeed exactly once (the rest ALREADY_REDEEMED).
 *   4. Throughput: latency percentiles for a burst of distinct customer
 *      creates.
 *
 * Usage:
 *   bun run scripts/stress-test.ts
 *   CONCURRENCY=50 bun run scripts/stress-test.ts
 *
 * Requires `npx convex dev` to have run at least once (so .env.local and
 * devTools:seedApiTestFixtures/seedCouponForRedeem are deployed) and seeds
 * its own fresh fixtures on every run — safe to run repeatedly against a
 * dev deployment, not meant to be pointed at production data.
 */

import { execSync } from "node:child_process";

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 20);
const BURST_SIZE = Number(process.env.BURST_SIZE ?? 50);

const envLocal = await Bun.file(".env.local").text();
const siteUrl = envLocal.match(/PUBLIC_CONVEX_SITE_URL=(.+)/)?.[1]?.trim();
if (!siteUrl) {
	console.error("Could not find PUBLIC_CONVEX_SITE_URL in .env.local — run `npx convex dev` first.");
	process.exit(1);
}

function convexRun(fn: string, args: Record<string, unknown> = {}): any {
	const out = execSync(`npx convex run ${fn} '${JSON.stringify(args)}'`, { encoding: "utf-8" });
	return JSON.parse(out);
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
	checks.push({ name, pass, detail });
	console.log(`${pass ? "✅" : "❌"} ${name} — ${detail}`);
}

console.log(`Seeding fixtures on ${siteUrl} ...`);
const fixtures = convexRun("devTools:seedApiTestFixtures");
const { shopId, plaintextKey: apiKey } = fixtures;
console.log(`Seeded org=${fixtures.organizationId} shop=${shopId}\n`);

function authedFetch(path: string, init: RequestInit = {}) {
	return fetch(new URL(path, siteUrl), {
		...init,
		headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers }
	});
}

// --- 1. Idempotency race ---------------------------------------------------
async function testIdempotencyRace() {
	const externalId = `idem-race-${Date.now()}`;
	await authedFetch(`/v1/shops/${shopId}/customers`, {
		method: "POST",
		body: JSON.stringify({ externalId })
	});

	const idempotencyKey = `key-${Date.now()}`;
	const requests = Array.from({ length: CONCURRENCY }, () =>
		authedFetch(`/v1/shops/${shopId}/customers/${externalId}`, {
			method: "PUT",
			body: JSON.stringify({ deltaSpend: 10, idempotencyKey })
		})
	);
	await Promise.all(requests);

	// Exactly one of the CONCURRENCY requests should have actually applied
	// the +10 delta — a broken idempotency guard would show a multiple of 10.
	const customer = convexRun("apiInternal:getCustomerByExternalId", { shopId, externalId });
	record(
		"Idempotency race (spend applied exactly once)",
		customer.totalSpend === 10,
		`totalSpend=${customer.totalSpend} after ${CONCURRENCY} concurrent PUTs with the same idempotencyKey (expected 10)`
	);
}

// --- 2. Duplicate-customer-create race -------------------------------------
async function testDuplicateCustomerRace() {
	const externalId = `dup-race-${Date.now()}`;
	const requests = Array.from({ length: CONCURRENCY }, () =>
		authedFetch(`/v1/shops/${shopId}/customers`, {
			method: "POST",
			body: JSON.stringify({ externalId })
		})
	);
	const responses = await Promise.all(requests);
	const statuses = responses.map((r) => r.status);
	const created = statuses.filter((s) => s === 201).length;
	const conflicted = statuses.filter((s) => s === 409).length;

	record(
		"Duplicate-customer race",
		created === 1 && conflicted === CONCURRENCY - 1,
		`${created}/${CONCURRENCY} returned 201, ${conflicted}/${CONCURRENCY} returned 409 (expected 1 and ${CONCURRENCY - 1})`
	);
}

// --- 3. Coupon-redeem race ---------------------------------------------------
async function testCouponRedeemRace() {
	const externalId = `coupon-race-${Date.now()}`;
	await authedFetch(`/v1/shops/${shopId}/customers`, { method: "POST", body: JSON.stringify({ externalId }) });
	const customer = convexRun("apiInternal:getCustomerByExternalId", { shopId, externalId });
	// Date.now()'s leading digits barely change within a session (they all
	// start "1789..." today) — slicing a Date.now()-based string down to a
	// short code silently collides run after run instead of varying. Use
	// real randomness instead (this bit me once already, in
	// devTools.seedCouponForRedeem's original hardcoded "TESTCODE1").
	const code = Math.random().toString(36).slice(2, 12).toUpperCase();
	convexRun("devTools:seedCouponForRedeem", { organizationId: fixtures.organizationId, customerId: customer._id, code });

	const requests = Array.from({ length: CONCURRENCY }, () =>
		authedFetch(`/v1/coupons/${code}/redeem`, { method: "POST" })
	);
	const responses = await Promise.all(requests);
	const succeeded = responses.filter((r) => r.status === 200).length;
	const alreadyRedeemed = responses.filter((r) => r.status === 409).length;

	record(
		"Coupon-redeem race",
		succeeded === 1 && alreadyRedeemed === CONCURRENCY - 1,
		`${succeeded}/${CONCURRENCY} redeemed, ${alreadyRedeemed}/${CONCURRENCY} got ALREADY_REDEEMED (expected 1 and ${CONCURRENCY - 1})`
	);
}

// --- 4. Throughput / latency burst ------------------------------------------
async function testThroughputBurst() {
	const start = Date.now();
	const latencies: number[] = [];
	await Promise.all(
		Array.from({ length: BURST_SIZE }, async (_, i) => {
			const t0 = Date.now();
			await authedFetch(`/v1/shops/${shopId}/customers`, {
				method: "POST",
				body: JSON.stringify({ externalId: `burst-${Date.now()}-${i}-${Math.random()}` })
			});
			latencies.push(Date.now() - t0);
		})
	);
	const totalMs = Date.now() - start;
	latencies.sort((a, b) => a - b);
	const p50 = latencies[Math.floor(latencies.length * 0.5)];
	const p95 = latencies[Math.floor(latencies.length * 0.95)];
	const max = latencies[latencies.length - 1];
	console.log(
		`ℹ️  Throughput: ${BURST_SIZE} concurrent creates in ${totalMs}ms (${((BURST_SIZE / totalMs) * 1000).toFixed(1)} req/s) — p50=${p50}ms p95=${p95}ms max=${max}ms`
	);
}

await testIdempotencyRace();
await testDuplicateCustomerRace();
await testCouponRedeemRace();
await testThroughputBurst();

console.log("");
const failed = checks.filter((c) => !c.pass);
if (failed.length > 0) {
	console.error(`${failed.length}/${checks.length} checks FAILED.`);
	process.exit(1);
} else {
	console.log(`All ${checks.length} concurrency checks passed.`);
}
