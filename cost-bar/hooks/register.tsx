import { atom, read, update } from 'claude-code'
import type { PluginOptions, Register } from 'claude-code'

import type { Entry } from '../types'

// Built-in prices, USD per 1M tokens. Claude `write` figures are for the 1-hour cache; the
// plugin setting `claudeCache` rescales them for a 5-minute cache. To change or add a price
// without editing this file, use the `customPrices` setting.
type Price = { input: number; output: number; read: number; write: number; long?: Omit<Price, 'long' | 'longAt'>; longAt?: number }

// Azure bills the whole request at the long-context meter above this many input tokens.
const LONG_CONTEXT = 272_000

// Matched by substring, first hit wins, so the longer ids come first.
const PRICES: Array<[string, Price]> = [
  ['fable-5-1', { input: 10, output: 50, read: 0.25, write: 20 }],
  ['fable-5', { input: 10, output: 50, read: 1, write: 20 }],
  ['opus-5-5', { input: 4, output: 20, read: 0.2, write: 8 }],
  ['opus-5', { input: 5, output: 25, read: 0.5, write: 10 }],
  ['opus-4', { input: 5, output: 25, read: 0.5, write: 10 }],
  ['sonnet-5-5', { input: 2, output: 10, read: 0.1, write: 4 }],
  ['sonnet-5', { input: 2, output: 10, read: 0.2, write: 4 }],
  ['sonnet-4', { input: 3, output: 15, read: 0.3, write: 6 }],
  // Haiku 5.5 bills a request over 100K prompt tokens (cache reads and writes included) higher.
  ['haiku-5-5', { input: 0.1, output: 0.5, read: 0.01, write: 0.2, longAt: 100_000, long: { input: 0.5, output: 2.5, read: 0.05, write: 1 } }],
  ['haiku-4', { input: 1, output: 5, read: 0.1, write: 2 }],
  // Azure Global Standard, from azurespeed.com (reads the Azure Retail Prices API; meters
  // effective 2026-09-01). Microsoft's own pricing page still shows "$-" for these models.
  ['gpt-6.1-sol', { input: 2, output: 10, read: 0.1, write: 2.5, long: { input: 4, output: 15, read: 0.2, write: 5 } }],
  ['gpt-6-sol', { input: 2, output: 10, read: 0.2, write: 2.5, long: { input: 4, output: 15, read: 0.4, write: 5 } }],
  ['gpt-6-luna', { input: 0.1, output: 0.5, read: 0.01, write: 0.125, long: { input: 0.2, output: 0.75, read: 0.02, write: 0.25 } }],
]

// Settings from the plugin's userConfig (the /plugin config menu). Every field has a default.
const settings = (o: PluginOptions) => {
  let custom: Array<[string, Price]> = []
  let isCustomBad = false
  try {
    const parsed = JSON.parse(String(o.customPrices || '{}'))
    custom = Object.entries(parsed).map(([id, v]) => [id.toLowerCase(), v as Price])
  } catch {
    isCustomBad = true
  }

  return {
    is5m: o.claudeCache === '5m',
    claudeTtl: (o.claudeCache === '5m' ? 5 : 60) * 60e3,
    gptTtl: Math.max(0.1, Number(o.gptCacheHours) || 24) * 3600e3,
    windowMs: Math.max(1, Number(o.windowMinutes) || 10) * 60e3,
    custom,
    isCustomBad,
  }
}
type Settings = ReturnType<typeof settings>

const ttlOf = (model: string, cfg: Settings) => (model.includes('gpt') ? cfg.gptTtl : cfg.claudeTtl)

const ledger = atom({ plugin: 'cost-bar', key: 'ledger' } as const, [])
const isShown = atom({ plugin: 'cost-bar', key: 'isShown' } as const, false)

// Custom prices win, then the built-in table. A Claude model on a 5-minute cache writes at
// 1.25x input instead of 2x, so its write rates scale by 0.625.
const priceOf = (model: string, cfg: Settings): Price | undefined => {
  const id = model.toLowerCase()
  const hit = cfg.custom.find(([k]) => id.includes(k))?.[1] ?? PRICES.find(([k]) => id.includes(k))?.[1]
  if (!hit || !cfg.is5m || id.includes('gpt') || cfg.custom.some(([k]) => id.includes(k))) return hit

  return {
    ...hit,
    write: hit.write * 0.625,
    long: hit.long && { ...hit.long, write: hit.long.write * 0.625 },
  }
}

const usd = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)
const short = (model: string) => model.replace(/^.*\//, '')
// The picker's id (ocx-claude-azure--gpt-6-luna[1m]) and the API's (gpt-6-luna) name one model.
const key = (model: string) => model.toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/^.*(--|\/)/, '')
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`)
const mins = (ms: number) => (ms >= 3600e3 ? `${Math.floor(ms / 3600e3)}h ${Math.round((ms % 3600e3) / 60e3)}m` : `${Math.max(1, Math.round(ms / 60e3))}m`)

export const register: Register = (on, options) => {
  const cfg = settings(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spend',
      description: 'Show or hide the live API-cost band above the prompt',
    })

    return next(e)
  })

  on('command.run', { command: 'spend' }, async $ => {
    const next = !(await read($, isShown))
    await update($, isShown, () => next)

    return {}
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      const base = priceOf(u.model, cfg)
      // The turn's usage is summed over its requests; the context size now is the best
      // stand-in for the biggest request's input.
      const context = (await $.session.usage()).context.tokens ?? 0
      const p = base && base.long && context > (base.longAt ?? LONG_CONTEXT) ? base.long : base
      const cost = p
        ? (u.input_tokens * p.input +
            u.output_tokens * p.output +
            u.cache_read_input_tokens * p.read +
            u.cache_creation_input_tokens * p.write) /
          1e6
        : 0
      const entry: Entry = {
        at: await $.clock.now(),
        usd: cost,
        model: u.model,
        read: u.cache_read_input_tokens,
        input: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
        isPriced: base !== undefined,
        out: u.output_tokens,
        ctx: context,
      }
      await update($, ledger, list => [...list, entry].slice(-2000))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) {
      return next(e)
    }

    const list = await read($, ledger)
    const now = await $.clock.now()
    const total = list.reduce((s, x) => s + x.usd, 0)
    const recent = list.filter(x => now - x.at <= cfg.windowMs).reduce((s, x) => s + x.usd, 0)
    const input = list.reduce((s, x) => s + x.input, 0)
    const cached = list.reduce((s, x) => s + x.read, 0)
    const hit = input > 0 ? Math.round((cached / input) * 100) : 0
    const unpriced = [...new Set(list.filter(x => !x.isPriced).map(x => short(x.model)))]

    const byModel = new Map<string, number>()
    for (const x of list) byModel.set(key(x.model), (byModel.get(key(x.model)) ?? 0) + x.usd)

    // What the next prompt is expected to cost, from the live context and recent turns.
    const usage = await $.session.usage({ breakdown: 'summary' })
    const ctxTokens = usage.context.tokens ?? 0
    const ctxWindow = usage.context.window
    const model = await $.session.model()
    const base = priceOf(model, cfg)
    const p = base && base.long && ctxTokens > (base.longAt ?? LONG_CONTEXT) ? base.long : base
    const mine = list.filter(x => key(x.model) === key(model))
    const last = mine.length > 0 ? mine[mine.length - 1] : undefined
    const idle = last ? now - last.at : Infinity
    const ttl = ttlOf(model, cfg)
    const isWarm = idle < ttl
    const recentTurns = mine.slice(-8)
    const avgOut = recentTurns.length ? recentTurns.reduce((s, x) => s + (x.out ?? 0), 0) / recentTurns.length : 0
    const avgSteps = recentTurns.length
      ? recentTurns.reduce((s, x) => s + Math.max(1, Math.round(x.input / Math.max(x.ctx ?? x.input, 1))), 0) / recentTurns.length
      : 1
    // A warm cache holds the prefix as of this model's last turn; whatever the conversation
    // gained since (another model's turns, a pasted file) is written fresh. Measured on
    // saved sessions: a detour through a GPT model leaves a Claude cache intact, but another
    // Claude model's turn does not (thinking blocks are bound to the model that wrote them),
    // so only the system prompt, tools and MCP prefix is read back.
    const isClaude = key(model).startsWith('claude')
    const lastIdx = last ? list.lastIndexOf(last) : -1
    const intruder = isClaude && lastIdx >= 0
      ? list.slice(lastIdx + 1).find(x => key(x.model).startsWith('claude') && key(x.model) !== key(model))
      : undefined
    const floor = (usage.context.breakdown?.categories ?? [])
      .filter(c => !c.isDeferred && /^(System prompt|System tools|MCP tools|MCP server instructions)$/.test(c.name))
      .reduce((s, c) => s + c.tokens, 0)
    const cachedPrefix = !isWarm ? 0 : intruder ? Math.min(floor, ctxTokens) : Math.min(last?.ctx ?? ctxTokens, ctxTokens)
    const estimate = p && ctxTokens > 0
      ? (cachedPrefix * p.read +
          (ctxTokens - cachedPrefix) * p.write +
          (avgSteps - 1) * ctxTokens * p.read +
          avgOut * p.output) / 1e6
      : undefined
    const fresh = ctxTokens - cachedPrefix

    const pct = ctxWindow > 0 ? Math.min(100, Math.round((ctxTokens / ctxWindow) * 100)) : 0

    // Context groups, coloured to match /usage so the two read alike.
    const cats = (usage.context.breakdown?.categories ?? []).filter(c => !c.isDeferred)
    const sum = (pick: (name: string) => boolean) =>
      cats.filter(c => pick(c.name)).reduce((s, c) => s + c.tokens, 0)
    const groups: Array<{ label: string; tokens: number; color: string }> = [
      { label: 'messages', tokens: sum(n => n === 'Messages'), color: '#4a8af4' },
      { label: 'MCP tools', tokens: sum(n => n === 'MCP tools'), color: '#e07b39' },
      { label: 'system tools', tokens: sum(n => n === 'System tools'), color: '#3fae8a' },
      { label: 'system prompt', tokens: sum(n => n === 'System prompt'), color: '#d6a232' },
      {
        label: 'other',
        tokens: sum(n => !/^(Messages|MCP tools|System tools|System prompt)$|free|buffer/i.test(n)),
        color: '#9a9a9a',
      },
      { label: 'buffer', tokens: sum(n => /buffer/i.test(n)), color: '#5c5c5c' },
    ].filter(g => g.tokens > 0)
    const TRACK = '#2c2c2c'
    const inner = Math.max(20, e.props.bodyColumns - 4)
    const hasRoom = inner >= 70

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const Svg = e.surface === 'terminal' ? undefined : ui.Svg

    // A rounded, proportional bar. SVG on the desktop; coloured cells in a terminal.
    const barW = 1600
    const barH = 22
    let x = 0
    const rects = groups
      .map(g => {
        const w = Math.max(6, (g.tokens / Math.max(ctxWindow, 1)) * barW)
        const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${barH}" fill="${g.color}"/>`
        x += w
        return r
      })
      .join('')
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${barW}" height="${barH}" viewBox="0 0 ${barW} ${barH}">` +
      `<defs><clipPath id="c"><rect width="${barW}" height="${barH}" rx="${barH / 2}"/></clipPath></defs>` +
      `<g clip-path="url(#c)"><rect width="${barW}" height="${barH}" fill="${TRACK}"/>${rects}</g></svg>`
    const cellsTotal = Math.max(10, inner)
    const cellBar = groups.map(g => ({
      color: g.color,
      n: Math.max(1, Math.round((g.tokens / Math.max(ctxWindow, 1)) * cellsTotal)),
    }))
    const used = cellBar.reduce((s, c) => s + c.n, 0)

    const hitColor = hit >= 80 ? '#5fd7a0' : hit >= 50 ? '#e5c07b' : '#e06c75'

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="#4b5263" paddingX={1}>
        <Box justifyContent="space-between">
          <Box>
            <Text color="#56b6c2" bold>◆ spend </Text>
            <Text color="#5fd7a0" bold>{usd(total)}</Text>
            <Text dimColor> session   </Text>
            <Text color="#e5c07b" bold>{usd(recent)}</Text>
            <Text dimColor> last {Math.round(cfg.windowMs / 60e3)}m   </Text>
            <Text color={hitColor} bold>{hit}%</Text>
            <Text dimColor> cache hit</Text>
          </Box>
          <Button key="close" label="✕" onPress={() => update($, isShown, () => false)} />
        </Box>
        {byModel.size > 0 && (
          <Box flexDirection="column">
            {[...byModel].sort((x, y) => y[1] - x[1]).map(([m, c]) => (
              <Box>
                <Text dimColor>{m}  </Text>
                <Text color="#c678dd" bold>{usd(c)}</Text>
                <Text dimColor>  {total > 0 ? Math.round((c / total) * 100) : 0}%</Text>
              </Box>
            ))}
          </Box>
        )}
        {ctxTokens > 0 && (
          <Box flexDirection="column">
            <Box justifyContent="space-between">
              <Box>
                <Text dimColor>context </Text>
                <Text bold>{tok(ctxTokens)}</Text>
                <Text dimColor> / {tok(ctxWindow)} · </Text>
                <Text bold>{pct}%</Text>
              </Box>
              {estimate !== undefined && (
                <Box>
                  <Text dimColor>next prompt </Text>
                  <Text color="#e5c07b" bold>≈ {usd(estimate)}</Text>
                  {isWarm && intruder ? (
                    <Text color="#e06c75"> · {short(intruder.model)} broke the cache, re-caching {tok(fresh)}</Text>
                  ) : isWarm ? (
                    <Text color="#5fd7a0"> · warm {mins(ttl - idle)} left{fresh > 1000 ? `, ${tok(fresh)} new` : ''}</Text>
                  ) : (
                    <Text color="#e06c75"> · cold{last ? ` (idle ${mins(idle)})` : ' (no turns on this model yet)'}, caching {tok(ctxTokens)}</Text>
                  )}
                </Box>
              )}
            </Box>
            {Svg ? (
              <Svg source={svg} alt={`context ${pct}% full`} />
            ) : (
              <Box>
                {cellBar.map(c => (
                  <Text backgroundColor={c.color}>{' '.repeat(c.n)}</Text>
                ))}
                <Text backgroundColor={TRACK}>{' '.repeat(Math.max(0, cellsTotal - used))}</Text>
              </Box>
            )}
            {hasRoom && (
              <Box>
                {groups.filter(g => g.label !== 'buffer').map((g, i) => (
                  <Text>
                    <Text dimColor>{i > 0 ? '   ' : ''}</Text>
                    <Text color={g.color}>{g.label} {tok(g.tokens)}</Text>
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        )}
        {cfg.isCustomBad && (
          <Text color="#e06c75">cost-bar: the customPrices setting is not valid JSON, so it was ignored</Text>
        )}
        {unpriced.length > 0 && (
          <Text color="#e5c07b">no price for {unpriced.join(', ')} (counted as $0)</Text>
        )}
      </Box>
    )
  })
}
