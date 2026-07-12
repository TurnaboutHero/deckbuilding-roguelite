// 상점 화면 — 순수 프레젠테이션 (D4 3행동). 상태·가격 진실은 코어 pendingShop이
// 소유하고, 이 컴포넌트는 props로만 받는다 (UI 규칙 중복 금지).
import type { ReactNode } from "react";

export interface ShopCoinOffer {
  id: string;
  name: string;
  price: number;
  visualClass: string;
}

export interface ShopSkillOffer {
  id: string;
  name: string;
  price: number;
  rarityName: string;
  card: ReactNode;
}

export interface ShopPassiveOffer {
  id: string;
  name: string;
  description: string;
  price: number;
}

export interface ShopBagCoin {
  bagIndex: number;
  name: string;
  visualClass: string;
}

interface ShopScreenProps {
  gold: number;
  removalPrice: number;
  coinOffers: ShopCoinOffer[];
  skillOffers: ShopSkillOffer[];
  passiveOffers: ShopPassiveOffer[];
  bagCoins: ShopBagCoin[];
  rejection: string | null;
  /** 구매 확정 대기 중인 스킬 옵션 인덱스 — 교체 슬롯 선택 단계 (6슬롯 고정 규칙) */
  skillPick: number | null;
  slotLabels: string[];
  onBuyCoin: (index: number) => void;
  onBuyPassive: (index: number) => void;
  onPickSkill: (index: number) => void;
  onConfirmSkill: (slot: number) => void;
  onCancelSkill: () => void;
  onRemoveCoin: (bagIndex: number) => void;
  onLeave: () => void;
}

export const ShopScreen = ({
  gold,
  removalPrice,
  coinOffers,
  skillOffers,
  passiveOffers,
  bagCoins,
  rejection,
  skillPick,
  slotLabels,
  onBuyCoin,
  onBuyPassive,
  onPickSkill,
  onConfirmSkill,
  onCancelSkill,
  onRemoveCoin,
  onLeave,
}: ShopScreenProps) => (
  <section aria-label="상점" className="shop-screen" data-testid="shop-screen">
    <header className="shop-header">
      <h2>상점</h2>
      <span aria-label={`보유 골드 ${gold}`} className="shop-gold">
        골드 {gold}
      </span>
    </header>
    {rejection === null ? null : (
      <p className="shop-rejection" role="status">
        {rejection}
      </p>
    )}
    <div className="shop-section" data-testid="shop-coins">
      <h3>동전 구매</h3>
      <ul>
        {coinOffers.map((offer, index) => (
          <li key={`${offer.id}-${index}`}>
            <button
              className="shop-item"
              data-testid={`shop-coin-${offer.id}`}
              disabled={gold < offer.price}
              onClick={() => onBuyCoin(index)}
              type="button"
            >
              <span aria-hidden="true" className={`pop-coin ${offer.visualClass}`} />
              <span className="shop-item-name">{offer.name}</span>
              <strong className="shop-price">{offer.price}G</strong>
            </button>
          </li>
        ))}
        {coinOffers.length === 0 ? <li className="shop-empty">매진</li> : null}
      </ul>
    </div>
    <div className="shop-section" data-testid="shop-passives">
      <h3>패시브 구매</h3>
      <ul>
        {passiveOffers.map((offer, index) => (
          <li key={`${offer.id}-${index}`}>
            <button
              className="shop-item shop-passive"
              data-testid={`shop-passive-${offer.id}`}
              disabled={gold < offer.price}
              onClick={() => onBuyPassive(index)}
              type="button"
            >
              <span aria-hidden="true" className="passive-mark">★</span>
              <span className="shop-item-name">
                {offer.name} <small>{offer.description}</small>
              </span>
              <strong className="shop-price">{offer.price}G</strong>
            </button>
          </li>
        ))}
        {passiveOffers.length === 0 ? <li className="shop-empty">매진</li> : null}
      </ul>
    </div>
    <div className="shop-section" data-testid="shop-skills">
      <h3>스킬 구매</h3>
      <ul>
        {skillOffers.map((offer, index) => (
          <li key={`${offer.id}-${index}`}>
            <button
              className={`shop-item shop-skill ${skillPick === index ? "picked" : ""}`}
              data-testid={`shop-skill-${offer.id}`}
              disabled={gold < offer.price}
              onClick={() => onPickSkill(index)}
              type="button"
            >
              {offer.card}
              <span className="shop-item-name">
                {offer.name} <small>({offer.rarityName})</small>
              </span>
              <strong className="shop-price">{offer.price}G</strong>
            </button>
          </li>
        ))}
        {skillOffers.length === 0 ? <li className="shop-empty">매진</li> : null}
      </ul>
      {skillPick === null ? null : (
        <div className="shop-slot-picker" data-testid="shop-slot-picker">
          <p>교체할 슬롯을 고릅니다 — 6슬롯 고정 규칙.</p>
          <ul>
            {slotLabels.map((label, slot) => (
              <li key={slot}>
                <button
                  className="shop-item"
                  data-testid={`shop-replace-slot-${slot}`}
                  onClick={() => onConfirmSkill(slot)}
                  type="button"
                >
                  슬롯 {slot + 1} · {label}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="secondary-action"
            data-testid="shop-skill-cancel"
            onClick={onCancelSkill}
            type="button"
          >
            선택 취소
          </button>
        </div>
      )}
    </div>
    <div className="shop-section" data-testid="shop-removal">
      <h3>
        동전 제거 <strong className="shop-price">{removalPrice}G</strong>
      </h3>
      <ul>
        {bagCoins.map((coin) => (
          <li key={coin.bagIndex}>
            <button
              className="shop-item"
              data-testid={`shop-remove-${coin.bagIndex}`}
              disabled={gold < removalPrice}
              onClick={() => onRemoveCoin(coin.bagIndex)}
              type="button"
            >
              <span aria-hidden="true" className={`pop-coin ${coin.visualClass}`} />
              <span className="shop-item-name">{coin.name} 제거</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
    <button className="shop-leave" onClick={onLeave} type="button">
      상점 나가기
    </button>
  </section>
);
