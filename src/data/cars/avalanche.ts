import type { CarDef } from '../types';

/** Heavy, powerful pickup: very fast in a straight line, unstoppable, hard to turn. */
export const avalanche: CarDef = {
  id: 'avalanche',
  nameKey: 'car.avalanche.name',
  descriptionKey: 'car.avalanche.desc',
  price: 4000,
  requiresAchievement: 'gold_rush',
  stats: { speed: 0.9, grip: 0.7, suspension: 0.75, weight: 0.95 },
  physics: {
    mass: 1650,
    chassis: { length: 4.6, width: 2.0, height: 1.3 },
    comOffsetY: 0,
    wheelbase: 2.9,
    trackWidth: 1.82,
    wheelRadius: 0.44,
    mountY: 0.0,
    suspension: {
      restLength: 0.6,
      maxTravel: 0.42,
      stiffness: 52000,
      dampingBump: 4200,
      dampingRebound: 5600,
      antiRollFront: 15000,
      antiRollRear: 12000,
    },
    tires: { grip: 1.1, rearBias: 0.96, corneringStiffness: 8.5 },
    engine: { power: 255000, maxForce: 15500, drive: 'awd', brakeForce: 20000, reverseForce: 7000 },
    aero: { drag: 3.6, downforce: 1.8 },
    steering: { maxAngle: 0.55 },
    nitro: { force: 9500, capacity: 1, burnRate: 0.3 },
    airControl: 0.75,
  },
  look: {
    body: 'truck',
    colors: ['#f3f3ef', '#c1272d', '#202833', '#f0a500', '#3d7a44', '#5b6f8a'],
    accent: '#22252b',
    spoiler: false,
    roofRack: true,
    wheelWidth: 0.36,
  },
};
