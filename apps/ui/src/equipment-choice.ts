import type {
  CombatState,
  ContentDb,
  EquipmentDefId,
  FlipSkillDef,
} from "@game/core";
import { skillRequiresEquipmentChoice } from "@game/core";

import type { TargetingCommand } from "./targeting";

export interface EquipmentChoiceOption {
  id: EquipmentDefId;
  name: string;
  description: string;
}

export const equipmentChoiceOptions = (
  db: ContentDb,
): EquipmentChoiceOption[] =>
  Object.values(db.equipment ?? {})
    .map((equipment) => ({
      id: equipment.id,
      name: equipment.name,
      description: equipment.description,
    }))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)));

const flipSkillFor = (
  state: CombatState,
  command: TargetingCommand,
  db: ContentDb,
): FlipSkillDef | null => {
  if (command.type !== "useImmediateFlipSkill") return null;
  const slot = state.slots[Number(command.slot)];
  const skill = slot === undefined ? undefined : db.skills[String(slot.skillId)];
  return skill?.type === "flip" ? skill : null;
};

export const requiresEquipmentChoice = (
  state: CombatState,
  command: TargetingCommand,
  db: ContentDb,
): boolean => {
  const skill = flipSkillFor(state, command, db);
  return skill !== null && skillRequiresEquipmentChoice(skill);
};

export const equipmentChoiceCommand = (
  state: CombatState,
  command: TargetingCommand,
  equipment: EquipmentDefId,
  db: ContentDb,
): Extract<TargetingCommand, { type: "useImmediateFlipSkill" }> | null => {
  if (!requiresEquipmentChoice(state, command, db)) return null;
  if ((db.equipment ?? {})[String(equipment)] === undefined) return null;
  const explicit = {
    ...command,
    chosenEquipment: equipment,
  };
  if (explicit.type !== "useImmediateFlipSkill") return null;
  return explicit;
};
