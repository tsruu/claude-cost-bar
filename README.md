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

## What switching models does to the cache

Each model keeps its own prompt cache, and a cache expires after its lifetime. So a model's **first** request after you switch to it is cold: the whole conversation is written to its cache at its cache-write price. What happens to the cache you *left* depends on where you went.

These are observations from the author's own saved sessions (a small sample, not a guarantee), and the band's next-prompt estimate is built on them:

| Switch | What was observed |
|---|---|
| **Claude → GPT** | The GPT model starts cold. The Claude cache is untouched: after returning, the Claude model read about as much from cache as before (274k before and 274k after in one session, 72k and 75k in another). |
| **GPT → Claude** | Free if the Claude cache is still within its lifetime and no *other* Claude model answered in between. If it had expired, the whole conversation was re-written. |
| **Claude → Claude** | The new model starts cold, and the model you left **loses most of its cache**. A Sonnet → Opus → Sonnet round trip went from 292k tokens read to 52k read, and re-wrote about 248k (roughly $1 on Sonnet). Opus → Sonnet → Opus looked the same. The likely cause is that thinking blocks written by one Claude model can't be read by another, but that is not proven. |
| **GPT → GPT** | The new model starts cold (three conversations: 127k, 115k and 45k tokens written on the first request), then warms up. Whether the first GPT model's cache survives the detour was **not tested**; the band assumes it does. |

What this means in practice:

- A detour through a GPT model is the cheap way to get a second opinion: it leaves your Claude cache alone. A second *Claude* model does not.
- The cost of a switch is the whole context times the target's cache-write price, so switch early or after compacting.
- Over an hour away (or five minutes, on a 5-minute cache), everything is cold again.

The next-prompt estimate also adds an average output size and number of tool steps from your last few turns on the same model. It does not include the length of the prompt you are about to type.

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
