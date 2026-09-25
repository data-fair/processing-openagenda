import type { RunFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import { resetStop, requestStop } from './utils.ts'

/**
 * Dispatch to the import or export run according to the selected action. The datasetMode is shared
 * by both actions: `create` and `update` import events into a dataset, `export` pushes a dataset.
 */
export const run: RunFunction<ProcessingConfig> = async (context) => {
  resetStop()
  if (context.processingConfig.datasetMode === 'export') {
    const { runExport } = await import('./export.ts')
    await runExport(context)
  } else {
    const { runImport } = await import('./import.ts')
    await runImport(context)
  }
}

/** Sets the stop flag checked by the import/export loops so the run exits gracefully. */
export const stop = async () => { requestStop() }
