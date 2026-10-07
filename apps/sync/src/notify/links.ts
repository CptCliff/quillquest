/** Deep links that land on the right thing. The web app reads these query parameters and opens the matching tab, card or paragraph. */
export const link = {
  story: (campaign: string, paragraphId?: string | null) => `/story/${campaign}${paragraphId ? `?para=${encodeURIComponent(paragraphId)}` : ''}`,
  card: (campaign: string, id: string) => `/story/${campaign}?card=${encodeURIComponent(id)}`,
  battle: (campaign: string, id: string) => `/story/${campaign}?battle=${encodeURIComponent(id)}`,
  tab: (campaign: string, tab: 'create' | 'codex' | 'director' | 'roster' | 'ledger') => `/story/${campaign}?tab=${tab}`,
};
