// The app's four destinations with their line icons (24px grid, stroke 2),
// shared by the desktop sidebar and the phone tab bar so they can never
// disagree.
export type IconPath =
  | { rect: { x: number, y: number, width: number, height: number, rx: number } }
  | { line: { x1: number, y1: number, x2: number, y2: number } }
  | { circle: { cx: number, cy: number, r: number, fill?: string, stroke?: string } }
  | { polyline: { points: string } }
  | { path: { d: string } }

export interface NavItem { label: string, short: string, to: string, paths: IconPath[] }

export const NAV_ITEMS: NavItem[] = [
  {
    label: 'Tinkrr',
    short: 'Tinkrr',
    to: '/tinkrr',
    paths: [
      { rect: { x: 3, y: 4, width: 18, height: 16, rx: 2.5 } },
      { line: { x1: 3, y1: 9.5, x2: 21, y2: 9.5 } },
      { line: { x1: 3, y1: 14.75, x2: 21, y2: 14.75 } },
      { line: { x1: 14, y1: 9.5, x2: 14, y2: 20 } }
    ]
  },
  {
    label: 'Calendrr',
    short: 'Calendrr',
    to: '/calendrr',
    paths: [
      { rect: { x: 3, y: 5, width: 18, height: 16, rx: 2.5 } },
      { line: { x1: 3, y1: 10, x2: 21, y2: 10 } },
      { line: { x1: 8, y1: 2.5, x2: 8, y2: 6.5 } },
      { line: { x1: 16, y1: 2.5, x2: 16, y2: 6.5 } },
      { circle: { cx: 8.5, cy: 14.5, r: 1.1, fill: 'currentColor', stroke: 'none' } },
      { circle: { cx: 12.5, cy: 14.5, r: 1.1, fill: 'currentColor', stroke: 'none' } }
    ]
  },
  {
    label: 'Debt Colectrr',
    short: 'Debt',
    to: '/debt-colectrr',
    paths: [
      { polyline: { points: '3,6 8,10 13,14 21,19' } },
      { polyline: { points: '15.5,19 21,19 21,13.5' } }
    ]
  },
  {
    label: 'Remembrr',
    short: 'Story',
    to: '/remembrr',
    paths: [
      { path: { d: 'M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3Z' } },
      { path: { d: 'M19 17H8a3 3 0 0 0-3 3' } },
      { line: { x1: 9, y1: 8, x2: 15, y2: 8 } }
    ]
  }
]
