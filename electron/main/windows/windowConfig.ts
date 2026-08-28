export function resolveWindowBackground(config: { transparent: boolean }): string {
  return config.transparent ? '#00000000' : '#f6f2ff'
}
