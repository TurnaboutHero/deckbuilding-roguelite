import type {
  CharacterId,
  CoinDefId,
  CoinUid,
  Element,
  EnemyDefId,
  Face,
  SkillId
} from './ids';

// 확정 어휘 (docs/implementation-plan.md §6): 화상 burn(M3), 동상 frostbite·감전 shock(포스트 MVP 예약)
export type StatusId = 'burn' | 'frostbite' | 'shock';

export type TargetRef = { type: 'player' } | { type: 'enemy'; index: number };

export interface CoinDef {
  id: CoinDefId;
  element: Element | null;
  proc?: { face: Face; effects: EffectAtom[] };
}

export interface CoinInstance {
  uid: CoinUid;
  defId: CoinDefId;
  permanent: boolean;
  grants: Element[];
}

export interface SkillDefBase {
  id: SkillId;
  name: string;
  rarity: 'common' | 'advanced' | 'rare';
  tags: readonly ('attack' | 'defense' | 'utility' | 'ultimate')[];
  targetType: 'single-enemy' | 'all-enemies' | 'self' | 'none';
  oncePerCombat?: boolean;
}

export interface FlipSkillDef extends SkillDefBase {
  type: 'flip';
  cost: number;
  base: EffectAtom[];
  heads?: { mode: 'any' | 'per'; effects: EffectAtom[] };
  tails?: { mode: 'any' | 'per'; effects: EffectAtom[] };
}

export interface ConsumeSkillDef extends SkillDefBase {
  type: 'consume';
  consume: { element: Element; count: number };
  effects: EffectAtom[];
}

export type SkillDef = FlipSkillDef | ConsumeSkillDef;

export type EffectAtom =
  | { kind: 'damage'; amount: number }
  | { kind: 'block'; amount: number }
  | { kind: 'selfDamage'; amount: number }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; to: 'target' | 'self' }
  | { kind: 'addCoin'; coin: CoinDefId; zone: 'draw' | 'discard' | 'hand'; count: number }
  | { kind: 'grantElement'; element: Element; scope: 'allBasicInHand' };

export interface CharacterDef {
  id: CharacterId;
  name: string;
  maxHp: number;
  startingBag: CoinDefId[];
  startingSkills: SkillId[];
  trait: {
    id: string;
    name: string;
    hook: 'combatStart' | 'turnStart';
    effects: EffectAtom[];
  };
}

export type EnemyAction =
  | { kind: 'attack'; damage: number; hits?: number }
  | { kind: 'block'; amount: number };

export interface EnemyIntent {
  id: string;
  actions: EnemyAction[];
}

export interface EnemyDef {
  id: EnemyDefId;
  name: string;
  maxHp: number;
  intents: EnemyIntent[];
}

export interface ContentDb {
  coins: Record<string, CoinDef>;
  skills: Record<string, SkillDef>;
  enemies: Record<string, EnemyDef>;
  characters: Record<string, CharacterDef>;
  validate: () => string[];
}

const duplicateIds = <T extends { id: string | number }>(items: readonly T[], label: string): string[] => {
  const seen = new Set<string | number>();
  const errors: string[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      errors.push(`duplicate ${label} id: ${String(item.id)}`);
    }
    seen.add(item.id);
  }
  return errors;
};

export const validateContentDb = (db: Omit<ContentDb, 'validate'>): string[] => [
  ...duplicateIds(Object.values(db.coins), 'coin'),
  ...duplicateIds(Object.values(db.skills), 'skill'),
  ...duplicateIds(Object.values(db.enemies), 'enemy'),
  ...duplicateIds(Object.values(db.characters), 'character')
];

export const effectiveElements = (coin: CoinInstance, db: ContentDb): Element[] => {
  const def = db.coins[String(coin.defId)];
  const elements = new Set<Element>(coin.grants);
  if (def?.element != null) {
    elements.add(def.element);
  }
  return [...elements];
};
