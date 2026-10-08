import { EVENTS_PAGE_SIZE, IMPORT_COLUMNS, IMPORT_SCHEMA, OPENAGENDA_API, OPENAGENDA_TIMEOUT, dfRetry, flattenEvent, isStopped, toCsv } from './utils.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import path from 'node:path'
import FormData from 'form-data'

const getContentLength = async (formData: FormData): Promise<number> => {
  return await promisify(formData.getLength.bind(formData))() as number
}

/**
 * Read every event of the agenda, page after page, using the `after` cursor returned by the API, and
 * flatten each page right away so the raw (detailed) events are never all held in memory.
 * A repeated cursor (or an empty page) stops the loop, so a broken API response cannot loop forever.
 */
export const fetchEvents = async (context: ProcessingContext<ProcessingConfig>, apiKey: string): Promise<Record<string, string>[]> => {
  const { processingConfig, axios, log } = context
  const { relative } = processingConfig
  const agendaUid = processingConfig.agendaUid
  if (!agendaUid) throw new Error("Identifiant de l'agenda manquant.")
  const lang = processingConfig.lang || 'fr'
  const url = `${OPENAGENDA_API}/agendas/${encodeURIComponent(agendaUid)}/events`
  const rows: Record<string, string>[] = []
  let after: any[] | undefined
  let total = 0

  await log.task('Événements récupérés')
  while (true) {
    if (isStopped()) break
    // without `detailed`, the API only returns a subset of the fields (no timings details among others)
    const params: Record<string, any> = { size: EVENTS_PAGE_SIZE, detailed: 1 }
    if (relative?.length) params.relative = relative
    if (after) params.after = after

    const res = await axios.get(url, { params, headers: { key: apiKey }, timeout: OPENAGENDA_TIMEOUT })
    const page = res.data?.events
    if (!Array.isArray(page)) throw new Error("réponse inattendue de l'API OpenAgenda (clé events absente)")
    total = res.data.total ?? total
    for (const event of page) rows.push(flattenEvent(event, lang, agendaUid))
    await log.progress('Événements récupérés', rows.length, Math.max(total, rows.length))

    const next = res.data.after
    if (!page.length || !next || JSON.stringify(next) === JSON.stringify(after)) break
    after = next
  }

  return rows
}

export const runImport = async (context: ProcessingContext<ProcessingConfig>) => {
  const { processingConfig, secrets, log, processingId, patchConfig, axios, tmpDir } = context
  const { datasetMode } = processingConfig
  const agendaUid = processingConfig.agendaUid
  if (!agendaUid) throw new Error("Identifiant de l'agenda manquant, enregistrez la configuration avant d'exécuter le traitement.")
  const apiKey = secrets?.apiKey
  if (!apiKey) throw new Error("Clé API OpenAgenda manquante, enregistrez la configuration avant d'exécuter le traitement.")

  await log.step(`Récupération des événements de l'agenda ${agendaUid}`)
  const rows = await fetchEvents(context, apiKey)

  if (isStopped()) {
    await log.warning(`Traitement interrompu — ${rows.length} événements récupérés, aucun import effectué`)
    return
  }
  if (!rows.length) {
    await log.warning('Aucun événement ne correspond aux filtres, le jeu de données est laissé inchangé')
    return
  }

  await log.step('Conversion des événements en jeu de données')
  const csvPath = path.join(tmpDir, 'events.csv')
  await writeFile(csvPath, toCsv(IMPORT_COLUMNS, rows), 'utf8')
  await log.info(`${rows.length} événements convertis (${IMPORT_COLUMNS.length} colonnes)`)

  await log.step('Chargement vers le jeu de données')
  const dataset = await dfRetry(async () => {
    const formData = new FormData()
    // the title is only set at creation: on update it belongs to the dataset, and may have been renamed
    if (datasetMode === 'create' && processingConfig.datasetTitle) formData.append('title', processingConfig.datasetTitle)
    formData.append('schema', JSON.stringify(IMPORT_SCHEMA))
    formData.append('file', createReadStream(csvPath), { filename: 'events.csv' })
    const contentLength = await getContentLength(formData)
    return axios({
      method: 'post',
      url: datasetMode === 'update' ? `api/v1/datasets/${processingConfig.dataset?.id}` : 'api/v1/datasets',
      data: formData,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { ...formData.getHeaders(), 'content-length': contentLength.toString() }
    })
  }, log).then(res => res.data)

  // Tag the dataset so it can be traced back to this processing, then switch to update mode so the
  // next run refreshes it instead of creating a second one.
  await dfRetry(() => axios.patch(`api/v1/datasets/${dataset.id}`, { extras: { ...(dataset.extras ?? {}), processingId } }), log)
  if (datasetMode === 'create') {
    await patchConfig({ datasetMode: 'update', dataset: { id: dataset.id, title: dataset.title } })
    await log.info('Traitement basculé en mode mise à jour')
  }
  await log.info(`Jeu de données ${datasetMode === 'create' ? 'créé' : 'mis à jour'} : ${dataset.title} (${dataset.id})`)
}
