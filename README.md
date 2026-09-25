# <img alt="Data FAIR logo" src="https://cdn.jsdelivr.net/gh/data-fair/data-fair@master/ui/public/assets/logo.svg" width="30"> @data-fair/processing-openagenda

Plugin for [data-fair/processings](https://github.com/data-fair/processings) to import events from an [OpenAgenda](https://openagenda.com) agenda into Data-Fair, and to export a Data-Fair dataset as events to an agenda.

## Features

- **Import events** — read the events of an agenda (pagination included) and write them to a Data Fair dataset, one row per event. The dataset is created on the first run, then refreshed on every following run.
- **Ready-to-visualize columns** — multilingual fields are flattened in the configured language, and the columns keep the names used by the historical OpenAgenda import course (`begin`, `end`, `next_date`, `image_filename`, `latitude`…), so existing applications keep working.
- **Time filter** — import only the events that are current, upcoming, passed, or any combination of the three.
- **Export events** — read a dataset and create or update one event per row, upserted by an external identifier so re-runs update the same events instead of duplicating them.
- **Secrets** — the OpenAgenda public key (read) and write secret key are stored in the processing's secrets, never in the stored config.
- **Graceful stop** — honours the stop signal from the platform and exits cleanly between two pages or two exported events.

## Configuration

| Tab | Field | Description |
| --- | ----- | ----------- |
| Action | `datasetMode` | `create` / `update` to import events into a dataset, `export` to push a dataset as events |
| Jeu de données | `datasetTitle` / `dataset` | Dataset to create/update (import) or dataset to read from (export) |
| OpenAgenda | `agendaUid` | Numeric identifier or URL code of the agenda |
| OpenAgenda | `apiKey` | Public API key, sent in the `key` header (import) |
| OpenAgenda | `secretKey` | Write secret key, exchanged for an access token (export) |
| OpenAgenda | `lang` | Language used for the multilingual fields (default `fr`) |
| OpenAgenda | `relative` | Events to import: current / upcoming / passed |
| OpenAgenda | `extIdKey` | External identifier key stored on exported events (default `data-fair`) |
| Champs à exporter | `extIdColumn` | Column holding the stable identifier used for the upsert |
| Champs à exporter | `titleColumn`, `descriptionColumn` | Columns mapped to the event title and short description |
| Champs à exporter | `beginColumn`, `endColumn` | Columns holding the ISO 8601 start and end dates |
| Champs à exporter | `locationUidColumn` | Optional OpenAgenda location identifier (physical events) |
| Champs à exporter | `onlineAccessLinkColumn` | Optional online access link (online events without a location) |

## Release

Publishing is handled automatically by CI: the plugin is pushed to the data-fair registry (`@data-fair/registry`), not to the public npm registry — there is no manual `npm publish`. A push to `main`/`master` publishes to the staging registry; pushing a `v*` tag publishes to production:

```bash
npm version minor       # version bump + v* tag
git push --follow-tags  # CI publishes to the production registry
```
