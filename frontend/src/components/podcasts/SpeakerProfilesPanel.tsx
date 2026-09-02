'use client'

import { useMemo, useState } from 'react'
import { Volume2 } from 'lucide-react'

import { SpeakerProfile, needsModelSetup } from '@/lib/types/podcasts'
import {
  useDeleteSpeakerProfile,
  useDuplicateSpeakerProfile,
} from '@/lib/hooks/use-podcasts'
import { useModels } from '@/lib/hooks/use-models'
import { SpeakerProfileFormDialog } from '@/components/podcasts/forms/SpeakerProfileFormDialog'
import { MetaChip, ProfileCard, ProfileDisclosure } from '@/components/podcasts/ProfileCard'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SpeakerProfilesPanelProps {
  speakerProfiles: SpeakerProfile[]
  usage: Record<string, number>
}

export function SpeakerProfilesPanel({
  speakerProfiles,
  usage,
}: SpeakerProfilesPanelProps) {
  const { t } = useTranslation()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProfile, setEditProfile] = useState<SpeakerProfile | null>(null)

  const deleteProfile = useDeleteSpeakerProfile()
  const duplicateProfile = useDuplicateSpeakerProfile()
  const { data: models = [] } = useModels()

  const modelNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const m of models) {
      map[m.id] = `${m.provider} / ${m.name}`
    }
    return map
  }, [models])

  const sortedProfiles = useMemo(
    () =>
      [...speakerProfiles].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [speakerProfiles]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('podcasts.speakerProfilesTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('podcasts.speakerProfilesDesc')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>{t('podcasts.createSpeaker')}</Button>
      </div>

      {sortedProfiles.length === 0 ? (
        <div className="rounded-[var(--surface-radius)] border border-dashed bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          {t('podcasts.noSpeakerProfiles')}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedProfiles.map((profile) => {
            const usageCount = usage[profile.name] ?? 0
            const deleteDisabled = usageCount > 0
            const voiceModelLabel = profile.voice_model
              ? (modelNameMap[profile.voice_model] ?? profile.voice_model)
              : t('podcasts.notConfigured')

            return (
              <ProfileCard
                key={profile.id}
                name={profile.name}
                description={profile.description}
                setupRequired={needsModelSetup(profile)}
                onEdit={() => setEditProfile(profile)}
                onDuplicate={() => duplicateProfile.mutate(profile.id)}
                duplicating={duplicateProfile.isPending}
                onDelete={() =>
                  deleteProfile.mutate({ profileId: profile.id, name: profile.name })
                }
                deleting={deleteProfile.isPending}
                deleteDisabled={deleteDisabled}
                deleteDisabledHint={t('podcasts.deleteSpeakerDisabledHint')}
                deleteTitle={t('podcasts.deleteSpeakerProfileTitle')}
                deleteDescription={t('podcasts.deleteSpeakerProfileDesc', { name: profile.name })}
              >
                <div className="flex flex-wrap gap-2">
                  <MetaChip
                    icon={Volume2}
                    value={voiceModelLabel}
                    tone={profile.voice_model ? 'default' : 'warning'}
                  />
                  <MetaChip
                    value={
                      usageCount > 0
                        ? t('podcasts.usedByCount', { count: usageCount })
                        : t('podcasts.unused')
                    }
                    tone={usageCount > 0 ? 'accent' : 'default'}
                  />
                </div>

                {profile.speakers.length > 0 ? (
                  <div className="flex flex-col gap-2 border-t border-border pt-3">
                    {profile.speakers.map((speaker) => {
                      const speakerModel = speaker.voice_model
                        ? (modelNameMap[speaker.voice_model] ?? speaker.voice_model)
                        : null
                      return (
                        <div
                          key={speaker.name}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="text-sm font-medium text-foreground">
                            {speaker.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {t('podcasts.voiceId')}: {speaker.voice_id}
                            {speakerModel ? ` · ${speakerModel}` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {profile.speakers.length > 0 ? (
                  <ProfileDisclosure label={t('podcasts.voiceDetails')}>
                    <div className="space-y-2">
                      {profile.speakers.map((speaker) => (
                        <div
                          key={speaker.name}
                          className="rounded-[var(--surface-radius)] border border-border bg-muted/30 p-3"
                        >
                          <p className="text-sm font-medium text-foreground">{speaker.name}</p>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">
                              {t('podcasts.backstory')}:
                            </span>{' '}
                            {speaker.backstory}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                            <span className="font-semibold text-foreground">
                              {t('podcasts.personality')}:
                            </span>{' '}
                            {speaker.personality}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ProfileDisclosure>
                ) : null}
              </ProfileCard>
            )
          })}
        </div>
      )}

      <SpeakerProfileFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
      />

      <SpeakerProfileFormDialog
        mode="edit"
        open={Boolean(editProfile)}
        onOpenChange={(open) => {
          if (!open) {
            setEditProfile(null)
          }
        }}
        initialData={editProfile ?? undefined}
      />
    </div>
  )
}
