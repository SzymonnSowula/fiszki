export interface ProtoField {
  field: number
  value: number | Uint8Array
}

export function readProto(buf: Uint8Array): ProtoField[] {
  const out: ProtoField[] = []
  let i = 0

  const readVarint = (): number => {
    let value = 0
    let shift = 0
    while (i < buf.length && shift < 35) {
      const byte = buf[i++]
      value += (byte & 0x7f) * 2 ** shift
      if ((byte & 0x80) === 0) return value
      shift += 7
    }
    throw new Error('varint')
  }

  try {
    while (i < buf.length) {
      const key = readVarint()
      const field = Math.floor(key / 8)
      const wire = key & 7
      if (wire === 0) {
        out.push({ field, value: readVarint() })
      } else if (wire === 2) {
        const length = readVarint()
        if (length < 0 || i + length > buf.length) break
        out.push({ field, value: buf.slice(i, i + length) })
        i += length
      } else if (wire === 5) {
        i += 4
      } else if (wire === 1) {
        i += 8
      } else {
        break
      }
    }
  } catch {
    return out
  }

  return out
}

export function protoText(buf: Uint8Array, fieldNo: number): string {
  const decoder = new TextDecoder()
  const parts = readProto(buf)
    .filter((field) => field.field === fieldNo && field.value instanceof Uint8Array)
    .map((field) => decoder.decode(field.value as Uint8Array))
  return parts.join('')
}

export function protoVarint(buf: Uint8Array, fieldNo: number): number | null {
  const found = readProto(buf).find((field) => field.field === fieldNo && typeof field.value === 'number')
  return typeof found?.value === 'number' ? found.value : null
}

export function protoStrings(buf: Uint8Array): string[] {
  const decoder = new TextDecoder()
  const out: string[] = []
  for (const field of readProto(buf)) {
    if (!(field.value instanceof Uint8Array)) continue
    const text = decoder.decode(field.value)
    if (text.trim()) out.push(text)
  }
  return out
}
