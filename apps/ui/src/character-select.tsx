import type {
  CharacterDef,
  CharacterId,
  CoinDefId,
  ContentDb,
  EffectAtom,
} from "@game/core";
import { AtlasSprite } from "./AtlasSprite";
import type { SpriteManifest } from "./AtlasSprite";

export interface CharacterArt {
  atlasUrl: string;
  manifest: SpriteManifest;
}

const elementKo = (element: string): string => {
  if (element === "fire") return "화염";
  if (element === "mana") return "마나";
  if (element === "frost") return "냉기";
  if (element === "lightning") return "전기";
  if (element === "blood") return "혈기";
  return element;
};

const coinName = (coin: CoinDefId, db: ContentDb): string => {
  const element = db.coins[String(coin)]?.element;
  return element === null || element === undefined
    ? "기본"
    : elementKo(element);
};

const describeEffect = (effect: EffectAtom, db: ContentDb): string => {
  if (effect.kind === "damage") return `피해 ${effect.amount}`;
  if (effect.kind === "block") return `방어 ${effect.amount}`;
  if (effect.kind === "selfDamage") return `자신 피해 ${effect.amount}`;
  if (effect.kind === "addCoin") {
    const zone =
      effect.zone === "draw"
        ? "드로우 더미"
        : effect.zone === "discard"
          ? "버림 더미"
          : "손";
    // 특성이 만드는 코인은 임시(이번 전투 한정) — 발동 시점·수명을 함께 명시한다
    return `${zone}에 임시 ${coinName(effect.coin, db)} 코인 ${effect.count}개 추가`;
  }
  if (effect.kind === "applyStatus") {
    const target = effect.to === "self" ? "자신" : "대상";
    return `${target}에게 ${effect.status} ${effect.stacks}`;
  }
  if (effect.kind === "addTurnTrigger") return "턴 트리거 추가";
  if (effect.kind === "grantElement")
    return `기본 코인을 ${elementKo(effect.element)} 코인으로 취급`;
  // P6 — 소환/참조 원자 (마도기사 등)
  if (effect.kind === "summonEquipment") {
    const name =
      effect.equipment === "chosen"
        ? "선택 장비"
        : (db.equipment ?? {})[String(effect.equipment)]?.name ?? "장비";
    return `${name} 소환 (지속 ${effect.duration})`;
  }
  if (effect.kind === "empowerSummons") return `소환 장비 강화 +${effect.amount}`;
  if (effect.kind === "commandChosenSummon") return "소환 장비에 즉시 행동 명령";
  if (effect.kind === "damagePerTargetBurn") return `화상 1당 피해 ${effect.amountPerStack}`;
  if (effect.kind === "heal") return `회복 ${effect.amount}`;
  if (effect.kind === "draw") return `코인 ${effect.count}개 뽑기`;
  if (effect.kind === "nextTurnDraw") return `다음 턴 뽑기 +${effect.count}`;
  if (effect.kind === "reduceCooldown") return `다른 스킬 쿨다운 -${effect.amount}`;
  if (effect.kind === "enterOverheat") return "과열 진입";
  if (effect.kind === "damagePerBlock") return `현재 방어 1당 피해 ${effect.amountPerBlock}`;
  return "효과";
};

export const characterTraitDescription = (
  character: CharacterDef,
  db: ContentDb,
): string => {
  const timing = character.trait.hook === "combatStart" ? "전투 시작 시 " : "매 턴 시작 시 ";
  if (character.trait.mechanic === "remise") {
    return "매 턴 첫 플립 스킬의 첫 동전이 앞면이면 재플립합니다. 다시 앞면이면 같은 스킬을 비용 없이 한 번 재사용합니다.";
  }
  return character.trait.effects.length === 0
    ? "효과 없음"
    : timing +
        character.trait.effects
          .map((effect) => describeEffect(effect, db))
          .join(" · ");
};

const bagSummary = (
  character: CharacterDef,
  db: ContentDb,
): { coin: CoinDefId; name: string; count: number }[] => {
  const counts = new Map<string, { coin: CoinDefId; name: string; count: number }>();
  for (const coin of character.startingBag) {
    const id = String(coin);
    const current = counts.get(id);
    if (current === undefined) {
      counts.set(id, { coin, name: coinName(coin, db), count: 1 });
    } else {
      current.count += 1;
    }
  }
  return [...counts.values()];
};

interface CharacterSelectProps {
  artByCharacter: Readonly<Record<string, CharacterArt>>;
  characters: readonly CharacterDef[];
  contentDb: ContentDb;
  seed: string | null;
  onSelect: (character: CharacterId) => void;
}

export const CharacterSelect = ({
  artByCharacter,
  characters,
  contentDb,
  seed,
  onSelect,
}: CharacterSelectProps) => (
  <section
    aria-label="캐릭터 선택"
    aria-modal="true"
    className="result-overlay character-select-overlay"
    data-testid="character-select"
    role="dialog"
  >
    <div className="result-panel character-select-panel">
      <p className="run-kicker">신규 런</p>
      <h1>캐릭터 선택</h1>
      <p>전투에 진입할 캐릭터를 고릅니다.</p>
      {seed !== null ? <p className="select-seed">SEED {seed}</p> : null}
      <div className="character-grid">
        {characters.map((character) => (
          <button
            aria-label={`${character.name} 선택, HP ${character.maxHp}, 시작 스킬 ${character.startingSkills
              .map((skill) => contentDb.skills[String(skill)]?.name ?? String(skill))
              .join(", ")}`}
            className="character-card"
            data-character={String(character.id)}
            data-testid={`character-select-${String(character.id)}`}
            key={String(character.id)}
            type="button"
            onClick={() => onSelect(character.id)}
          >
            <span className="character-card-head">
              <strong>{character.name}</strong>
              <em>HP {character.maxHp}</em>
            </span>
            <span className="character-card-body">
              <span className="character-portrait" data-testid="character-portrait">
                {artByCharacter[String(character.id)] !== undefined ? (
                  <AtlasSprite
                    atlasUrl={artByCharacter[String(character.id)]!.atlasUrl}
                    manifest={artByCharacter[String(character.id)]!.manifest}
                    motion="idle"
                    playKey={0}
                    side="player"
                  />
                ) : null}
              </span>
              <span className="character-card-info">
                <span className="character-section">
                  <b>시작 가방</b>
                  <span className="character-coins">
                    {bagSummary(character, contentDb).map((item) => (
                      <i
                        className={`character-coin coin-${String(contentDb.coins[String(item.coin)]?.element ?? "basic")}`}
                        key={String(item.coin)}
                      >
                        {item.name} x{item.count}
                      </i>
                    ))}
                  </span>
                </span>
                <span className="character-section">
                  <b>시작 스킬</b>
                  <span className="character-skills">
                    {character.startingSkills.map((skill) => (
                      <i key={String(skill)}>
                        {contentDb.skills[String(skill)]?.name ?? String(skill)}
                      </i>
                    ))}
                  </span>
                </span>
                <span className="character-trait">
                  <b>{character.trait.name}</b>
                  <small>{characterTraitDescription(character, contentDb)}</small>
                </span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  </section>
);
