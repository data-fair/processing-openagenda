import type { PrepareFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

/**
 * A validation error answered with a 400: a plain Error becomes a 500 in the processings API, whose
 * body is emptied in production, so the user would never see the message.
 */
const invalid = (message: string) => Object.assign(new Error(message), { status: 400 })

/** Export columns that an export run cannot work without, with a French label for the error. */
const REQUIRED_EXPORT_COLUMNS: [keyof ProcessingConfig, string][] = [
  ['extIdColumn', "Colonne d'identifiant externe"],
  ['titleColumn', 'Colonne du titre'],
  ['descriptionColumn', 'Colonne de la description courte'],
  ['beginColumn', 'Colonne de début'],
  ['endColumn', 'Colonne de fin']
]

/**
 * Validate the configuration and move the OpenAgenda keys out of the config into the secrets store.
 * The schema only requires `datasetMode` and `agendaUid`: the fields that depend on the selected
 * action (dataset, columns, keys) are validated here, so that the form can display all actions
 * without the hidden fields blocking validation.
 */
const prepare: PrepareFunction<ProcessingConfig> = async ({ processingConfig, secrets }) => {
  const isExport = processingConfig.datasetMode === 'export'

  if (isExport) {
    if (!processingConfig.dataset?.id) throw invalid('Jeu de données source manquant.')
    for (const [field, label] of REQUIRED_EXPORT_COLUMNS) {
      if (!processingConfig[field]) throw invalid(`${label} manquante.`)
    }
    if (!processingConfig.locationUidColumn && !processingConfig.onlineAccessLinkColumn) {
      throw invalid("Renseignez la colonne d'identifiant de lieu ou la colonne de lien d'accès en ligne.")
    }
  } else if (processingConfig.datasetMode === 'create') {
    if (!processingConfig.datasetTitle) throw invalid('Titre du jeu de données à créer manquant.')
  } else if (!processingConfig.dataset?.id) {
    throw invalid('Jeu de données à mettre à jour manquant.')
  }

  const apiKey = processingConfig.apiKey
  if (!isExport && !secrets.apiKey && (!apiKey || apiKey === '********')) {
    throw invalid("Clé API publique OpenAgenda manquante (lecture de l'agenda).")
  }
  const secretKey = processingConfig.secretKey
  if (isExport && !secrets.secretKey && (!secretKey || secretKey === '********')) {
    throw invalid("Clé secrète OpenAgenda manquante (écriture dans l'agenda).")
  }

  if (apiKey && apiKey !== '********') {
    secrets.apiKey = apiKey
    processingConfig.apiKey = '********'
  } else if (secrets.apiKey && apiKey === '') {
    delete secrets.apiKey
  }

  if (secretKey && secretKey !== '********') {
    secrets.secretKey = secretKey
    processingConfig.secretKey = '********'
  } else if (secrets.secretKey && secretKey === '') {
    delete secrets.secretKey
  }

  return { processingConfig, secrets }
}

export default prepare
