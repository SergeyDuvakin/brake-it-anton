/**
 * Approved cast. Brake feel is a different car, not a "+5%" upgrade.
 * Anton's four lessons stay the first path in the garage.
 */

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
