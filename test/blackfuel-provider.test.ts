// Checks key resolution end to end: the key the extension fetches /v1/models
// with, and the key pi's own registry resolves for inference requests.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/blackfuel-provider.ts";

const ENV_VARS = ["BLACKFUEL_API_KEY", "OPENAI_API_KEY"];
let agentDir: string;
let fetched: { url: string; auth: string } | undefined;
let listed: object[];

globalThis.fetch = (async (url: string, init: RequestInit) => {
	fetched = { url, auth: (init.headers as Record<string, string>).Authorization };
	return Response.json({ object: "list", data: listed });
}) as typeof fetch;

beforeEach(() => {
	for (const name of ENV_VARS) delete process.env[name];
	agentDir = mkdtempSync(join(tmpdir(), "pi-blackfuel-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	fetched = undefined;
	listed = [{ id: "m", object: "model", created: 0, owned_by: "x" }];
});

function storeKeys(keys: Record<string, string>) {
	const data = Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, { type: "api_key", key }]));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify(data));
}

// Runs the extension against pi's real registry; returns [fetch key, request key].
async function resolve(): Promise<[string | undefined, string | undefined]> {
	const runtime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(agentDir, "models-store.json"),
	});
	const registry = new ModelRegistry(runtime);
	await extension({ registerProvider: (name: string, config: never) => registry.registerProvider(name, config) } as never);
	if (fetched) assert.equal(fetched.url, "https://api.blackfuel.ai/v1/models");
	return [fetched?.auth.replace("Bearer ", ""), await registry.getApiKeyForProvider("blackfuel")];
}

test("only BLACKFUEL_API_KEY", async () => {
	process.env.BLACKFUEL_API_KEY = "bf-env";
	assert.deepEqual(await resolve(), ["bf-env", "bf-env"]);
});

test("only OPENAI_API_KEY", async () => {
	process.env.OPENAI_API_KEY = "oa-env";
	assert.deepEqual(await resolve(), ["oa-env", "oa-env"]);
});

test("env order: BLACKFUEL_API_KEY > OPENAI_API_KEY", async () => {
	process.env.OPENAI_API_KEY = "oa-env";
	assert.deepEqual(await resolve(), ["oa-env", "oa-env"]);
	process.env.BLACKFUEL_API_KEY = "bf-env";
	assert.deepEqual(await resolve(), ["bf-env", "bf-env"]);
});

test("blackfuel stored key wins over env", async () => {
	storeKeys({ blackfuel: "bf-stored" });
	process.env.BLACKFUEL_API_KEY = "bf-env";
	assert.deepEqual(await resolve(), ["bf-stored", "bf-stored"]);
});

test("no key: provider not registered", async () => {
	assert.deepEqual(await resolve(), [undefined, undefined]);
});

// Registers the given /v1/models entries; returns the models pi received.
async function register(data: object[]) {
	process.env.BLACKFUEL_API_KEY = "bf-env";
	listed = data;
	let models: { id: string; name: string; cost: object }[] = [];
	await extension({ registerProvider: (_: string, config: { models: typeof models }) => (models = config.models) } as never);
	return models;
}

const base = { object: "model", created: 0, owned_by: "blackfuel", task: "text-generation" };

test("pricing: per-token USD strings become per-million-token cost", async () => {
	const [model] = await register([
		{ ...base, id: "k", pricing: { prompt: "0.00000014", completion: "0.000015", input_cache_read: "0.000000028" } },
	]);
	assert.deepEqual(model.cost, { input: 0.14, output: 15, cacheRead: 0.028, cacheWrite: 0 });
});

test("non text-generation models are not registered", async () => {
	const models = await register([
		{ ...base, id: "chat" },
		{ ...base, id: "embed", task: "embedding" },
	]);
	assert.deepEqual(models.map((m) => m.id), ["chat"]);
});

test("deprecated model names carry the sunset date and successor", async () => {
	const [model] = await register([
		{
			...base,
			id: "old",
			name: "Old",
			lifecycle: "deprecated",
			deprecation: { sunset: "2026-10-03T00:00:00Z", successor: "new" },
		},
	]);
	assert.equal(model.name, "Old (deprecated, sunset 2026-10-03, use new)");
});
