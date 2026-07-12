export type Brand<T, B extends string> = T & { readonly __brand: B };

export type CoinDefId = Brand<string, 'CoinDefId'>;
// 전투 내 인스턴스 id — nextUid 카운터 발급 (총량 원장 추적)
export type CoinUid = Brand<number, 'CoinUid'>;
export type SkillId = Brand<string, 'SkillId'>;
export type EventDefId = Brand<string, 'EventDefId'>;
// 장착 슬롯 인덱스 (0~5)
export type SlotId = Brand<number, 'SlotId'>;
export type CharacterId = Brand<string, 'CharacterId'>;
export type EnemyDefId = Brand<string, 'EnemyDefId'>;
export type PassiveId = Brand<string, 'PassiveId'>;
export type EquipmentDefId = Brand<string, 'EquipmentDefId'>;

export type Face = 'heads' | 'tails';
export type Element = 'fire' | 'mana' | 'frost' | 'lightning' | 'blood';
