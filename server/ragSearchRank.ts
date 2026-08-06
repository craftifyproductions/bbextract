/**
 * Hybrid rerank: vector similarity + lexical boosts from folder/subcategory/description.
 * Fixes cases where near-identical weapon labels bury the true class (sniper vs rifle vs shotgun).
 */

/** Class tokens that should outweigh generic "rifle/gun/weapon" overlap. */
const CLASS_TOKENS = new Set([
  'sniper',
  'shotgun',
  'minigun',
  'gatling',
  'pistol',
  'handgun',
  'smg',
  'lmg',
  'assault',
  'crossbow',
  'bow',
  'sword',
  'dagger',
  'launcher',
  'axe',
  'spear',
  'staff',
  'wand',
  'shield',
  'zombie',
  'skeleton',
  'creeper',
  'dragon',
  'fortress',
  'bastion',
  'castle',
  'tower',
  'villager',
  'chair',
  'table',
])

const GENERIC_TOKENS = new Set([
  'futuristic',
  'sci',
  'fi',
  'gun',
  'weapon',
  'rifle',
  'combat',
  'handheld',
  'energy',
  'metal',
  'glowing',
  'blue',
  'barrel',
  'grip',
  'trigger',
  'prop',
  'animated',
  'static',
  'laser',
])

export interface RankableMatch {
  id: string
  r2_folder_key: string
  description: string
  category: string
  subcategory: string | null
  has_animation: boolean
  has_metadata: boolean
  embedding_model: string | null
  confidence?: string | null
  similarity: number
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 2)
}

function stripHashSuffix(folderKey: string): string {
  const leaf = folderKey.replace(/\/+$/, '').split('/').pop() || folderKey
  return leaf.replace(/__[a-f0-9]{4,}$/i, '').replace(/_[a-f0-9]{8}$/i, '')
}

export function normalizeSearchQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hybridRerankMatches<T extends RankableMatch>(query: string, matches: T[]): T[] {
  const qTokens = tokenize(normalizeSearchQuery(query))
  if (!qTokens.length || matches.length <= 1) return matches

  const scored = matches.map((match) => {
    const folder = stripHashSuffix(match.r2_folder_key)
    const folderTokens = new Set(tokenize(folder))
    const subTokens = new Set(tokenize(match.subcategory || ''))
    const descTokens = new Set(tokenize(match.description || ''))

    let boost = 0
    for (const token of qTokens) {
      const inFolder = folderTokens.has(token)
      const inSub = subTokens.has(token) || (match.subcategory || '').includes(token)
      const inDesc = descTokens.has(token)

      if (CLASS_TOKENS.has(token)) {
        if (inFolder) boost += 0.14
        else if (inSub) boost += 0.11
        else if (inDesc) boost += 0.04
      } else if (!GENERIC_TOKENS.has(token)) {
        if (inFolder) boost += 0.06
        else if (inSub) boost += 0.04
        else if (inDesc) boost += 0.015
      } else {
        // Weak credit for generic overlap so "rifle" still helps a bit
        if (inFolder) boost += 0.02
        else if (inSub) boost += 0.015
      }
    }

    // Phrase: query wants sniper but candidate is clearly shotgun/minigun → small penalty
    if (qTokens.includes('sniper') && (folderTokens.has('shotgun') || subTokens.has('shotgun'))) {
      boost -= 0.08
    }
    if (qTokens.includes('shotgun') && (folderTokens.has('sniper') || subTokens.has('sniper'))) {
      boost -= 0.08
    }
    if (
      qTokens.includes('sniper') &&
      !folderTokens.has('sniper') &&
      !(match.subcategory || '').includes('sniper') &&
      (folderTokens.has('rifle') || (match.subcategory || '') === 'rifle')
    ) {
      boost -= 0.03
    }

    const score = Math.max(0, Math.min(0.99, Number(match.similarity) + boost))
    return { match, score, boost }
  })

  scored.sort((a, b) => b.score - a.score || b.match.similarity - a.match.similarity)

  return scored.map(({ match, score }) => ({
    ...match,
    // Surface hybrid score in the UI percentage (vector-only was too flat across weapons).
    similarity: score,
  }))
}
