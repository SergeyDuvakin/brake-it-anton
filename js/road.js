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
 */

export const VIEW = {
  panel: { x: 24, y: 24, w: 1010, h: 852 },
  vanishX: 529,
  vanishY: 96,
  camBack: 64,
  camLift: 38656,
  focal: 4638,
  roadHalf: 3.45,
  sideHalf: 5.55,
  look: 86,
  near: -8,
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
