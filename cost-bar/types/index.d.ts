export type Entry = { at: number; usd: number; model: string; read: number; input: number; isPriced: boolean; out?: number; ctx?: number }

declare module 'claude-code' {
  interface PluginState {
    'cost-bar': { ledger: Entry[]; isShown: boolean }
  }
}
