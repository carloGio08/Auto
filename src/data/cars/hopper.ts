import type { CarDef } from '../types';

/** Light buggy with long-travel suspension and strong air control: the jumper. */
export const hopper: CarDef = {
  id: 'hopper',
  nameKey: 'car.hopper.name',
  descriptionKey: 'car.hopper.desc',
  price: 2500,
  stats: { speed: 0.55, grip: 0.65, suspension: 0.95, weight: 0.25 },
  physics: {
    mass: 820,
    chassis: { length: 3.5, width: 1.75, height: 1.0 },
    comOffsetY: -0.05,
    wheelbase: 2.35,
    trackWidth: 1.72,
    wheelRadius: 0.42,
    mountY: 0.05,
    suspension: {
      restLength: 0.66,
      maxTravel: 0.5,
      stiffness: 20000,
      dampingBump: 1700,
      dampingRebound: 2300,
      antiRollFront: 4500,
      antiRollRear: 4000,
    },
    tires: { grip: 1.08, rearBias: 0.95, corneringStiffness: 8 },
    engine: { power: 115000, maxForce: 8000, drive: 'awd', brakeForce: 10500, reverseForce: 4000 },
    aero: { drag: 2.3, downforce: 0.9 },
    steering: { maxAngle: 0.64 },
    nitro: { force: 5200, capacity: 1.2, burnRate: 0.26 },
    airControl: 1.5,
  },
  look: {
    body: 'buggy',
    colors: ['#9bd12f', '#ff9f1c', '#2ec4b6', '#e71d36', '#f7f7f2', '#3a3f4a'],
    accent: '#2b2d33',
    spoiler: false,
    roofRack: false,
    wheelWidth: 0.34,
  },
};
