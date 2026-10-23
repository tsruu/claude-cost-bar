# claude-cost-bar

A [Claude Code mod](https://claude.com/blog/claude-code-mods) that adds a live **spend and context band above the prompt**. Type `/spend` to show it, click ✕ to hide it. It is built for people who switch between models (Claude and GPT through an Azure/OpenAI-compatible proxy) and want to see what each prompt will really cost, including the cache.

![The /spend band across three models (Opus 5.5, GPT-6 Sol, Sonnet 5.5): session spend, per-model costs, context bar and next-prompt estimate](docs/band.png)

*The spend, per-model costs and context bar are measured. The next-prompt line is only a guess: here it says "warm" right after a switch, and the real request turned out to re-write most of the cache. See [below](#what-switching-models-does-to-the-cache).*

## What it shows

- **Spend:** session total, spend in the last 10 minutes, and cache-hit %.
- **Per model:** one row per model with its cost and share of the total, so mid-session model switches add up correctly.
- **Context:** a rounded, full-width bar split into messages, MCP tools, system tools, system prompt and other, coloured like `/usage`, with token counts.
- **Next prompt:** a *guess* at what your next prompt will cost, and whether the cache looks **warm** (with time left) or **cold**. It is based on timers and on what the author observed, and a model switch can lose a cache the timer says is still good (see below).

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

Each model keeps its own prompt cache, and a cache expires after its lifetime (1 hour in the author's account; the plugin settings let you change it). So the **first** request after you switch to a model is cold: the whole conversation is written to its cache at its cache-write price, which is the expensive part of a switch.

What happens to the cache you *left* is less clear. These are observations from the author's own saved sessions, a small sample. They don't add up to a rule, so the band's next-prompt number is a guess:

| Situation | What was observed |
|---|---|
| Claude → GPT → back to the same Claude model (one simple prompt on the GPT model) | The Claude cache survived. Two sessions: 274k tokens read before and after, and 72k before and 75k after. |
| Opus → Sonnet → Opus (short chat; the Sonnet turn did no thinking) | The Opus cache survived: 77k tokens read, 1.6k written. |
| Sonnet → Opus → Sonnet (long chat; Opus had thinking turns) | The Sonnet cache was mostly lost: 292k read before, 52k after, about 248k re-written (roughly $1 on Sonnet). |
| Opus → GPT-6 Sol and GPT-6.1 Sol (several turns, including tool and skill calls) → back to Opus | The Opus cache was lost: only 52k read and 76k re-written, in a request that had grown from 79k to 128k tokens. The saved request shows the first message of the conversation changed, so everything after it missed the cache. Why it changed is not known. |
| GPT → GPT | The new model starts cold (three conversations: 127k, 115k and 45k tokens written on the first request), then warms up. Whether the first GPT model's cache survives the detour was not tested. |

Possible causes for the lost caches, none proven: thinking blocks that one model can't read from another, and tool or skill activity during the detour changing early messages. A plain time-out was ruled out in the last two cases above, since the 1-hour lifetime had not passed.

Other things worth knowing:

- GPT models count tokens differently. For the same conversation one GPT model reported about 50k tokens where Claude counted 79k. The band's context figure comes from the last reply, so right after a GPT turn it shows the GPT count, not what Claude will see.
- The band currently assumes that a turn from a *different Claude model* breaks the cache you left, and that a GPT detour doesn't. The observations above show both assumptions can be wrong, which is why the next-prompt number is a guess.
- The cost of a cold switch is the whole context times the target model's cache-write price, so switching early, or after compacting, costs least. Sticking to one model per conversation is the safest.
- After more than the cache lifetime away, everything is cold again.

## Prices and assumptions

All figures are **API-equivalent estimates, not a bill**.

- Built-in Claude prices come from Anthropic's published pricing page; cache writes assume the 1-hour rate unless you change the setting.
- The built-in GPT-6 prices are from a third-party aggregator that reads the Azure Retail Prices API. Microsoft's own pricing page did not list them when this was written. Check them against your own Azure pricing, and override with *Custom prices* if they differ (Data Zone and Flex rates, for example, are different).
- Long-context tiers are included for GPT-6 (above 272k tokens) and Claude Haiku 5.5 (above 100k).
- Requests that fail (for example rate-limit errors) report no usage and count as $0.
- The built-in table is in [`cost-bar/hooks/register.tsx`](cost-bar/hooks/register.tsx) if you'd rather edit it there.

## Limits

- The next-prompt estimate can be badly wrong after a model switch (see above). Spend, per-model costs and the context breakdown are measured from the API's own token counts.
- Totals are per session and reset when the session id changes (for example after a rewind or restart).
- Typing `/spend` leaves the command line in the chat. A mod can hide its output but not the typed command.
- Tested on Claude Code 2.1.308 (desktop app). Mods are new; the API may change.

## License

MIT
