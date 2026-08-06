/** Shared label cleanup for batch labeling and embed indexing. */

export const RAG_CATEGORIES = ['character', 'prop', 'creature', 'environment'] as const
export type RagCategory = (typeof RAG_CATEGORIES)[number]

/** Tags that apply to ~every Minecraft/Blockbench asset — zero retrieval value. */
export const LOW_SIGNAL_TAGS = new Set([
  'gaming',
  'gamer',
  'game',
  'videogame',
  'video-game',
  'minecraft',
  'blockbench',
  'geckolib',
  '3d',
  '3-d',
  'model',
  'asset',
  'mesh',
  'cube',
  'detailed',
  'quality',
  'nice',
  'cool',
  'awesome',
  'custom',
  'mod',
  'addon',
  'resource-pack',
  'resourcepack',
])

/** Clip-name tokens that pollute RAG embeddings. */
export const ANIMATION_CLIP_TOKENS = new Set([
  'idle',
  'walk',
  'walking',
  'run',
  'running',
  'sprint',
  'attack',
  'attacks',
  'attacking',
  'hurt',
  'hit',
  'damage',
  'death',
  'die',
  'dying',
  'swim',
  'swimming',
  'jump',
  'jumping',
  'sit',
  'sitting',
  'crouch',
  'crouching',
  'sneak',
  'sneaking',
  'fly',
  'flying',
  'fall',
  'falling',
  'dance',
  'sleep',
  'eat',
  'shoot',
  'reload',
  'aim',
  'cast',
  'spawn',
  'despawn',
  'loop',
  'clips',
  'animations',
  'animation',
  'anim',
  'geckolibidle',
  'geckolibwalk',
  'geckolib',
])

export function isRagCategory(value: string): value is RagCategory {
  return RAG_CATEGORIES.includes(value as RagCategory)
}

const CHARACTER_SUBS = new Set([
  'player',
  'npc',
  'warrior',
  'knight',
  'soldier',
  'archer',
  'mage',
  'wizard',
  'witch',
  'rogue',
  'assassin',
  'hunter',
  'merchant',
  'civilian',
  'armored',
  'caster',
  'humanoid',
])

const CREATURE_SUBS = new Set([
  'passive-mob',
  'hostile-mob',
  'boss',
  'quadruped',
  'bipedal',
  'flying',
  'aquatic',
  'arthropod',
  'undead',
  'dragon',
  'golem',
  'elemental',
  'slime',
  'farm-animal',
  'pet',
  'mythical',
  'villager',
  'villager-golem',
  'zombie',
  'skeleton',
  'creeper',
  'enderman',
  'spider',
  'wolf',
  'cat',
  'horse',
  'cow',
  'pig',
  'sheep',
  'chicken',
])

const ENVIRONMENT_SUBS = new Set([
  'structure',
  'building',
  'house',
  'fortress',
  'castle',
  'tower',
  'ruins',
  'dungeon',
  'cave',
  'terrain',
  'rock',
  'mountain',
  'bridge',
  'road',
  'foliage',
  'tree',
  'bush',
  'flower',
  'grass',
  'crop',
  'water',
  'lava',
  'sky',
  'weather',
  'biome-prop',
])

const PROP_SUBS = new Set([
  'sniper-rifle',
  'assault-rifle',
  'rifle',
  'handgun',
  'pistol',
  'shotgun',
  'smg',
  'lmg',
  'launcher',
  'bow',
  'crossbow',
  'sword',
  'dagger',
  'axe',
  'spear',
  'trident',
  'staff',
  'wand',
  'shield',
  'armor',
  'helmet',
  'chestplate',
  'tool',
  'pickaxe',
  'shovel',
  'hoe',
  'fishing-rod',
  'chair',
  'table',
  'desk',
  'bed',
  'sofa',
  'shelf',
  'cabinet',
  'door',
  'window',
  'lamp',
  'candle',
  'painting',
  'carpet',
  'clock',
  'chest',
  'crate',
  'barrel',
  'container',
  'machine',
  'console',
  'terminal',
  'screen',
  'robot',
  'drone',
  'gadget',
  'battery',
  'crystal',
  'portal',
  'trap',
  'vehicle',
  'car',
  'truck',
  'tank',
  'boat',
  'ship',
  'plane',
  'helicopter',
  'motorcycle',
  'minecart',
  'mount',
  'block',
  'ore',
  'food',
  'potion',
  'book',
  'scroll',
  'key',
  'coin',
  'gem',
  'trophy',
  'flag',
  'sign',
  'totem',
  'statue',
  'skull',
  'bone',
  'corpse',
  'debris',
  'item',
  'minigun',
])

const MOB_LIKE_SUBS = new Set(['passive-mob', 'hostile-mob', 'bipedal', 'undead'])
const VAGUE_SUBS = new Set([
  'weapon',
  'gun',
  'item',
  'object',
  'prop',
  'mob',
  'creature',
  'model',
  'asset',
  'thing',
])

function categoryForSubcategory(subcategory: string | null | undefined): RagCategory | null {
  if (!subcategory) return null
  if (CHARACTER_SUBS.has(subcategory)) return 'character'
  if (CREATURE_SUBS.has(subcategory)) return 'creature'
  if (ENVIRONMENT_SUBS.has(subcategory)) return 'environment'
  if (PROP_SUBS.has(subcategory) || subcategory === 'machine-gun') return 'prop'
  return null
}

function folderLeaf(folderHint?: string | null): string {
  if (!folderHint) return ''
  return folderHint
    .replace(/\/+$/, '')
    .split('/')
    .pop()!
    .toLowerCase()
}

/** Strip hash suffixes from folder leaf: alex_7d11b469 → alex, foo__a1b2c3 → foo */
export function cleanFolderLeaf(folderHint?: string | null): string {
  let leaf = folderLeaf(folderHint)
  leaf = leaf.replace(/__[a-f0-9]{4,}$/i, '')
  leaf = leaf.replace(/_[a-f0-9]{8}$/i, '')
  return leaf
}

/** Distinctive identity tokens from the folder name (injected into embedding_text). */
export function folderIdentityTokens(folderHint?: string | null): string[] {
  const leaf = cleanFolderLeaf(folderHint)
  if (!leaf) return []
  return leaf
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 2)
    .filter((token) => !/^[a-f0-9]{6,}$/i.test(token))
    .filter((token) => !LOW_SIGNAL_TAGS.has(token))
    .filter((token) => !ANIMATION_CLIP_TOKENS.has(token))
}

/** Strong class cues from folder names — overrides vague subcategory like "weapon". */
export function inferSubcategoryFromFolder(folderHint?: string | null): string | null {
  const leaf = cleanFolderLeaf(folderHint)
  if (!leaf) return null
  if (/sniper/.test(leaf)) return 'sniper-rifle'
  if (/shotgun/.test(leaf)) return 'shotgun'
  if (/minigun|gatling/.test(leaf)) return 'lmg'
  if (/assault.?rifle|assaultrifle/.test(leaf)) return 'assault-rifle'
  if (/\bsmg\b|submachine/.test(leaf)) return 'smg'
  if (/handgun|pistol/.test(leaf)) return 'handgun'
  if (/crossbow/.test(leaf)) return 'crossbow'
  if (/(^|[_-])bow([_-]|$)/.test(leaf)) return 'bow'
  if (/sword/.test(leaf)) return 'sword'
  if (/launcher|rocket/.test(leaf)) return 'launcher'
  if (/fortress|bastion/.test(leaf)) return 'fortress'
  if (/castle/.test(leaf)) return 'castle'
  if (/tower/.test(leaf)) return 'tower'
  if (/zombie/.test(leaf)) return 'zombie'
  if (/skeleton/.test(leaf)) return 'skeleton'
  if (/villager/.test(leaf)) return 'villager'
  if (/rifle/.test(leaf)) return 'rifle'
  if (/laser.?gun|lasergun/.test(leaf)) return 'handgun'
  return null
}

/**
 * Lock category ↔ subcategory to the closed taxonomy.
 * Player skins (Alex/Steve) stay character/player even if the model guessed passive-mob.
 */
export function reconcileTaxonomy(options: {
  category: string
  subcategory?: string | null
  folderHint?: string | null
}): {
  category: RagCategory
  subcategory: string | null
  needsReview: boolean
  coerced: boolean
} {
  const leaf = folderLeaf(options.folderHint)
  let category: RagCategory = isRagCategory(options.category) ? options.category : 'prop'
  let subcategory =
    options.subcategory != null && String(options.subcategory).trim()
      ? String(options.subcategory).trim().toLowerCase().replace(/\s+/g, '-')
      : null
  let coerced = !isRagCategory(options.category)
  let needsReview = coerced

  const isPlayerSkin =
    /^(alex|steve)([_-]|$)/i.test(leaf) ||
    /\b(player[_-]?skin|default[_-]?skin)\b/i.test(leaf)

  if (isPlayerSkin) {
    if (category !== 'character' || subcategory !== 'player') coerced = true
    category = 'character'
    subcategory = 'player'
    return { category, subcategory, needsReview: false, coerced }
  }

  const inferred = inferSubcategoryFromFolder(options.folderHint)
  if (inferred) {
    const vague = !subcategory || VAGUE_SUBS.has(subcategory)
    const folderStrong = /sniper|shotgun|minigun|gatling|pistol|handgun|fortress|bastion|zombie|skeleton/.test(
      cleanFolderLeaf(options.folderHint),
    )
    if (vague || folderStrong || (subcategory === 'rifle' && inferred === 'sniper-rifle')) {
      if (subcategory !== inferred) coerced = true
      subcategory = inferred
    }
  }

  const fromSub = categoryForSubcategory(subcategory)
  if (fromSub && fromSub !== category) {
    // character + passive-mob/hostile-mob without player-skin cue → treat as creature mob
    if (category === 'character' && subcategory && MOB_LIKE_SUBS.has(subcategory)) {
      category = 'creature'
      coerced = true
      needsReview = true
    } else {
      category = fromSub
      coerced = true
      needsReview = true
    }
  }

  return { category, subcategory, needsReview, coerced }
}

export function pruneTagList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const tag = String(item)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
    if (!tag || LOW_SIGNAL_TAGS.has(tag) || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= max) break
  }
  return out
}

/**
 * Normalize embedding_text for consistent retrieval:
 * spaces only, drop rival category words, strip clip/filler tokens.
 * Folder identity tokens are placed near the front so names like "beacon_sniper" stay searchable.
 */
export function sanitizeEmbeddingTextForRag(
  text: string,
  hasAnimation: boolean,
  category: string,
  subcategory?: string | null,
  folderHint?: string | null,
): string {
  const chosen = isRagCategory(category) ? category : 'prop'
  const tokens = text
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .filter((token) => !ANIMATION_CLIP_TOKENS.has(token))
    .filter((token) => token !== 'animated' && token !== 'static')
    .filter((token) => !LOW_SIGNAL_TAGS.has(token))
    .filter((token) => !isRagCategory(token) || token === chosen)

  const identity = folderIdentityTokens(folderHint)
  const subParts: string[] = []
  if (subcategory) {
    for (const part of String(subcategory).replace(/[-_]+/g, ' ').split(/\s+/)) {
      const clean = part.replace(/[^a-z0-9]/g, '')
      if (clean) subParts.push(clean)
    }
  }

  const ordered = [chosen, ...identity, ...subParts, ...tokens, hasAnimation ? 'animated' : 'static']
  return [...new Set(ordered)].join(' ').trim()
}

/** Ensure jsonb payload is a real object (unwrap accidental double-stringified JSON). */
export function asJsonObject(value: unknown): Record<string, unknown> {
  let current: unknown = value
  for (let i = 0; i < 3; i += 1) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      return current as Record<string, unknown>
    }
    if (typeof current !== 'string') break
    try {
      current = JSON.parse(current) as unknown
    } catch {
      break
    }
  }
  return { value }
}
