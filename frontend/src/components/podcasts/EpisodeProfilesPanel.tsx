'use client'

import { useMemo, useState } from 'react'
import { FileText, ListTree, Users } from 'lucide-react'

import { EpisodeProfile, SpeakerProfile, needsModelSetup } from '@/lib/types/podcasts'
import {
  useDeleteEpisodeProfile,
  useDuplicateEpisodeProfile,
} from '@/lib/hooks/use-podcasts'
import { useModels } from '@/lib/hooks/use-models'
import { EpisodeProfileFormDialog } from '@/components/podcasts/forms/EpisodeProfileFormDialog'
import { MetaChip, ProfileCard, ProfileDisclosure } from '@/components/podcasts/ProfileCard'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/hooks/use-translation'

interface EpisodeProfilesPanelProps {
  episodeProfiles: EpisodeProfile[]
  speakerProfiles: SpeakerProfile[]
}

function findSpeakerSummary(
  speakerProfiles: SpeakerProfile[],
  speakerId: string | null
) {
  if (!speakerId) {
    return undefined
  }
  // speaker_config references the speaker profile by record ID
  return speakerProfiles.find((profile) => profile.id === speakerId)
}

export function EpisodeProfilesPanel({
  episodeProfiles,
  speakerProfiles,
}: EpisodeProfilesPanelProps) {
  const { t } = useTranslation()
  const [createOpen, setCreateOpen] = useState(false)
  const [editProfile, setEditProfile] = useState<EpisodeProfile | null>(null)

  const deleteProfile = useDeleteEpisodeProfile()
  const duplicateProfile = useDuplicateEpisodeProfile()
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
      [...episodeProfiles].sort((a, b) => a.name.localeCompare(b.name, 'en')),
    [episodeProfiles]
  )

  const disableCreate = speakerProfiles.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t('podcasts.episodeProfilesTitle')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('podcasts.episodeProfilesDesc')}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={disableCreate}>
          {t('podcasts.createProfile')}
        </Button>
      </div>

      {disableCreate ? (
        <p className="rounded-[var(--surface-radius)] border border-dashed border-warning/40 bg-warning-surface p-4 text-sm text-warning">
          {t('podcasts.createSpeakerFirst')}
        </p>
      ) : null}

      {sortedProfiles.length === 0 ? (
        <div className="rounded-[var(--surface-radius)] border border-dashed bg-muted/30 p-10 text-center text-sm text-muted-foreground">
          {t('podcasts.noEpisodeProfiles')}
        </div>
      ) : (
        <div className="space-y-4">
          {sortedProfiles.map((profile) => {
            const speakerSummary = findSpeakerSummary(
              speakerProfiles,
              profile.speaker_config
            )
            const outlineLabel = profile.outline_llm
              ? (modelNameMap[profile.outline_llm] ?? profile.outline_llm)
              : t('podcasts.notConfigured')
            const transcriptLabel = profile.transcript_llm
              ? (modelNameMap[profile.transcript_llm] ?? profile.transcript_llm)
              : t('podcasts.notConfigured')
            const speakerName =
              profile.speaker_config_name ??
              speakerSummary?.name ??
              t('podcasts.notConfigured')

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
                deleteTitle={t('podcasts.deleteProfileTitle')}
                deleteDescription={t('podcasts.deleteProfileDesc', { name: profile.name })}
              >
                <div className="flex flex-wrap gap-2">
                  <MetaChip
                    icon={ListTree}
                    label={t('podcasts.outlineModel')}
                    value={outlineLabel}
                    tone={profile.outline_llm ? 'default' : 'warning'}
                  />
                  <MetaChip
                    icon={FileText}
                    label={t('podcasts.transcriptModel')}
                    value={transcriptLabel}
                    tone={profile.transcript_llm ? 'default' : 'warning'}
                  />
                  <MetaChip label={t('podcasts.segments')} value={profile.num_segments} />
                  {profile.language ? (
                    <MetaChip label={t('podcasts.language')} value={profile.language} />
                  ) : null}
                  <MetaChip
                    icon={Users}
                    label={t('podcasts.speakerProfile')}
                    value={speakerName}
                  />
                </div>

                {profile.default_briefing ? (
                  <ProfileDisclosure label={t('podcasts.defaultBriefingTitle')}>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {profile.default_briefing}
                    </p>
                  </ProfileDisclosure>
                ) : null}
              </ProfileCard>
            )
          })}
        </div>
      )}

      <EpisodeProfileFormDialog
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        speakerProfiles={speakerProfiles}
      />

      <EpisodeProfileFormDialog
        mode="edit"
        open={Boolean(editProfile)}
        onOpenChange={(open) => {
          if (!open) {
            setEditProfile(null)
          }
        }}
        speakerProfiles={speakerProfiles}
        initialData={editProfile ?? undefined}
      />
    </div>
  )
}
