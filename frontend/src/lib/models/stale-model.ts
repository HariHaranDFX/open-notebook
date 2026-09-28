import type { ModelDefaults } from '@/lib/types/models'

/** Null until the model list has loaded, so a slow fetch is not treated as "every model was removed". */
export function knownModelIds(
  models: { id: string }[] | undefined,
  loaded: boolean,
): ReadonlySet<string> | null {
  if (!loaded) return null
  return new Set(models?.map((model) => model.id) ?? [])
}

/** A saved id is broken when the list has loaded and that id is not in it. */
export function isStaleModelId(
  id: string | null | undefined,
  knownIds: ReadonlySet<string> | null,
): boolean {
  if (!id || knownIds === null) return false
  return !knownIds.has(id)
}

export function resolvedModelLabel(
  id: string | null | undefined,
  names: Record<string, string>,
  knownIds: ReadonlySet<string> | null,
  missing: string,
  removed: string,
): { text: string; warning: boolean } {
  if (!id) return { text: missing, warning: true }
  const name = names[id]
  if (name) return { text: name, warning: false }
  if (isStaleModelId(id, knownIds)) return { text: removed, warning: true }
  return { text: id, warning: false }
}

const DEFAULT_SLOTS: { field: keyof ModelDefaults; labelKey: string }[] = [
  { field: 'default_chat_model', labelKey: 'models.chatModelLabel' },
  { field: 'default_transformation_model', labelKey: 'models.transformationModelLabel' },
  { field: 'default_tools_model', labelKey: 'models.toolsModelLabel' },
  { field: 'large_context_model', labelKey: 'models.largeContextModelLabel' },
  { field: 'default_embedding_model', labelKey: 'models.embeddingModelLabel' },
  { field: 'default_text_to_speech_model', labelKey: 'models.ttsModelLabel' },
  { field: 'default_speech_to_text_model', labelKey: 'models.sttModelLabel' },
]

export interface ModelUsage {
  labelKey: string
  name?: string
  speaker?: string
}

export interface ModelUsageSources {
  defaults: ModelDefaults | null
  episodeProfiles: {
    name: string
    outline_llm?: string | null
    transcript_llm?: string | null
  }[]
  speakerProfiles: {
    name: string
    voice_model?: string | null
    speakers: { name: string; voice_model?: string | null }[]
  }[]
  transformations: { name: string; title?: string | null; model_id?: string | null }[]
}

export function findModelUsages(modelId: string, sources: ModelUsageSources): ModelUsage[] {
  const usages: ModelUsage[] = []
  if (sources.defaults) {
    for (const slot of DEFAULT_SLOTS) {
      if (sources.defaults[slot.field] === modelId) {
        usages.push({ labelKey: slot.labelKey })
      }
    }
  }
  for (const profile of sources.episodeProfiles) {
    if (profile.outline_llm === modelId) {
      usages.push({ labelKey: 'podcasts.outlineModel', name: profile.name })
    }
    if (profile.transcript_llm === modelId) {
      usages.push({ labelKey: 'podcasts.transcriptModel', name: profile.name })
    }
  }
  for (const profile of sources.speakerProfiles) {
    if (profile.voice_model === modelId) {
      usages.push({ labelKey: 'podcasts.voiceModel', name: profile.name })
    }
    for (const speaker of profile.speakers) {
      if (speaker.voice_model === modelId) {
        usages.push({
          labelKey: 'podcasts.voiceModel',
          name: profile.name,
          speaker: speaker.name,
        })
      }
    }
  }
  for (const transformation of sources.transformations) {
    if (transformation.model_id === modelId) {
      usages.push({
        labelKey: 'transformations.model',
        name: transformation.title || transformation.name,
      })
    }
  }
  return usages
}

export function formatModelUsage(usage: ModelUsage, label: (key: string) => string): string {
  const text = label(usage.labelKey)
  if (usage.speaker && usage.name) return `${usage.name} / ${usage.speaker} (${text})`
  if (usage.name) return `${usage.name} (${text})`
  return text
}
