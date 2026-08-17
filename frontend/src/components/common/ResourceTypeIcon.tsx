import {
  AlignLeft,
  Archive,
  BookOpen,
  ExternalLink,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from 'lucide-react'

import { cn } from '@/lib/utils'

export type ResourceKind =
  | 'notebook'
  | 'source'
  | 'link'
  | 'text'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'

type SourceAsset = { file_path?: string; url?: string } | null

const extensionKinds: Record<string, ResourceKind> = {
  txt: 'text',
  md: 'text',
  html: 'text',
  htm: 'text',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  epub: 'document',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  tiff: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  aac: 'audio',
  mp4: 'video',
  avi: 'video',
  mov: 'video',
  wmv: 'video',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
}

const resourceVisuals = {
  notebook: { icon: BookOpen, className: 'text-[var(--resource-notebook)]' },
  source: { icon: FileText, className: 'text-provenance' },
  link: { icon: ExternalLink, className: 'text-provenance' },
  text: { icon: AlignLeft, className: 'text-[var(--resource-text)]' },
  document: { icon: FileText, className: 'text-[var(--resource-document)]' },
  spreadsheet: { icon: FileSpreadsheet, className: 'text-[var(--resource-spreadsheet)]' },
  presentation: { icon: Presentation, className: 'text-[var(--resource-presentation)]' },
  image: { icon: FileImage, className: 'text-[var(--resource-image)]' },
  audio: { icon: FileAudio, className: 'text-[var(--resource-media)]' },
  video: { icon: FileVideo, className: 'text-[var(--resource-media)]' },
  archive: { icon: Archive, className: 'text-[var(--resource-archive)]' },
} as const

export function getSourceResourceKind(asset: SourceAsset): ResourceKind {
  if (asset?.url) return 'link'
  if (!asset?.file_path) return 'text'

  const extension = asset.file_path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase()
  return extension ? extensionKinds[extension] ?? 'document' : 'document'
}

interface ResourceTypeIconProps {
  kind: ResourceKind
  className?: string
}

export function ResourceTypeIcon({ kind, className }: ResourceTypeIconProps) {
  const visual = resourceVisuals[kind]
  const Icon = visual.icon

  return (
    <span
      aria-hidden="true"
      data-testid="resource-type-icon"
      data-resource-kind={kind}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center',
        visual.className,
        className,
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}
