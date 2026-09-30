import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";

interface OpenAIModel {
	id: string;
	object: string;
	created: number;
	owned_by: string;
	name?: string;
	context_length?: number;
	supported_parameters?: string[];
	input_modalities?: string[];
	reasoning?: { supported_efforts?: string[] };
}

interface OpenAIModelsResponse {
	object: string;
	data: OpenAIModel[];
}

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// Pi's non-off thinking levels share their names with Blackfuel's reasoning_effort
// values; "off" is spelled "none" on the Blackfuel side.
const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

// Maps each pi thinking level to the effort Blackfuel accepts for this model, or
// null to hide it. Blackfuel rejects efforts a model does not list (Kimi K3 400s
// on "medium"), so an unlisted level must be hidden rather than passed through.
function thinkingLevelMap(efforts: string[]): Partial<Record<ThinkingLevel, string | null>> {
	const map: Partial<Record<ThinkingLevel, string | null>> = {
		off: efforts.includes("none") ? "none" : null,
	};
	for (const level of EFFORT_LEVELS) {
		map[level] = efforts.includes(level) ? level : null;
	}
	return map;
}

export default async function (pi: ExtensionAPI): Promise<void> {
	// pi 0.83.0 stopped exporting AuthStorage; readStoredCredential is the
	// supported one-off read of auth.json. Importing the old symbol threw at
	// load time, which took the whole ACP session down with
	// "Cannot call write after a stream was destroyed".
	const storedKey = (providerId: string) => {
		const credential = readStoredCredential(providerId);
		return credential && credential.type === "api_key" ? credential.key : undefined;
	};
	// OPENAI_API_KEY is the Blackfuel key everywhere else in our toolchain
	// (models.json, opencode, the copilot wrapper, the codex profile), so
	// accept it rather than making pi the one tool needing a separate var.
	// Track which var held it: the provider below resolves "$NAME" at request
	// time, so registering $BLACKFUEL_API_KEY while the key lives in
	// OPENAI_API_KEY would list models fine and then 401 on every call.
	const apiKeyEnvVar = ["BLACKFUEL_API_KEY", "OPENAI_API_KEY"].find(
		(name) => process.env[name],
	);
	const apiKey =
		storedKey("blackfuel") ?? (apiKeyEnvVar && process.env[apiKeyEnvVar]);
	if (!apiKey) {
		console.warn(
			"[blackfuel-provider] No API key found. Run /login, choose \"Use an API key\", and select Blackfuel — or set BLACKFUEL_API_KEY.",
		);
		return;
	}

	let models: OpenAIModel[];

	try {
		const response = await fetch("https://api.blackfuel.ai/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		});

		if (!response.ok) {
			console.warn(
				`[blackfuel-provider] Failed to fetch models from Blackfuel (HTTP ${response.status}). Provider will not be registered.`,
			);
			return;
		}

		const payload = (await response.json()) as OpenAIModelsResponse;

		if (!payload.data || !Array.isArray(payload.data)) {
			console.warn(
				"[blackfuel-provider] Unexpected response format from /v1/models. Provider will not be registered.",
			);
			return;
		}

		models = payload.data;
	} catch (error) {
		console.warn(
			`[blackfuel-provider] Failed to reach Blackfuel API: ${error instanceof Error ? error.message : String(error)}. Provider will not be registered.`,
		);
		return;
	}

	if (models.length === 0) {
		console.warn("[blackfuel-provider] No models returned from Blackfuel. Provider will not be registered.");
		return;
	}

	pi.registerProvider("blackfuel", {
		name: "Blackfuel",
		baseUrl: "https://api.blackfuel.ai/v1",
		// A key stored under "blackfuel" takes precedence over this at request
		// time. Stored keys use the same config-value syntax as apiKey, so the
		// legacy one passes through unchanged.
		apiKey: `$${apiKeyEnvVar ?? "BLACKFUEL_API_KEY"}`,
		api: "openai-completions",
		models: models.map((model) => {
			const supported = model.supported_parameters ?? [];
			const modalities = model.input_modalities ?? ["text"];
			// Pi's provider model config only represents "text" and "image" inputs;
			// any other modality reported by the API (e.g. "video") has no Pi equivalent.
			const supportedInput = (["text", "image"] as const).filter((m) =>
				modalities.includes(m),
			);
			const input: ("text" | "image")[] =
				supportedInput.length > 0 ? supportedInput : ["text"];
			// A non-positive context_length is treated as absent (0 would slip
			// through `?? ` and register a model with a zero token budget).
			const contextWindow =
				model.context_length && model.context_length > 0
					? model.context_length
					: 128000;
			// /v1/models advertises reasoning as the reasoning_effort parameter,
			// with the accepted values under reasoning.supported_efforts.
			const reasoning = supported.includes("reasoning_effort");
			const efforts = model.reasoning?.supported_efforts ?? [];
			return {
				id: model.id,
				name: model.name ?? model.id,
				reasoning,
				thinkingLevelMap:
					reasoning && efforts.length > 0 ? thinkingLevelMap(efforts) : undefined,
				input,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow,
				maxTokens: Math.min(16384, contextWindow),
				compat: {
					// Pi sends a reasoning model's system prompt under the
					// "developer" role, which Blackfuel rejects with a 400.
					supportsDeveloperRole: false,
					supportsReasoningEffort: reasoning,
				},
			};
		}),
	});
}
