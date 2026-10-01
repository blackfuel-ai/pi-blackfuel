# pi-blackfuel

A [pi](https://pi.dev) extension that dynamically registers all [Blackfuel](https://blackfuel.ai) models as a provider. Models are fetched live on startup, so new model releases appear automatically.

## Installation

```bash
pi install git:github.com/blackfuel-ai/pi-blackfuel
```

The extension auto-discovers on next pi startup — no `/reload` needed.

## Setup

Get an API key at [console.blackfuel.ai](https://console.blackfuel.ai).

**Recommended — log in from inside pi:**

1. Run `/login`
2. Choose **Use an API key**
3. Select **Blackfuel**
4. Paste your key when prompted

pi stores the key in `~/.pi/agent/auth.json`, so you only do this once.

### Alternative: environment variable

```bash
export BLACKFUEL_API_KEY=bf_your_key_here
```

The extension reads the key stored via `/login` first, then falls back to `BLACKFUEL_API_KEY`.

## Usage

Verify the models are available:

```bash
pi --list-models
```

You should see all Blackfuel models listed under the `blackfuel` provider.

Select a model via the model selector (`Ctrl+P`) or by typing:

```
/model blackfuel
```

### What is registered

Only text-generation models are registered; embedding models in `/v1/models` are left out because pi can only use chat models. Each model carries its Blackfuel pricing, so pi's usage footer shows real cost. A deprecated model's name carries its sunset date and successor, e.g. `Llama-3.3-70B-Instruct (deprecated, sunset 2026-10-03, use deepseek-ai/DeepSeek-V4-Flash-0731)`.

### Thinking levels

Models that accept `reasoning_effort` get pi thinking levels, selected with `/thinking`. Only the efforts a model lists in `/v1/models` are offered: Kimi K3, for example, offers `low`, `high` and `max`, and has no `off`.

## Update

```bash
pi update
```

Or after upgrading, run `/reload` in pi.
