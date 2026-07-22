import type { ContentDb, RunState } from "@game/core";

interface PassiveInventoryProps {
  contentDb: ContentDb;
  open: boolean;
  passives: RunState["acquiredPassives"];
  onOpenChange: (open: boolean) => void;
}

export function PassiveInventory({ contentDb, open, passives, onOpenChange }: PassiveInventoryProps): JSX.Element {
  const entries = passives.map((id) => ({
    id: String(id),
    name: (contentDb.passives ?? {})[String(id)]?.name ?? String(id),
    description: (contentDb.passives ?? {})[String(id)]?.description ?? "설명이 준비되지 않았습니다.",
  }));
  return (
    <div className="passive-inventory-host">
      <button
        aria-controls="passive-inventory"
        aria-expanded={open}
        className="passive-inventory-open"
        data-testid="passive-inventory-open"
        type="button"
        onClick={() => onOpenChange(!open)}
      >
        패시브 {passives.length}
      </button>
      {open ? (
        <section aria-label="보유 패시브" className="passive-inventory" data-testid="passive-inventory" id="passive-inventory" role="region">
          <header>
            <strong>보유 패시브</strong>
            <button aria-label="패시브 인벤토리 닫기" type="button" onClick={() => onOpenChange(false)}>×</button>
          </header>
          {entries.length === 0 ? (
            <p>아직 보유한 패시브가 없습니다. 상점, 보물, 보상에서 새로운 패시브를 얻을 수 있습니다.</p>
          ) : (
            <ul>
              {entries.map((passive) => <li key={passive.id}><b>{passive.name}</b><span>{passive.description}</span></li>)}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
