import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useForm } from 'react-hook-form'

import { SourceTypeStep } from './SourceTypeStep'

// useCapabilities is a TanStack Query hook. Mock it directly so tests are
// deterministic and don't need a QueryClientProvider or the network.
vi.mock('@/lib/hooks/use-capabilities', () => ({
  useCapabilities: vi.fn(),
}))

import { useCapabilities } from '@/lib/hooks/use-capabilities'

const mockedUseCapabilities = vi.mocked(useCapabilities)

function setCapabilities(caps: { docling: boolean; media: boolean }) {
  mockedUseCapabilities.mockReturnValue({
    data: {
      docling_available: caps.docling,
      crawl4ai_available: false,
      crawl4ai_remote_configured: false,
      media_processing_available: caps.media,
    },
    isLoading: false,
    isError: false,
    error: null,
  } as unknown as ReturnType<typeof useCapabilities>)
}

function SourceTypeStepHarness() {
  // Real react-hook-form so field controllers behave normally. The wizard
  // owns the form in production; here the harness just provides one.
  const { control, register, setValue, formState } = useForm<{
    type: 'link' | 'upload' | 'text'
    title?: string
    url?: string
    content?: string
    file?: FileList | File
    notebooks?: string[]
    transformations?: string[]
    embed: boolean
    async_processing: boolean
  }>({
    defaultValues: { type: 'upload', embed: false, async_processing: false },
  })
  return (
    <SourceTypeStep
      control={control}
      register={register}
      setValue={setValue}
      errors={formState.errors}
    />
  )
}

function getFileAccept(): string {
  const input = document.getElementById('file') as HTMLInputElement | null
  return input?.getAttribute('accept') ?? ''
}


describe('SourceTypeStep upload picker', () => {
  describe('accept string is capability-driven', () => {
    it('always advertises base document types', () => {
      setCapabilities({ docling: false, media: false })
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      for (const ext of ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.epub', '.html']) {
        expect(accept).toContain(ext)
      }
    })

    it('omits audio and video when media processing is unavailable', () => {
      setCapabilities({ docling: true, media: false })
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      for (const ext of ['.mp3', '.mp4', '.wav', '.m4a', '.mov', '.avi', '.wmv', '.aac']) {
        expect(accept).not.toContain(ext)
      }
    })

    it('includes audio and video when media processing is available', () => {
      setCapabilities({ docling: false, media: true })
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      for (const ext of ['.mp3', '.mp4', '.wav', '.m4a']) {
        expect(accept).toContain(ext)
      }
    })

    it('omits images when Docling is unavailable', () => {
      setCapabilities({ docling: false, media: true })
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      for (const ext of ['.jpg', '.jpeg', '.png', '.tiff']) {
        expect(accept).not.toContain(ext)
      }
    })

    it('includes images when Docling is available', () => {
      setCapabilities({ docling: true, media: false })
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      for (const ext of ['.jpg', '.png', '.tiff']) {
        expect(accept).toContain(ext)
      }
    })

    it('never advertises archives, because content-core has no extractor for them', () => {
      // Advertising ZIP/TAR/GZ was a long-standing UI lie: content-core detects
      // the MIME type but has no extractor -- uploading one always failed.
      // Container / email extraction is a separate follow-up branch.
      for (const combo of [
        { docling: false, media: false },
        { docling: true, media: false },
        { docling: false, media: true },
        { docling: true, media: true },
      ]) {
        setCapabilities(combo)
        const { unmount } = render(<SourceTypeStepHarness />)
        const accept = getFileAccept()
        expect(accept).not.toContain('.zip')
        expect(accept).not.toContain('.tar')
        expect(accept).not.toContain('.gz')
        unmount()
      }
    })
  })

  describe('missing-capability hints', () => {
    it('warns that FFmpeg is required when media is unavailable', () => {
      setCapabilities({ docling: true, media: false })
      render(<SourceTypeStepHarness />)
      // useTranslation is mocked to return raw keys, so we assert the key.
      expect(screen.getByText('sources.mediaUnavailable')).toBeInTheDocument()
    })

    it('warns that Docling is required when images are unavailable', () => {
      setCapabilities({ docling: false, media: true })
      render(<SourceTypeStepHarness />)
      expect(screen.getByText('sources.imagesUnavailable')).toBeInTheDocument()
    })

    it('shows both hints when both capabilities are absent', () => {
      setCapabilities({ docling: false, media: false })
      render(<SourceTypeStepHarness />)
      expect(screen.getByText('sources.mediaUnavailable')).toBeInTheDocument()
      expect(screen.getByText('sources.imagesUnavailable')).toBeInTheDocument()
    })

    it('shows neither hint when both capabilities are present', () => {
      setCapabilities({ docling: true, media: true })
      render(<SourceTypeStepHarness />)
      expect(screen.queryByText('sources.mediaUnavailable')).not.toBeInTheDocument()
      expect(screen.queryByText('sources.imagesUnavailable')).not.toBeInTheDocument()
    })

    it('degrades gracefully while capabilities are still loading', () => {
      // Loading state -> data undefined. Must NOT crash and MUST NOT falsely
      // advertise media/images that we don't know are available yet.
      mockedUseCapabilities.mockReturnValue({
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
      } as unknown as ReturnType<typeof useCapabilities>)
      render(<SourceTypeStepHarness />)
      const accept = getFileAccept()
      expect(accept).not.toContain('.mp3')
      expect(accept).not.toContain('.jpg')
    })
  })
})
