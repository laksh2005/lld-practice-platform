import { Problem } from "../domain/models";

export const seedProblems: Problem[] = [
  {
    id: "parking-lot",
    title: "Parking Lot",
    difficulty: "easy",
    summary:
      "Design a parking lot that supports multiple vehicle types and multiple spot sizes, and can tell an incoming vehicle where to park.",
    requirements: [
      "Support at least two vehicle types (e.g. motorcycle, car, bus) with different space needs",
      "Support multiple spot sizes and assign the smallest spot that fits a vehicle",
      "Track which spots are occupied and free at any time",
      "Compute a parking fee based on duration when a vehicle exits",
      "Handle the lot being full (no available spot for a given vehicle type)",
    ],
    expectedEntities: ["vehicle", "spot", "ticket", "gate", "lot"],
    extensionHint:
      "The lot operator wants to add reserved/EV-charging spots that only certain vehicles can use, and multiple floors with per-floor availability counts.",
  },
  {
    id: "elevator-system",
    title: "Elevator System",
    difficulty: "medium",
    summary:
      "Design the control logic for a bank of elevators in a building: request handling, scheduling, and movement.",
    requirements: [
      "Support multiple elevator cars serving the same set of floors",
      "Handle both hall calls (up/down button on a floor) and car calls (button inside the car)",
      "Decide which elevator car should serve a new request",
      "Model the elevator's direction and door state as it moves between floors",
      "Handle a car going out of service without breaking the rest of the system",
    ],
    expectedEntities: ["elevator", "request", "scheduler", "floor", "controller"],
    extensionHint:
      "The building wants an 'express' mode where one elevator serves only odd floors during peak hours, and priority service for a maintenance/fire-alarm override.",
  },
  {
    id: "vending-machine",
    title: "Vending Machine",
    difficulty: "easy",
    summary:
      "Design a vending machine that accepts payment, dispenses an item, and returns change. Model it with an explicit state machine.",
    requirements: [
      "Model the machine's states explicitly (e.g. idle, has money, dispensing, out of stock)",
      "Support at least two payment methods (e.g. cash and card)",
      "Track inventory per item slot and prevent selling out-of-stock items",
      "Compute and dispense correct change for cash payments",
      "Handle a selected item costing more than the money inserted",
    ],
    expectedEntities: ["item", "slot", "inventory", "state", "payment"],
    extensionHint:
      "The operator wants to add a loyalty-card payment method and a remote restocking/inventory-alert feature without rewriting the state machine.",
  },
];
