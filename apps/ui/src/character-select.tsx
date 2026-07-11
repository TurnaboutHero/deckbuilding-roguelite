import type {
  CharacterDef,
  CharacterId,
  CoinDefId,
  ContentDb,
  EffectAtom,
} from "@game/core";

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
  return `기본 코인을 ${elementKo(effect.element)} 코인으로 취급`;
};

export const characterTraitDescription = (
  character: CharacterDef,
  db: ContentDb,
): string => {
  const timing = character.trait.hook === "combatStart" ? "전투 시작 시 " : "";
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
  characters: readonly CharacterDef[];
  contentDb: ContentDb;
  seed: string | null;
  onSelect: (character: CharacterId) => void;
}

export const CharacterSelect = ({
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
          </button>
        ))}
      </div>
    </div>
  </section>
);
