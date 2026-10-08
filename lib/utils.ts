import type { ProcessingConfig } from '#types/processingConfig/index.ts'

/** Base URL of the OpenAgenda REST API (v2). */
export const OPENAGENDA_API = 'https://api.openagenda.com/v2'

// Set by the `stop` export, checked by the run loops so an interrupted run exits gracefully.
let shouldBeStopped = false
export const resetStop = () => { shouldBeStopped = false }
export const requestStop = () => { shouldBeStopped = true }
export const isStopped = () => shouldBeStopped

/** Maximum number of events returned by one page (OpenAgenda caps `size` at 300). */
export const EVENTS_PAGE_SIZE = 300

/** Timeout of the OpenAgenda calls: the worker's axios sets none, a stalled connection would hang the run. */
export const OPENAGENDA_TIMEOUT = 60000

/** Maximum number of dataset lines read per page when exporting. */
export const LINES_PAGE_SIZE = 1000

type Retry429Opts = { log?: { warning: (msg: string) => any }, retries?: number, delayMs?: number, source?: string }

/**
 * Run an async call, retrying on HTTP 429 (Too Many Requests): both OpenAgenda and Data-Fair
 * rate-limit bursts, so we pause and retry rather than failing the whole run. Only 429 is retried —
 * other errors are rethrown immediately. Only for POST/PATCH calls: the worker's axios already
 * retries GET/PUT/DELETE on 429 and 5xx, wrapping them too would stack both retries. `fn` is a thunk so the request is rebuilt on each attempt
 * (important for FormData bodies, which can only be consumed once).
 */
export const withRetry429 = async <T>(fn: () => Promise<T>, opts: Retry429Opts = {}): Promise<T> => {
  const { log, retries = 3, delayMs = 10000, source = 'OpenAgenda' } = opts
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.status ?? err?.response?.status
      if (status !== 429 || attempt >= retries) throw err
      attempt++
      if (log) await log.warning(`429 reçu de ${source} — pause ${delayMs / 1000}s avant nouvelle tentative (${attempt}/${retries})`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

/** Run a Data-Fair call with the 429 retry. */
export const dfRetry = <T>(fn: () => Promise<T>, log?: { warning: (msg: string) => any }): Promise<T> =>
  withRetry429(fn, { log, source: 'Data-Fair' })

/** Run an OpenAgenda call with the 429 retry. */
export const oaRetry = <T>(fn: () => Promise<T>, log?: { warning: (msg: string) => any }): Promise<T> =>
  withRetry429(fn, { log, source: 'OpenAgenda' })

/** HTTP status and response body of an axios error, as shaped by the worker or by the tests utils. */
export const errorDetail = (err: any): { status?: number, body: string } => {
  const data = err?.data ?? err?.response?.data
  const body = data === undefined || data === null ? '' : typeof data === 'string' ? data : JSON.stringify(data)
  return { status: err?.status ?? err?.response?.status, body }
}

const text = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join('; ')
  return String(value)
}

/**
 * Read a multilingual field (title, description, keywords…) in the configured language, falling
 * back to the first available language so an event is never dropped just because it is not
 * translated. Multilingual fields are objects keyed by language code; monolingual reads return
 * plain strings, which pass through unchanged.
 */
const pickLang = (value: unknown, lang: string): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.join('; ')
  if (typeof value === 'object') {
    const byLang = value as Record<string, unknown>
    const picked = byLang[lang] ?? Object.values(byLang)[0]
    return text(picked)
  }
  return String(value)
}

/** `HH:mm` part of an ISO 8601 date, or an empty string. */
const timeOf = (iso: unknown): string => {
  const match = typeof iso === 'string' ? /T(\d{2}:\d{2})/.exec(iso) : null
  return match ? match[1] : ''
}

type SchemaProperty = {
  key: string
  title: string
  type: string
  format?: string
  'x-refersTo'?: string
  'x-display'?: string
  'x-transform'?: { type: string }
  'x-capabilities'?: Record<string, boolean>
}

/** Long texts: no keyword index, as data-fair would have set them had it detected the column itself. */
const longTextCapabilities = { index: false, values: false, insensitive: false }

/**
 * Schema of the dataset produced by an import run, sent with every upload. The column keys keep the
 * names used by the historical OpenAgenda import course (begin, end, next_date, image_filename…), so
 * existing applications and tutorials keep working, plus a few raw OpenAgenda fields. The concepts
 * make the dataset usable as is (map, calendar), and data-fair still sets the types it detects, except
 * where `x-transform` pins one.
 */
export const IMPORT_SCHEMA: SchemaProperty[] = [
  { key: 'uid', title: 'Identifiant OpenAgenda', type: 'integer' },
  { key: 'slug', title: 'Code URL', type: 'string' },
  { key: 'title', title: 'Titre', type: 'string', 'x-refersTo': 'http://www.w3.org/2000/01/rdf-schema#label' },
  { key: 'description', title: 'Description', type: 'string', 'x-refersTo': 'http://schema.org/description' },
  { key: 'long_description', title: 'Description longue', type: 'string', 'x-display': 'markdown', 'x-capabilities': longTextCapabilities },
  { key: 'conditions', title: 'Conditions', type: 'string' },
  { key: 'keywords', title: 'Mots clés', type: 'string' },
  { key: 'begin', title: 'Début', type: 'string', format: 'date-time', 'x-refersTo': 'https://schema.org/startDate' },
  { key: 'end', title: 'Fin', type: 'string', format: 'date-time', 'x-refersTo': 'https://schema.org/endDate' },
  { key: 'next_date', title: 'Prochaine date', type: 'string', format: 'date-time' },
  { key: 'next_begin_hour', title: 'Heure de début du prochain créneau', type: 'string' },
  { key: 'next_end_hour', title: 'Heure de fin du prochain créneau', type: 'string' },
  { key: 'timings', title: 'Créneaux', type: 'string', 'x-display': 'textarea', 'x-capabilities': longTextCapabilities },
  { key: 'image', title: 'Image', type: 'string', 'x-refersTo': 'http://schema.org/image' },
  { key: 'image_filename', title: "Nom du fichier de l'image", type: 'string' },
  { key: 'image_base', title: "Adresse de base de l'image", type: 'string' },
  { key: 'location_name', title: 'Nom du lieu', type: 'string' },
  { key: 'address', title: 'Adresse', type: 'string', 'x-refersTo': 'http://schema.org/address' },
  { key: 'city', title: 'Commune', type: 'string', 'x-refersTo': 'http://schema.org/City' },
  // a code, not a number: without the transform "01000" would be detected as the integer 1000
  { key: 'postal_code', title: 'Code postal', type: 'string', 'x-refersTo': 'http://schema.org/postalCode', 'x-transform': { type: 'string' } },
  { key: 'department', title: 'Département', type: 'string' },
  { key: 'region', title: 'Région', type: 'string', 'x-refersTo': 'https://schema.org/addressRegion' },
  { key: 'country', title: 'Code pays', type: 'string', 'x-refersTo': 'http://dbpedia.org/ontology/iso31661Code' },
  { key: 'latitude', title: 'Latitude', type: 'number', 'x-refersTo': 'http://www.w3.org/2003/01/geo/wgs84_pos#lat' },
  { key: 'longitude', title: 'Longitude', type: 'number', 'x-refersTo': 'http://www.w3.org/2003/01/geo/wgs84_pos#long' },
  { key: 'location_uid', title: 'Identifiant OpenAgenda du lieu', type: 'integer' },
  { key: 'attendance_mode', title: 'Mode de participation', type: 'integer' },
  { key: 'online_access_link', title: "Lien d'accès en ligne", type: 'string', 'x-refersTo': 'https://schema.org/WebPage' },
  { key: 'state', title: 'État de publication', type: 'integer' },
  { key: 'status', title: 'Statut', type: 'integer' },
  { key: 'agenda_uid', title: "Identifiant de l'agenda", type: 'string' },
  { key: 'created_at', title: 'Date de création', type: 'string', format: 'date-time', 'x-refersTo': 'http://schema.org/dateCreated' },
  { key: 'updated_at', title: 'Date de mise à jour', type: 'string', format: 'date-time' }
]

/** Columns of the dataset produced by an import run, in the schema order. */
export const IMPORT_COLUMNS = IMPORT_SCHEMA.map(property => property.key)

/** Flatten one OpenAgenda event into a dataset row (all values as strings, ready for CSV). */
export const flattenEvent = (event: any, lang: string, agendaUid: string): Record<string, string> => {
  const timings: any[] = Array.isArray(event?.timings) ? event.timings : []
  const firstBegin = event?.firstTiming?.begin ?? timings[0]?.begin ?? ''
  const lastEnd = event?.lastTiming?.end ?? timings[timings.length - 1]?.end ?? ''
  const nextBegin = event?.nextTiming?.begin ?? ''
  const location = event?.location ?? {}
  const imageBase = event?.image?.base ?? ''
  const imageFilename = event?.image?.filename ?? ''
  const image = imageBase && imageFilename ? imageBase.replace(/\/?$/, '/') + imageFilename : ''

  return {
    uid: text(event?.uid),
    slug: text(event?.slug),
    title: pickLang(event?.title, lang),
    description: pickLang(event?.description, lang),
    long_description: pickLang(event?.longDescription, lang),
    conditions: pickLang(event?.conditions, lang),
    keywords: pickLang(event?.keywords, lang),
    begin: text(firstBegin),
    end: text(lastEnd),
    next_date: text(nextBegin),
    next_begin_hour: timeOf(nextBegin),
    next_end_hour: timeOf(event?.nextTiming?.end),
    timings: timings.length ? JSON.stringify(timings) : '',
    image,
    image_filename: text(imageFilename),
    image_base: text(imageBase),
    location_name: pickLang(location.name, lang),
    address: text(location.address),
    city: text(location.city),
    postal_code: text(location.postalCode),
    department: text(location.department),
    region: text(location.region),
    country: text(location.countryCode),
    latitude: text(location.latitude),
    longitude: text(location.longitude),
    location_uid: text(location.uid),
    attendance_mode: text(event?.attendanceMode),
    online_access_link: text(event?.onlineAccessLink),
    state: text(event?.state),
    status: text(event?.status),
    agenda_uid: text(agendaUid),
    created_at: text(event?.createdAt),
    updated_at: text(event?.updatedAt)
  }
}

const csvCell = (value: unknown): string => {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** Serialize rows to CSV (comma separator, quoted when needed). */
export const toCsv = (columns: string[], rows: Record<string, unknown>[]): string => {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map(column => csvCell(row[column])).join(','))
  return lines.join('\n') + '\n'
}

/** Build the `data` payload of an OpenAgenda event from one dataset row. Throws on unusable rows. */
export const buildEventData = (
  row: Record<string, unknown>,
  config: Pick<ProcessingConfig, 'titleColumn' | 'descriptionColumn' | 'beginColumn' | 'endColumn' | 'locationUidColumn' | 'onlineAccessLinkColumn'>
): Record<string, unknown> => {
  const value = (column?: string): string => {
    if (!column) return ''
    const v = row[column]
    return v === null || v === undefined ? '' : String(v).trim()
  }

  const title = value(config.titleColumn)
  if (!title) throw new Error(`titre vide (colonne "${config.titleColumn}")`)
  const description = value(config.descriptionColumn)
  if (!description) throw new Error(`description vide (colonne "${config.descriptionColumn}")`)
  const begin = value(config.beginColumn)
  const end = value(config.endColumn)
  if (!begin || !end) throw new Error(`horaires incomplets (colonnes "${config.beginColumn}" / "${config.endColumn}")`)

  const data: Record<string, unknown> = {
    title,
    description,
    timings: [{ begin, end }]
  }

  const locationUid = value(config.locationUidColumn)
  const onlineAccessLink = value(config.onlineAccessLinkColumn)
  if (locationUid) {
    data.locationUid = Number(locationUid)
    data.attendanceMode = 1
  } else {
    if (!onlineAccessLink) throw new Error("aucun lieu ni lien d'accès en ligne")
    data.attendanceMode = 2
    data.onlineAccessLink = onlineAccessLink
  }

  return data
}
