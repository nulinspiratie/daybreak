import type { Db } from './adapter'

export async function openDatabase(path: string | ':memory:'): Promise<Db> {
  // The specifier lives in a variable so Vite never tries to resolve `bun:sqlite`.
  const specifier = typeof Bun !== 'undefined' ? './sqlite-bun' : './sqlite-node'
  const driver = (await import(/* @vite-ignore */ specifier)) as { open(path: string): Promise<Db> }
  return driver.open(path)
}
