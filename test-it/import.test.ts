import { it, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fetchEvents } from '../lib/import.ts'
import { requestStop, resetStop } from '../lib/utils.ts'

const silentLog: any = new Proxy({}, { get: () => async () => {} })

/** A fake context whose axios serves the given pages, chained by their `after` cursor. */
const importContext = (pages: { events: any[], after: any }[], onGet?: (params: any) => void) => {
  const calls: any[] = []
  const axios = {
    get: async (_url: string, { params }: any) => {
      calls.push(params)
      onGet?.(params)
      return { data: { total: pages.reduce((n, p) => n + p.events.length, 0), ...pages[calls.length - 1] } }
    }
  }
  const context: any = { processingConfig: { agendaUid: '123', lang: 'fr', relative: ['upcoming'] }, axios, log: silentLog }
  return { context, calls }
}

describe('fetchEvents', () => {
  beforeEach(resetStop)

  it('follows the after cursor until the API returns none, with detailed events', async () => {
    const { context, calls } = importContext([
      { events: [{ uid: 1, title: { fr: 'Un' } }], after: ['a', 1] },
      { events: [{ uid: 2, title: { fr: 'Deux' } }], after: null }
    ])
    const rows = await fetchEvents(context, 'key')
    assert.deepEqual(rows.map(r => r.title), ['Un', 'Deux'])
    assert.equal(calls.length, 2)
    assert.equal(calls[0].detailed, 1)
    assert.deepEqual(calls[0].relative, ['upcoming'])
    assert.equal(calls[0].after, undefined)
    assert.deepEqual(calls[1].after, ['a', 1])
  })

  it('stops reading pages once the processing is stopped', async () => {
    const { context, calls } = importContext([
      { events: [{ uid: 1 }], after: ['a'] },
      { events: [{ uid: 2 }], after: ['b'] }
    ], () => requestStop())
    const rows = await fetchEvents(context, 'key')
    assert.equal(calls.length, 1)
    assert.equal(rows.length, 1)
  })
})
