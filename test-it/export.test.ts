import { it, describe } from 'node:test'
import assert from 'node:assert/strict'
import util from 'node:util'
import { requestAccessToken, runExport } from '../lib/export.ts'

const silentLog: any = new Proxy({}, { get: () => async () => {} })

describe('requestAccessToken', () => {
  it('does not leak the secret key when the token request fails', async () => {
    const axios = {
      post: async (_url: string, body: any) => {
        // the shape of an axios error: the request body (with the secret key) travels in config.data
        throw Object.assign(new Error('Request failed with status code 401'), {
          config: { method: 'post', data: JSON.stringify(body) },
          response: { status: 401, data: { message: 'invalid code' } }
        })
      }
    }
    const err: any = await requestAccessToken(axios, 'top-secret', silentLog).then(() => null, e => e)
    assert.ok(err, 'the request should fail')
    assert.match(err.message, /401/)
    assert.match(err.message, /invalid code/)
    // the worker logs util.inspect(err) in debug mode
    assert.doesNotMatch(util.inspect(err, { depth: 5 }), /top-secret/)
  })
})

const exportConfig = {
  datasetMode: 'export',
  agendaUid: '123',
  dataset: { id: 'ds-1', title: 'Source' },
  extIdKey: 'data-fair',
  extIdColumn: 'id',
  titleColumn: 'titre',
  descriptionColumn: 'description',
  beginColumn: 'debut',
  endColumn: 'fin',
  locationUidColumn: 'lieu'
}

const lines = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `e${i}`, titre: `Événement ${i}`, description: 'Description', debut: '2026-07-01T18:00:00+0200', fin: '2026-07-01T20:00:00+0200', lieu: '42'
}))

/** A fake context whose axios answers the token request, serves the lines in one page and delegates the upserts. */
const exportContext = (rows: any[], put: (url: string, body: any) => Promise<any>) => {
  const logs: { type: string, msg: string }[] = []
  const log: any = new Proxy({}, { get: (_target, type: string) => async (msg: string) => { logs.push({ type, msg }) } })
  const axios = {
    post: async () => ({ data: { access_token: 'token', expires_in: 3600 } }),
    get: async () => ({ data: { total: rows.length, results: rows } }),
    put
  }
  const context: any = { processingConfig: exportConfig, secrets: { secretKey: 'secret' }, log, axios }
  return { context, logs }
}

describe('runExport', () => {
  it('upserts each line by its external identifier, with the event fields at the root of the body', async () => {
    const calls: { url: string, body: any }[] = []
    const { context } = exportContext(lines(2), async (url, body) => { calls.push({ url, body }); return { data: {} } })
    await runExport(context)
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /\/agendas\/123\/events\/ext\/data-fair\/e0$/)
    assert.equal(calls[0].body.title, 'Événement 0')
    assert.equal(calls[0].body.data, undefined)
  })

  it('fails the run when lines could not be exported, and caps the logged errors', async () => {
    const { context, logs } = exportContext(lines(80), async (url) => {
      if (url.endsWith('/e0')) return { data: {} }
      throw Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { message: 'invalid' } } })
    })
    await assert.rejects(runExport(context), /79 ligne\(s\) sur 80/)
    assert.equal(logs.filter(l => l.type === 'error').length, 50)
    assert.ok(logs.some(l => l.type === 'warning' && /Plus de 50 lignes/.test(l.msg)))
  })

  it('stops at the first error concerning the whole agenda', async () => {
    let puts = 0
    const { context } = exportContext(lines(10), async () => {
      puts++
      throw Object.assign(new Error('Request failed with status code 403'), { response: { status: 403, data: { message: 'forbidden' } } })
    })
    await assert.rejects(runExport(context), /403/)
    assert.equal(puts, 1)
  })
})
