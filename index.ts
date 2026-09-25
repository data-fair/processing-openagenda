import type { PrepareFunction, RunFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from './types/processingConfig/index.ts'

/**
 * Function to prepare a processing (triggered when the config is updated).
 * It validates the action-dependent fields and moves the OpenAgenda keys into the secrets.
 */
export const prepare: PrepareFunction<ProcessingConfig> = async (context) => {
  const prepare = (await import('./lib/prepare.ts')).default
  return prepare(context)
}

/**
 * Function to execute the processing (triggered when the processing is started).
 * Imports events from an OpenAgenda agenda into a dataset, or exports a dataset as events.
 */
export const run: RunFunction<ProcessingConfig> = async (context) => {
  const { run } = await import('./lib/run.ts')
  return run(context)
}

/**
 * Function to stop the processing (triggered when the processing is stopped).
 * It is used to manage interruption and prevent incoherent state.
 * The run method should finish shortly after calling stop.
 */
export const stop = async () => {
  const { stop } = await import('./lib/run.ts')
  return stop()
}
