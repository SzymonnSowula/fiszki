import initSqlJs, { type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

let pending: Promise<SqlJsStatic> | null = null

export function loadSql(): Promise<SqlJsStatic> {
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(wasmUrl)
        if (!response.ok) throw new Error('Nie udało się wczytać silnika bazy.')
        const wasmBinary = await response.arrayBuffer()
        return initSqlJs({ wasmBinary })
      } catch (error) {
        pending = null
        throw error
      }
    })()
  }
  return pending
}
