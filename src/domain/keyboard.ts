/**
 * How much room a composer pinned to the bottom of the screen needs underneath it.
 *
 * `keyboard` is the height from React Native's keyboard events. On an iPhone that is the whole
 * keyboard measured from the bottom of the screen. On Android, React Native takes the system
 * bars off (ime minus navigation bar), but the app draws edge to edge, so the navigation bar
 * still sits under the keyboard and has to be added back or the box is hidden behind it.
 */
export function composerBottomRoom(os: string, keyboard: number, insetBottom: number, gap: number): number {
  if (!keyboard) return insetBottom + gap;
  return keyboard + (os === 'android' ? insetBottom : 0) + gap;
}
