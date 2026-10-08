import { LINES_PAGE_SIZE, OPENAGENDA_API, OPENAGENDA_TIMEOUT, buildEventData, errorDetail, isStopped, oaRetry } from './utils.ts'
import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

type AccessToken = { token: string, expiresAt: number }

/** Statuses that concern the whole agenda, not one event: the export stops at the first one. */
const FATAL_STATUSES = [401, 403, 404]

/** Number of failed lines logged one by one, the others are only counted. */
const MAX_LOGGED_ERRORS = 50

/**
 * Exchange the write secret key for a short-lived access token. The secret key itself is never sent
 * to the events routes.
 */
export const requestAccessToken = async (axios: any, secretKey: string, log: ProcessingContext<ProcessingConfig>['log']): Promise<AccessToken> => {
  let res: any
  try {
    res = await oaRetry(() => axios.post(
      `${OPENAGENDA_API}/requestAccessToken`,
      { code: secretKey },
      { headers: { 'content-type': 'application/json' }, timeout: OPENAGENDA_TIMEOUT }
    ), log)
  } catch (err: any) {
    // never rethrow the axios error: its config.data holds the secret key, and the worker dumps
    // the whole error in the run log (debug mode). No `cause` either, for the same reason.
    const { status, body } = errorDetail(err)
    throw new Error(`échec de la demande de jeton d'accès OpenAgenda (${status ?? err?.message})${body ? ' : ' + body : ''}`)
  }
  const token = res.data?.access_token
  if (!token) throw new Error("réponse inattendue d'OpenAgenda à la demande de jeton d'accès")
  const expiresIn = Number(res.data?.expires_in) || 3600
  return { token, expiresAt: Date.now() + expiresIn * 1000 }
}

/** Read the source dataset page after page and upsert one OpenAgenda event per line. */
export const runExport = async (context: ProcessingContext<ProcessingConfig>) => {
  const { processingConfig, secrets, log, axios } = context
  const { agendaUid, dataset, extIdColumn, extIdKey } = processingConfig
  if (!agendaUid) throw new Error("Identifiant de l'agenda manquant, enregistrez la configuration avant d'exécuter le traitement.")
  if (!dataset?.id) throw new Error('Jeu de données source manquant, enregistrez la configuration avant d\'exécuter le traitement.')
  const secretKey = secrets?.secretKey
  if (!secretKey) throw new Error("Clé secrète OpenAgenda manquante, enregistrez la configuration avant d'exécuter le traitement.")
  const lang = processingConfig.lang || 'fr'

  await log.step("Authentification auprès d'OpenAgenda")
  let accessToken = await requestAccessToken(axios, secretKey, log)
  const getToken = async (): Promise<string> => {
    if (Date.now() > accessToken.expiresAt - 5 * 60 * 1000) {
      accessToken = await requestAccessToken(axios, secretKey, log)
      await log.info("Jeton d'accès renouvelé")
    }
    return accessToken.token
  }
  await log.info("Jeton d'accès obtenu, l'export peut commencer")

  const columns = ['extIdColumn', 'titleColumn', 'descriptionColumn', 'beginColumn', 'endColumn', 'locationUidColumn', 'onlineAccessLinkColumn']
    .map(field => (processingConfig as any)[field])
    .filter((column: unknown): column is string => typeof column === 'string' && column.length > 0)
  const select = [...new Set(columns)].join(',')
  let url: string | undefined = `api/v1/datasets/${dataset?.id}/lines?size=${LINES_PAGE_SIZE}&select=${encodeURIComponent(select)}`

  await log.step(`Export vers l'agenda ${agendaUid}`)
  const stats = { synced: 0, failed: 0 }
  let index = 0
  let total = 0

  await log.task('Événements exportés')
  while (url) {
    if (isStopped()) break
    const res: any = await axios.get(url)
    const results: any[] = res.data?.results ?? []
    total = res.data?.total ?? total

    for (const row of results) {
      if (isStopped()) break
      index++
      const rawExtId = extIdColumn ? row[extIdColumn] : undefined
      try {
        if (rawExtId === undefined || rawExtId === null || String(rawExtId).trim() === '') {
          throw new Error(`identifiant externe vide (colonne "${extIdColumn}")`)
        }
        const data = buildEventData(row, processingConfig)
        const token = await getToken()
        // the event fields are the JSON body itself: the `data` key of the OpenAgenda docs is the
        // axios request option (and the multipart field name), not a wrapper (see @openagenda/sdk-js)
        await axios.put(
          `${OPENAGENDA_API}/agendas/${encodeURIComponent(agendaUid)}/events/ext/${encodeURIComponent(extIdKey || 'data-fair')}/${encodeURIComponent(String(rawExtId))}`,
          data,
          { headers: { 'access-token': token, lang }, timeout: OPENAGENDA_TIMEOUT }
        )
        stats.synced++
      } catch (err: any) {
        const { status, body } = errorDetail(err)
        // the agenda itself is unreachable (bad token, no write access, unknown agenda):
        // every following line would fail the same way
        if (status && FATAL_STATUSES.includes(status)) {
          throw new Error(`OpenAgenda refuse l'écriture dans l'agenda ${agendaUid} (${status})${body ? ' : ' + body : ''}`)
        }
        stats.failed++
        // each log line is pushed in the run document: cap them so a systematic error cannot grow it without bound
        if (stats.failed <= MAX_LOGGED_ERRORS) {
          await log.error(`Échec de l'export de la ligne ${index} (id externe "${rawExtId}") : ${err.message}`, body)
        } else if (stats.failed === MAX_LOGGED_ERRORS + 1) {
          await log.warning(`Plus de ${MAX_LOGGED_ERRORS} lignes en erreur, les suivantes ne sont plus détaillées`)
        }
      }
      if (index % 10 === 0 || index === total) await log.progress('Événements exportés', index, total || index)
    }

    url = res.data?.next
  }

  await log.progress('Événements exportés', index, total || index)
  if (isStopped()) {
    await log.warning(`Traitement interrompu — ${stats.synced} événements synchronisés, ${stats.failed} en erreur`)
    return
  }

  await log.step('Rapport final')
  await log.info(`${index} lignes parcourues, ${stats.synced} événements synchronisés, ${stats.failed} en erreur`)
  if (stats.failed) throw new Error(`${stats.failed} ligne(s) sur ${index} n'ont pas pu être exportées`)
}
