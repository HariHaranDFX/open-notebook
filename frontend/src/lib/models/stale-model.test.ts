import { describe, expect, it } from 'vitest'

import { needsModelSetup, type EpisodeProfile, type SpeakerProfile } from '@/lib/types/podcasts'
import {
  findModelUsages,
  isStaleModelId,
  knownModelIds,
  resolvedModelLabel,
} from '@/lib/models/stale-model'

const known = new Set(['model:live'])

describe('isStaleModelId', () => {
  it('ignores an empty id and an unloaded model list', () => {
    expect(isStaleModelId(null, known)).toBe(false)
    expect(isStaleModelId('model:gone', null)).toBe(false)
  })

  it('is true only when a saved id is absent from the loaded list', () => {
    expect(isStaleModelId('model:gone', known)).toBe(true)
    expect(isStaleModelId('model:live', known)).toBe(false)
  })
})

describe('knownModelIds', () => {
  it('stays null until the model list has loaded', () => {
    expect(knownModelIds(undefined, false)).toBeNull()
    expect(knownModelIds([{ id: 'model:live' }], true)).toEqual(new Set(['model:live']))
  })
})

describe('needsModelSetup', () => {
  const episode = (overrides: Partial<EpisodeProfile> = {}): EpisodeProfile => ({
    id: 'episode_profile:1',
    name: 'tech',
    description: '',
    speaker_config: 'speaker_profile:1',
    default_briefing: '',
    num_segments: 3,
    outline_llm: 'model:live',
    transcript_llm: 'model:live',
    ...overrides,
  })

  const speaker = (overrides: Partial<SpeakerProfile> = {}): SpeakerProfile => ({
    id: 'speaker_profile:1',
    name: 'hosts',
    description: '',
    voice_model: 'model:live',
    speakers: [{ name: 'Ada', voice_id: 'Kore', backstory: '', personality: '' }],
    ...overrides,
  })

  it('still flags an empty required field before the model list loads', () => {
    expect(needsModelSetup(episode({ outline_llm: '' }), null)).toBe(true)
    expect(needsModelSetup(speaker({ voice_model: null }), null)).toBe(true)
  })

  it('flags a profile whose saved model was removed', () => {
    expect(needsModelSetup(episode({ transcript_llm: 'model:gone' }), known)).toBe(true)
    expect(needsModelSetup(episode(), known)).toBe(false)
  })

  it('flags a speaker override that points at a removed model', () => {
    const profile = speaker({
      speakers: [
        { name: 'Ada', voice_id: 'Kore', backstory: '', personality: '', voice_model: 'model:gone' },
      ],
    })
    expect(needsModelSetup(profile, known)).toBe(true)
    expect(needsModelSetup(profile, null)).toBe(false)
  })
})

describe('resolvedModelLabel', () => {
  it('says the model was removed instead of printing the raw id', () => {
    expect(resolvedModelLabel('model:gone', {}, known, 'missing', 'removed')).toEqual({
      text: 'removed',
      warning: true,
    })
    expect(resolvedModelLabel('model:live', { 'model:live': 'google / flash' }, known, 'missing', 'removed')).toEqual({
      text: 'google / flash',
      warning: false,
    })
  })
})

describe('findModelUsages', () => {
  it('names every place that still selects the model', () => {
    const usages = findModelUsages('model:gone', {
      defaults: { default_chat_model: 'model:live', default_text_to_speech_model: 'model:gone' },
      episodeProfiles: [
        {
          name: 'tech_discussion',
          outline_llm: 'model:gone',
          transcript_llm: 'model:live',
        },
      ],
      speakerProfiles: [
        {
          name: 'tech_experts',
          voice_model: 'model:gone',
          speakers: [{ name: 'Ada', voice_model: 'model:gone' }],
        },
      ],
      transformations: [{ name: 'summarize', title: 'Summarize', model_id: 'model:gone' }],
    })

    expect(usages).toEqual([
      { labelKey: 'models.ttsModelLabel' },
      { labelKey: 'podcasts.outlineModel', name: 'tech_discussion' },
      { labelKey: 'podcasts.voiceModel', name: 'tech_experts' },
      { labelKey: 'podcasts.voiceModel', name: 'tech_experts', speaker: 'Ada' },
      { labelKey: 'transformations.model', name: 'Summarize' },
    ])
  })

  it('is empty when nothing still selects the model', () => {
    expect(
      findModelUsages('model:gone', {
        defaults: { default_chat_model: 'model:live' },
        episodeProfiles: [],
        speakerProfiles: [],
        transformations: [],
      })
    ).toEqual([])
  })
})
