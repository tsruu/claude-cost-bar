# claude-cost-bar

A [Claude Code mod](https://claude.com/blog/claude-code-mods) that adds a live **spend and context band above the prompt**. Type `/spend` to show it, click ✕ to hide it. It is built for people who switch between models (Claude and GPT through an Azure/OpenAI-compatible proxy) and want to see what each prompt will really cost, including the cache.

![The /spend band: session spend, per-model costs, context bar and next-prompt estimate](docs/band.png)

## What it shows

- **Spend:** session total, spend in the last 10 minutes, and cache-hit %.
- **Per model:** one row per model with its cost and share of the total, so mid-session model switches add up correctly.
- **Context:** a rounded, full-width bar split into messages, MCP tools, system tools, system prompt and other, coloured like `/usage`, with token counts.
- **Next prompt:** an estimate of what your next prompt will cost, and whether the cache is **warm** (with time left) or **cold** (and how much would be re-cached).

Each turn is priced from the API's own token counts: uncached input, output, cache reads and cache writes, each at the rate of the model that answered. Subagent turns are counted too.

## Install

In Claude Code (CLI or desktop app):

```
/plugin marketplace add tsruu/claude-cost-bar
/plugin install cost-bar@trishan-mods
```

Start a new session and type `/spend`. That's it: the defaults work for most people. (Plugins load when a session starts, so chats that were already open need a restart.)

On a remote host (SSH sessions run Claude Code on that machine), install it there too.

## Settings

Open `/plugin`, pick **cost-bar** and change the settings. No file editing needed.

| Setting | Default | What it does |
|---|---|---|
| Claude cache lifetime | `1h` | `1h` or `5m`. This sets the warm/cold timer and the cache-write price. Claude Code reportedly uses 1h on a Claude subscription and 5m on an API key (unless `ENABLE_PROMPT_CACHING_1H` is set). If the "cold" warnings look wrong, try the other value. |
| GPT cache lifetime (hours) | `24` | How long an idle GPT cache counts as warm. Azure documents 24h for newer models; OpenAI's in-memory cache is minutes. |
| Recent-spend window (minutes) | `10` | The "last N minutes" figure. |
| Custom prices (JSON) | empty | Override or add a model, USD per 1M tokens. Matched by part of the model id. Example: `{"gpt-6-sol":{"input":2,"output":10,"read":0.2,"write":2.5}}` |

Optional fields for a custom price: `longAt` (token count where a higher tier starts) and `long` (that tier's `input`, `output`, `read`, `write`).

A model that isn't in the built-in table and has no custom price is counted as $0, and the band says so.

## How the cache estimate works

Caches are per model, and a cache expires after its time-to-live. The estimate follows what I measured in real saved sessions:

- Switching to a model that has not answered yet starts **cold**: the whole context is written at that model's cache-write price.
- A detour through a **GPT** model leaves a Claude cache intact.
- A turn from a **different Claude** model breaks the Claude cache you left: only the system prompt, tools and MCP prefix are read back, and the rest is re-written. A Sonnet → Opus → Sonnet round trip re-cached ~250k tokens in my logs.
- The estimate adds an average output size and number of tool steps from your last few turns on the same model. It does not include the length of the prompt you are about to type.

## Prices and assumptions

All figures are **API-equivalent estimates, not a bill**.

- Built-in Claude prices come from Anthropic's published pricing page; cache writes assume the 1-hour rate unless you change the setting.
- The built-in GPT-6 prices are from a third-party aggregator that reads the Azure Retail Prices API. Microsoft's own pricing page did not list them when this was written. Check them against your own Azure pricing, and override with *Custom prices* if they differ (Data Zone and Flex rates, for example, are different).
- Long-context tiers are included for GPT-6 (above 272k tokens) and Claude Haiku 5.5 (above 100k).
- Requests that fail (for example rate-limit errors) report no usage and count as $0.
- The built-in table is in [`cost-bar/hooks/register.tsx`](cost-bar/hooks/register.tsx) if you'd rather edit it there.

## Limits

- Totals are per session and reset when the session id changes (for example after a rewind or restart).
- Typing `/spend` leaves the command line in the chat. A mod can hide its output but not the typed command.
- Tested on Claude Code 2.1.308 (desktop app). Mods are new; the API may change.

## License

MIT
