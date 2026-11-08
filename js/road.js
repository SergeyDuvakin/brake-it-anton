/**
 * One forward projection for the road, the markings and every prop.
 *
 * The camera sits behind the car and looks toward a single vanishing point
 * at the top of the road panel. Screen position is a function of world
 * distance ahead of the car (ds) and world lateral position (xm, metres,
 * right of the centre line). There is no second vanishing point and no
 * screen-space shape that scrolls on its own.
 *
 * On a straight road the centre line is a vertical line through the
 * vanishing point. A point in the world moves down the screen and away
 * from that point as the car approaches. It does not reverse sideways.
 *
 * The camera sits far enough back that a car in the side lane does not
 * shear into a wide silhouette. At the car, one metre along the road
 * and one metre across it are about the same number of pixels, so the
 * top-down drawing keeps its proportions. The tail stays inside the
 * panel, and the next forty metres of road stay on it.
 */

import { CFG } from "./config.js";

export const VIEW = {
  panel: { x: 24, y: 24, w: 1010, h: 852 },
  vanishX: 529,
  vanishY: -348,
  camBack: 27.65,
  camLift: 30725,
  focal: 1100,
  roadHalf: CFG.roadHalf,
  sideHalf: 5.05,
  look: 72,
  near: -7,
};

export function project(ds, xm) {
  const z = Math.max(0.85, ds + VIEW.camBack);
  const y = VIEW.vanishY + VIEW.camLift / z;
  const x = VIEW.vanishX + (xm * VIEW.focal) / z;
  const edge = (VIEW.roadHalf * VIEW.focal) / z;
  const nearEdge = (VIEW.roadHalf * VIEW.focal) / VIEW.camBack;
  return {
    x,
    y,
    z,
    edge,
    scale: Math.max(0.2, Math.min(1.25, edge / nearEdge)),
  };
}

/** World s values currently in the forward view, near edge first. */
export function viewRange(carS) {
  return { nearS: carS + VIEW.near, farS: carS + VIEW.look };
}
