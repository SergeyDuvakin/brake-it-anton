/**
 * Right column: the driver plate, a gap, then the brake plate.
 * Same x, width, corner radius and side margins. They do not overlap.
 */

export const PLATE_RADIUS = 26;
export const COLUMN_GAP = 16;

export const DRIVER_PLATE = { x: 1056, y: 24, w: 520, h: 620, radius: PLATE_RADIUS };
export const PEDAL_ZONE = { x: 1056, y: 660, w: 520, h: 216, radius: PLATE_RADIUS };

export const PAUSE_BUTTON = { x: 924, y: 22, w: 96, h: 90 };
/** Mood mark, inside the driver plate, below Anton's tap target. */
export const MOOD_TILE = { x: 1076, y: 500, w: 72, h: 64 };
/** Hint and the wake line. Inside the plate, not on the road. */
export const CALLOUT = { x: 1080, y: 576, w: 472, h: 48 };
/** Corrupt-save note. Title and garage only; it does not sit on the lane. */
export const NOTICE_BOX = { x: 36, y: 28, w: 420, h: 96 };

export function platesSeparated() {
  return DRIVER_PLATE.y + DRIVER_PLATE.h + COLUMN_GAP <= PEDAL_ZONE.y
    && DRIVER_PLATE.x === PEDAL_ZONE.x
    && DRIVER_PLATE.w === PEDAL_ZONE.w
    && DRIVER_PLATE.radius === PEDAL_ZONE.radius;
}
