import { it, describe } from 'node:test'
import assert from 'node:assert/strict'
import { IMPORT_COLUMNS, IMPORT_SCHEMA, buildEventData, flattenEvent, toCsv } from '../lib/utils.ts'

const event = {
  uid: 123,
  slug: 'festival-ete',
  title: { fr: "Festival d'été", en: 'Summer festival' },
  description: { fr: 'Concerts gratuits', en: 'Free concerts' },
  keywords: { fr: ['musique', 'concert'], en: ['music'] },
  firstTiming: { begin: '2026-07-01T18:00:00.000+0200' },
  nextTiming: { begin: '2026-07-02T18:00:00.000+0200', end: '2026-07-02T23:00:00.000+0200' },
  lastTiming: { end: '2026-07-05T23:00:00.000+0200' },
  timings: [{ begin: '2026-07-01T18:00:00.000+0200', end: '2026-07-01T23:00:00.000+0200' }],
  image: { base: 'https://cdn.openagenda.com/main/', filename: 'abc.jpg' },
  location: { uid: 42, name: 'Parc', address: '1 rue des Fleurs', city: 'Bordeaux', postalCode: '33000', countryCode: 'FR', latitude: 44.84, longitude: -0.58 },
  attendanceMode: 1,
  updatedAt: '2026-06-01T10:00:00.000Z'
}

describe('flattenEvent', () => {
  it('flattens a multilingual event in the configured language', () => {
    const row = flattenEvent(event, 'fr', 'bordeaux-metropole')
    assert.equal(row.title, "Festival d'été")
    assert.equal(row.description, 'Concerts gratuits')
    assert.equal(row.keywords, 'musique; concert')
    assert.equal(row.begin, '2026-07-01T18:00:00.000+0200')
    assert.equal(row.end, '2026-07-05T23:00:00.000+0200')
    assert.equal(row.next_begin_hour, '18:00')
    assert.equal(row.next_end_hour, '23:00')
    assert.equal(row.image, 'https://cdn.openagenda.com/main/abc.jpg')
    assert.equal(row.city, 'Bordeaux')
    assert.equal(row.country, 'FR')
    assert.equal(row.latitude, '44.84')
    assert.equal(row.agenda_uid, 'bordeaux-metropole')
  })

  it('falls back to the first available language', () => {
    const row = flattenEvent(event, 'de', 'demo')
    assert.equal(row.title, "Festival d'été")
  })

  it('handles an event without timings or location', () => {
    const row = flattenEvent({ uid: 1, title: 'Seul' }, 'fr', 'demo')
    assert.equal(row.title, 'Seul')
    assert.equal(row.begin, '')
    assert.equal(row.city, '')
    assert.equal(row.timings, '')
  })
})

describe('toCsv', () => {
  it('quotes cells containing separators, quotes or newlines', () => {
    const csv = toCsv(['a', 'b'], [{ a: 'x,y', b: 'ligne "citee"\n2' }])
    assert.equal(csv, 'a,b\n"x,y","ligne ""citee""\n2"\n')
  })
})

describe('buildEventData', () => {
  const columns = {
    titleColumn: 'titre',
    descriptionColumn: 'description',
    beginColumn: 'debut',
    endColumn: 'fin'
  }

  it('builds a physical event when a location column is mapped', () => {
    const data = buildEventData(
      { titre: 'Concert', description: 'Un concert', debut: '2026-07-01T18:00:00+0200', fin: '2026-07-01T20:00:00+0200', lieu: '42' },
      { ...columns, locationUidColumn: 'lieu' }
    )
    assert.deepEqual(data, {
      title: 'Concert',
      description: 'Un concert',
      timings: [{ begin: '2026-07-01T18:00:00+0200', end: '2026-07-01T20:00:00+0200' }],
      locationUid: 42,
      attendanceMode: 1
    })
  })

  it('builds an online event when an access link column is mapped', () => {
    const data = buildEventData(
      { titre: 'Webinaire', description: 'En ligne', debut: '2026-07-01T18:00:00+0200', fin: '2026-07-01T20:00:00+0200', lien: 'https://example.com' },
      { ...columns, onlineAccessLinkColumn: 'lien' }
    )
    assert.equal(data.attendanceMode, 2)
    assert.equal(data.onlineAccessLink, 'https://example.com')
  })

  it('rejects a row without title or without schedule', () => {
    assert.throws(() => buildEventData({ titre: '', description: 'x' }, { ...columns, locationUidColumn: 'l' }), /titre vide/)
    assert.throws(() => buildEventData({ titre: 'x', description: 'y' }, { ...columns, locationUidColumn: 'l' }), /horaires incomplets/)
    assert.throws(
      () => buildEventData({ titre: 'x', description: 'y', debut: 'a', fin: 'b' }, columns),
      /aucun lieu ni lien/
    )
  })
})

describe('IMPORT_SCHEMA', () => {
  it('describes every column produced by flattenEvent', () => {
    assert.deepEqual(IMPORT_COLUMNS, Object.keys(flattenEvent(event, 'fr', 'demo')))
  })

  it('keeps postal codes as strings and geolocates the events', () => {
    const property = (key: string) => IMPORT_SCHEMA.find(p => p.key === key)
    assert.deepEqual(property('postal_code')?.['x-transform'], { type: 'string' })
    assert.equal(property('latitude')?.['x-refersTo'], 'http://www.w3.org/2003/01/geo/wgs84_pos#lat')
    assert.equal(property('longitude')?.['x-refersTo'], 'http://www.w3.org/2003/01/geo/wgs84_pos#long')
  })
})
