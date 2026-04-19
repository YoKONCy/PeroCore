/// <reference types="node" />

export declare function encrypt(data: Buffer, key: string): Buffer

export declare function decrypt(data: Buffer, key: string): Buffer

export declare function verifyIntegrity(data: Buffer, hash: string): boolean
