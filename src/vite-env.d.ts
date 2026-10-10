/// <reference types="vite/client" />

declare module 'fzstd' {
  export function decompress(data: Uint8Array, maxOutputSize?: number): Uint8Array
}
