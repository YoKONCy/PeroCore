export function resolveWindowBackground(config: { transparent: boolean }, dark = false): string {
  return config.transparent ? '#00000000' : dark ? '#15151d' : '#f6f2ff'
}
