import type { CarDef } from '../types';

/** Balanced AWD rally car: stable, forgiving, the starter car. */
export const ridgeRunner: CarDef = {
  id: 'ridge',
  nameKey: 'car.ridge.name',
  descriptionKey: 'car.ridge.desc',
  price: 0,
  stats: { speed: 0.6, grip: 0.75, suspension: 0.65, weight: 0.55 },
  physics: {
    mass: 1150,
    chassis: { length: 4.0, width: 1.8, height: 1.0 },
    comOffsetY: -0.1,
    wheelbase: 2.5,
    trackWidth: 1.62,
    wheelRadius: 0.36,
    mountY: -0.05,
    suspension: {
      restLength: 0.5,
      maxTravel: 0.34,
      stiffness: 36000,
      dampingBump: 2700,
      dampingRebound: 3600,
      antiRollFront: 9000,
      antiRollRear: 7000,
    },
    tires: { grip: 1.12, rearBias: 0.97, corneringStiffness: 9 },
    engine: { power: 150000, maxForce: 10500, drive: 'awd', brakeForce: 14000, reverseForce: 5000 },
    aero: { drag: 2.8, downforce: 1.6 },
    steering: { maxAngle: 0.6 },
    nitro: { force: 6500, capacity: 1, burnRate: 0.28 },
    airControl: 1,
  },
  look: {
    body: 'rally',
    colors: ['#e8452c', '#2f6fd6', '#f2c230', '#f4f4f0', '#1f9e6e', '#262a33'],
    accent: '#1b1d22',
    spoiler: true,
    roofRack: false,
    wheelWidth: 0.28,
  },
};
