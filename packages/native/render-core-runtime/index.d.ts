import type { Buffer } from 'node:buffer'

export interface ParsedModelData {
  textureWidth: number
  textureHeight: number
  bones: Array<ParsedBone>
}

export interface ParsedBone {
  name: string
  parent?: string
  pivot: Array<number>
  rotation?: Array<number>
  vertices?: Float32Array
  uvs?: Float32Array
  indices?: Uint16Array
}

export declare function loadPeroModel(
  encryptedData: Buffer,
  filterPatterns?: Array<string> | undefined | null,
): ParsedModelData

export interface PeroContainerFile {
  path: string
  data: Buffer
}

export interface PeroContainer {
  files: Array<PeroContainerFile>
}

export declare function loadPeroContainer(encryptedData: Buffer): PeroContainer

export declare function loadStandardModel(
  jsonData: Buffer,
  filterPatterns?: Array<string> | undefined | null,
): ParsedModelData

export declare function getSecurityStatus(): boolean

export declare function sum(a: number, b: number): number
