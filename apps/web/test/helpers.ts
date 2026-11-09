import type { TreeNode } from '@daybreak/core'
import { vi } from 'vitest'
import type { api } from '../src/api/client'

export function node(
  id: string,
  children: TreeNode[] = [],
  over: Partial<TreeNode> = {},
): TreeNode {
  return {
    id,
    parentId: null,
    section: 'projects',
    position: 'a0',
    title: id,
    notes: '',
    link: null,
    scheduledOn: null,
    dayPosition: null,
    status: 'open',
    closedAt: null,
    deletedAt: null,
    collapsed: false,
    tags: [],
    createdAt: '',
    updatedAt: '',
    children,
    mark: null,
    doneCount: 0,
    totalCount: children.length,
    ...over,
  }
}

export type Call = [method: string, path: string, body?: unknown]
export type Reply = (method: string, path: string, body?: unknown) => unknown

export interface FakeApi {
  api: typeof api
  /** Every request, in the order it was made. */
  calls: Call[]
  /** Answers each request; may return a promise, or throw an ApiError. */
  reply: Reply
}

/** A stand-in for `api` that records calls and answers through `reply`. */
export function createFakeApi(): FakeApi {
  const fake: FakeApi = {
    calls: [],
    reply: () => undefined,
    api: {
      get: vi.fn(async (path: string) => {
        fake.calls.push(['GET', path])
        return fake.reply('GET', path)
      }),
      send: vi.fn(async (method: string, path: string, body?: unknown) => {
        fake.calls.push([method, path, body])
        return fake.reply(method, path, body)
      }),
    } as unknown as typeof api,
  }
  return fake
}
