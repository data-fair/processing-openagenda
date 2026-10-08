import { it, describe } from 'node:test'
import assert from 'node:assert/strict'
import prepare from '../lib/prepare.ts'

const baseImport = { datasetMode: 'create', datasetTitle: 'Agenda', agendaUid: 'demo' } as any

describe('prepare', () => {
  it('moves the API and secret keys to the secrets and masks them in the config', async () => {
    const res = await prepare({
      processingConfig: { ...baseImport, apiKey: 'public-key', secretKey: 'secret-key' } as any,
      secrets: {}
    })
    assert.equal(res.secrets!.apiKey, 'public-key')
    assert.equal(res.secrets!.secretKey, 'secret-key')
    assert.equal(res.processingConfig!.apiKey, '********')
    assert.equal(res.processingConfig!.secretKey, '********')
  })

  it('keeps the stored secrets when the config only holds the masked value', async () => {
    const res = await prepare({
      processingConfig: { ...baseImport, apiKey: '********', secretKey: '********' } as any,
      secrets: { apiKey: 'public-key', secretKey: 'secret-key' }
    })
    assert.equal(res.secrets!.apiKey, 'public-key')
    assert.equal(res.secrets!.secretKey, 'secret-key')
    assert.equal(res.processingConfig!.apiKey, '********')
  })

  it('deletes the stored secret when the field is emptied', async () => {
    const res = await prepare({
      processingConfig: { ...baseImport, apiKey: '' } as any,
      secrets: { apiKey: 'public-key' }
    })
    assert.ok(!('apiKey' in res.secrets!))
  })

  it('requires the public key to import', async () => {
    await assert.rejects(
      prepare({ processingConfig: { ...baseImport } as any, secrets: {} }),
      /Clé API publique/
    )
  })

  it('answers validation errors with a 400, so the API shows the message', async () => {
    const err: any = await prepare({ processingConfig: { ...baseImport } as any, secrets: {} }).then(() => null, e => e)
    assert.equal(err?.status, 400)
  })

  it('requires a dataset title to create a dataset', async () => {
    await assert.rejects(
      prepare({ processingConfig: { datasetMode: 'create', agendaUid: 'demo', apiKey: 'x' } as any, secrets: {} }),
      /Titre du jeu de données/
    )
  })

  it('requires a dataset to update', async () => {
    await assert.rejects(
      prepare({ processingConfig: { datasetMode: 'update', agendaUid: 'demo', apiKey: 'x' } as any, secrets: {} }),
      /Jeu de données à mettre à jour/
    )
  })

  const baseExport = {
    datasetMode: 'export',
    agendaUid: 'demo',
    dataset: { id: 'ds-1', title: 'Agenda' },
    extIdColumn: 'id',
    titleColumn: 'titre',
    descriptionColumn: 'description',
    beginColumn: 'debut',
    endColumn: 'fin',
    locationUidColumn: 'lieu'
  } as any

  it('accepts a complete export configuration', async () => {
    const res = await prepare({ processingConfig: { ...baseExport } as any, secrets: { secretKey: 'secret-key' } })
    assert.ok(res.secrets)
  })

  it('requires the secret key to export', async () => {
    await assert.rejects(
      prepare({ processingConfig: { ...baseExport } as any, secrets: {} }),
      /Clé secrète/
    )
  })

  it('requires every export column', async () => {
    await assert.rejects(
      prepare({ processingConfig: { ...baseExport, endColumn: undefined } as any, secrets: { secretKey: 's' } }),
      /Colonne de fin/
    )
  })

  it('requires a location or an online access link column', async () => {
    await assert.rejects(
      prepare({
        processingConfig: { ...baseExport, locationUidColumn: undefined, onlineAccessLinkColumn: undefined } as any,
        secrets: { secretKey: 's' }
      }),
      /lieu ou la colonne de lien d'accès/
    )
  })
})
