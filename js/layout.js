/**
 * Right column: the driver plate, a gap, then the brake plate.
 * Same x, width, corner radius and side margins. They do not overlap.
 */

export const PLATE_RADIUS = 26;
export const COLUMN_GAP = 16;

export const DRIVER_PLATE = { x: 1056, y: 24, w: 520, h: 620, radius: PLATE_RADIUS };
export const PEDAL_ZONE = { x: 1056, y: 660, w: 520, h: 216, radius: PLATE_RADIUS };

export function platesSeparated() {
  return DRIVER_PLATE.y + DRIVER_PLATE.h + COLUMN_GAP <= PEDAL_ZONE.y
    && DRIVER_PLATE.x === PEDAL_ZONE.x
    && DRIVER_PLATE.w === PEDAL_ZONE.w
    && DRIVER_PLATE.radius === PEDAL_ZONE.radius;
}
