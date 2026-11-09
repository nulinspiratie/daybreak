import { customAlphabet } from 'nanoid'

const generate = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)
let generator: () => string = generate

export function newId(): string {
  return generator()
}

/** Test seam: replace the id generator; call with no argument to go back to nanoid. */
export function setIdGenerator(fn?: () => string): void {
  generator = fn ?? generate
}
