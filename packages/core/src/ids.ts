import { customAlphabet } from 'nanoid'

const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

export function newId(): string {
  return generate()
}
