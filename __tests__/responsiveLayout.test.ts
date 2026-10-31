import {
  calendarMonthMetrics,
  formColumnFrame,
  homeNavOccupiedHeight,
  homeTimerSize,
  layoutFromDims,
  sheetCardStyle,
  tilePixelWidth,
} from '../src/theme/responsiveLayout';

describe('responsive layout', () => {
  it('treats iPhone SE as a short phone, not a tablet', () => {
    const se = layoutFromDims(375, 667);
    expect(se.isShort).toBe(true);
    expect(se.isTablet).toBe(false);
    expect(se.tier).toBe('compact');
    expect(homeTimerSize(se, 20, 0, true)).toBeLessThanOrEqual(200);
    expect(homeTimerSize(se, 20, 0, true)).toBeGreaterThanOrEqual(160);
    expect(homeNavOccupiedHeight(se, 0)).toBe(se.navBar + 8);
  });

  it('keeps a regular iPhone timer at the phone design size', () => {
    const pro = layoutFromDims(390, 844);
    expect(pro.isShort).toBe(false);
    expect(pro.isTablet).toBe(false);
    expect(homeTimerSize(pro, 59, 34, false)).toBe(248);
  });

  it('grows the timer on iPad instead of leaving a 248pt stamp', () => {
    const ipad = layoutFromDims(768, 1024);
    expect(ipad.isTablet).toBe(true);
    expect(ipad.tier).toBe('regular');
    const size = homeTimerSize(ipad, 24, 20, true);
    expect(size).toBeGreaterThan(248);
    expect(size).toBeLessThanOrEqual(400);
  });

  it('uses expanded tier on large tablet landscape', () => {
    const wide = layoutFromDims(1366, 1024);
    expect(wide.isTablet).toBe(true);
    expect(wide.tier).toBe('expanded');
    expect(homeTimerSize(wide, 24, 20, false)).toBe(400);
  });

  it('uses readable form and sheet max widths on tablets', () => {
    const phone = layoutFromDims(375, 667);
    const ipad = layoutFromDims(768, 1024);
    const wide = layoutFromDims(1366, 1024);
    expect(phone.formMaxWidth).toBe(400);
    expect(ipad.formMaxWidth).toBe(560);
    expect(wide.formMaxWidth).toBe(720);
    expect(ipad.sheetMaxWidth).toBe(720);
    expect(ipad.tileColumns).toBe(4);
    expect(phone.tileColumns).toBe(3);
    expect(sheetCardStyle(ipad).maxWidth).toBe(720);
    expect(formColumnFrame(ipad).maxWidth).toBe(560);
    expect(tilePixelWidth(ipad)).toBeGreaterThan(tilePixelWidth(phone));
  });

  it('sizes the admin calendar from live window, not a captured phone width', () => {
    const se = calendarMonthMetrics(layoutFromDims(375, 667));
    const ipad = calendarMonthMetrics(layoutFromDims(768, 1024));
    expect(se.dayWidth).toBeCloseTo(375 / 7 - 4, 5);
    expect(ipad.dayWidth).toBeCloseTo(768 / 7 - 4, 5);
    expect(ipad.height).toBeGreaterThan(se.height);
  });
});
