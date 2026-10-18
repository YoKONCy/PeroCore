export type WeatherKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'thunder' | 'mist'

export interface WeatherDay {
  date: string
  low: number
  high: number
  condition: string
  kind: WeatherKind
  rainChance: number | null
}

export interface WeatherSnapshot {
  query: string
  location: string
  latitude: number
  longitude: number
  temperature: number
  feelsLike: number
  humidity: number
  windKmh: number
  condition: string
  kind: WeatherKind
  observedTime: string
  fetchedAt: string
  days: WeatherDay[]
  source: 'wttr.in'
}

export interface WeatherStatus {
  query: string
  snapshot: WeatherSnapshot | null
  refreshing: boolean
  stale: boolean
  error: string | null
}
