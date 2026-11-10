/**
 * Next cast, cars and trips. The flag stays off until the owner approves art.
 * Nothing here appears in the garage while FUTURE_ENABLED is false.
 * Brake feel differs by a multiplier, not by a "+5%" upgrade shop.
 */

export const FUTURE_ENABLED = false;

export const STUDENTS = {
  anton: {
    id: "anton",
    name: "Антон",
    patienceMul: 1,
    cruiseMul: 1,
    ignoresMarkings: false,
    kioskStop: false,
    cameraPhone: false,
  },
  gennady: {
    id: "gennady",
    name: "Геннадий",
    patienceMul: 0.7,
    cruiseMul: 0.9,
    ignoresMarkings: true,
    kioskStop: true,
    cameraPhone: false,
  },
  asya: {
    id: "asya",
    name: "Ася",
    patienceMul: 1.15,
    cruiseMul: 1,
    ignoresMarkings: false,
    kioskStop: false,
    cameraPhone: true,
  },
  profi: {
    id: "profi",
    name: "Профи",
    patienceMul: 1.45,
    cruiseMul: 1.22,
    ignoresMarkings: false,
    kioskStop: false,
    cameraPhone: false,
  },
};

export const FUTURE_CARS = {
  yellow: { id: "yellow", name: "Жёлтая", brakeMul: 1 },
  mint: { id: "mint", name: "Мятная", brakeMul: 0.86 },
  blue: { id: "blue", name: "Синяя", brakeMul: 1.12 },
};

export const FUTURE_DISTRICTS = [
  { id: "yard", name: "Старый двор" },
  { id: "market", name: "Торговая улица" },
  { id: "country", name: "Загородная дорога" },
];

export const FUTURE_TRIPS = [
  { id: "mother", title: "Съездить за тёщей", student: "gennady", car: "blue", district: "yard", needsArt: true },
  { id: "exam", title: "Экзамен", student: "profi", car: "mint", district: "country", needsArt: true },
  { id: "everyone", title: "Все вышли гулять", student: "anton", car: "yellow", district: "yard", needsArt: true },
  { id: "gennady-sleep", title: "Геннадий уснул", student: "gennady", car: "blue", district: "market", needsArt: true },
];

export function playableFutureTrips() {
  return FUTURE_ENABLED ? FUTURE_TRIPS : [];
}
