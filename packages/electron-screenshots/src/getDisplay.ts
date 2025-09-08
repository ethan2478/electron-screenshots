import { Rectangle, screen } from 'electron';

export interface Display extends Rectangle {
  id: number;
  scaleFactor: number;
}

/**
 * 获取鼠标所在屏幕
 */
export const getCursorDisplay = (): Display => {
  const point = screen.getCursorScreenPoint();
  const { id, bounds, scaleFactor } = screen.getDisplayNearestPoint(point);

  // https://github.com/nashaofu/screenshots/issues/98
  return {
    id,
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.floor(bounds.width),
    height: Math.floor(bounds.height),
    scaleFactor,
  };
};

/**
 * 获取所有屏幕
 */
export const getAllDisplays = (): Display[] => {
  const displays = screen.getAllDisplays();

  return displays.map((display) => ({
    id: display.id,
    x: Math.floor(display.bounds.x),
    y: Math.floor(display.bounds.y),
    width: Math.floor(display.bounds.width),
    height: Math.floor(display.bounds.height),
    scaleFactor: display.scaleFactor,
  }));
};
