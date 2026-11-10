/**
 * The model of a conversion recipe and its overrides (editor.md §1.3, §2.6–2.7, M6 A6.2):
 * pure logic, no interface. The recipe's files and their edits (./workspace.ts), the
 * layers of a type — derived, override, result — (./merge.ts, golden `recipe_merge`;
 * ./layers.ts), the three states of a field (./fields.ts), doors by id (./doors.ts), the
 * floor generator's options (./floor.ts), names, lights and sway (./names.ts).
 */

export {
  addDoor,
  doorForm,
  doorRows,
  doorsAsList,
  doorsAsObject,
  removeDoor,
  resetDoor,
  setDoorField,
  type DoorForm,
  type DoorRow,
} from './doors';
export { canRemove, fieldState, OVERRIDE_SECTIONS, removeField, resetField, setField, type FieldState, type SetOptions } from './fields';
export { FLOOR_OPTIONS, floorAsDerived, floorStatus, resetFloorOption, setFloorOption, turnFloorOff, turnFloorOn, type FloorOption, type FloorStatus } from './floor';
export { fieldView, typeLayers, type FieldView, type TypeLayers } from './layers';
export {
  deepMerge,
  editDoors,
  effectiveOverride,
  floorRuns,
  layer,
  MergeError,
  mergeOverride,
  validSway,
  withoutComments,
  type Derived,
  type JsonObject,
  type MergeInput,
  type MergeResult,
} from './merge';
export { lightPointer, namePointer, resetLightName, resetName, resetSway, setLightName, setName, setSway } from './names';
export { joinPath, RecipeError, RecipeWorkspace, type RecipeErrorCode } from './workspace';
