import type { CarDef } from '../types';

/** Rear-wheel-drive coupé with a loose rear end: the drifter. */
export const sidewinder: CarDef = {
  id: 'sidewinder',
  nameKey: 'car.sidewinder.name',
  descriptionKey: 'car.sidewinder.desc',
  price: 1500,
  stats: { speed: 0.72, grip: 0.5, suspension: 0.5, weight: 0.45 },
  physics: {
    mass: 1050,
    chassis: { length: 4.2, width: 1.82, height: 0.9 },
    comOffsetY: -0.15,
    wheelbase: 2.6,
    trackWidth: 1.6,
    wheelRadius: 0.34,
    mountY: -0.08,
    suspension: {
      restLength: 0.42,
      maxTravel: 0.28,
      stiffness: 40000,
      dampingBump: 2900,
      dampingRebound: 3700,
      antiRollFront: 11000,
      antiRollRear: 5000,
    },
    tires: { grip: 1.04, rearBias: 0.89, corneringStiffness: 10 },
    engine: { power: 175000, maxForce: 9500, drive: 'rwd', brakeForce: 13000, reverseForce: 5000 },
    aero: { drag: 2.6, downforce: 1.2 },
    steering: { maxAngle: 0.68 },
    nitro: { force: 7000, capacity: 1, burnRate: 0.3 },
    airControl: 0.9,
  },
  look: {
    body: 'coupe',
    colors: ['#7b3fe4', '#ff6a3d', '#14b8c4', '#e8e8e8', '#d6336c', '#111317'],
    accent: '#d9dde3',
    spoiler: true,
    roofRack: false,
    wheelWidth: 0.3,
  },
};
