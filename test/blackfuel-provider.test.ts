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

globalThis.fetch = (async (url: string, init: RequestInit) => {
	fetched = { url, auth: (init.headers as Record<string, string>).Authorization };
	return Response.json({ object: "list", data: [{ id: "m", object: "model", created: 0, owned_by: "x" }] });
}) as typeof fetch;

beforeEach(() => {
	for (const name of ENV_VARS) delete process.env[name];
	agentDir = mkdtempSync(join(tmpdir(), "pi-blackfuel-"));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	fetched = undefined;
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
