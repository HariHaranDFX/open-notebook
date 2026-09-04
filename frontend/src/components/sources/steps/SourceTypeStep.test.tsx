import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useForm, useWatch } from 'react-hook-form'

import { SourceTypeStep } from './SourceTypeStep'

// jsdom doesn't implement DataTransfer or DragEvent's dataTransfer; the
// dropzone builds one via `new DataTransfer()` (writes) and reads
// `e.dataTransfer.files` (reads). Provide a minimal shim for both.
class FakeDataTransfer {
  items = {
    _files: [] as File[],
    add: (f: File) => this.items._files.push(f),
  }
  get files(): FileList {
    const arr = this.items._files
    return Object.assign(arr, {
      item: (i: number) => arr[i] ?? null,
    }) as unknown as FileList
  }
}
;(globalThis as unknown as { DataTransfer: typeof FakeDataTransfer }).DataTransfer =
  FakeDataTransfer

function dropFiles(target: Element, files: File[]) {
  const dt = new FakeDataTransfer()
  files.forEach((f) => dt.items.add(f))
  fireEvent.drop(target, { dataTransfer: dt as unknown as DataTransfer })
}

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
  // Expose the file count so drop-zone tests can assert what landed in
  // form state without reaching into react-hook-form's private internals.
  // Use a duck-typed length read rather than `instanceof FileList` because
  // jsdom's FileList class isn't populated from our FakeDataTransfer.
  const fileValue = useWatch({ control, name: 'file' }) as
    | { length?: number }
    | undefined
  const fileCount = typeof fileValue?.length === 'number' ? fileValue.length : 0
  return (
    <>
      <span data-testid="rhf-file-count">{fileCount}</span>
      <SourceTypeStep
        control={control}
        register={register}
        setValue={setValue}
        errors={formState.errors}
      />
    </>
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

  describe('drag-and-drop zone', () => {
    it('exposes an accessible drop zone with a clear CTA', () => {
      setCapabilities({ docling: true, media: true })
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      expect(zone).toBeInTheDocument()
      expect(zone).toHaveAttribute('tabIndex', '0')
      expect(screen.getByText('sources.uploadDropzoneCta')).toBeInTheDocument()
    })

    it('paints a hover state while a drag is over the zone', () => {
      setCapabilities({ docling: true, media: true })
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      fireEvent.dragEnter(zone)
      expect(zone).toHaveAttribute('data-drag-over', 'true')
      fireEvent.dragLeave(zone)
      expect(zone).not.toHaveAttribute('data-drag-over')
    })

    it('accepts a dropped supported file and passes it to the form', () => {
      setCapabilities({ docling: false, media: false })
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      const ok = new File(['x'], 'notes.pdf', { type: 'application/pdf' })
      dropFiles(zone, [ok])
      expect(screen.getByTestId('rhf-file-count')).toHaveTextContent('1')
      expect(screen.queryByTestId('rejected-files')).not.toBeInTheDocument()
    })

    it('filters unsupported files client-side and lists the skipped ones', () => {
      setCapabilities({ docling: false, media: false })  // no images, no media
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      const good = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
      const bad = new File(['x'], 'clip.mp3', { type: 'audio/mpeg' })  // media not on
      dropFiles(zone, [good, bad])
      // Good file made it to form; the rejection notice appears (interpolation
      // of file names is exercised by the i18n parity suite, not this one --
      // the global useTranslation mock returns raw keys).
      expect(screen.getByTestId('rhf-file-count')).toHaveTextContent('1')
      expect(screen.getByTestId('rejected-files')).toBeInTheDocument()
    })

    it('drops zip/tar/gz as unsupported regardless of capabilities', () => {
      setCapabilities({ docling: true, media: true })
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      const archive = new File(['x'], 'stuff.zip', { type: 'application/zip' })
      dropFiles(zone, [archive])
      expect(screen.getByTestId('rhf-file-count')).toHaveTextContent('0')
      expect(screen.getByTestId('rejected-files')).toBeInTheDocument()
    })

    it('opens the file picker when the zone is clicked or Enter is pressed', () => {
      setCapabilities({ docling: true, media: true })
      render(<SourceTypeStepHarness />)
      const zone = screen.getByRole('button', { name: 'sources.uploadDropzoneLabel' })
      const input = document.getElementById('file') as HTMLInputElement
      const clickSpy = vi.spyOn(input, 'click')
      fireEvent.click(zone)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      fireEvent.keyDown(zone, { key: 'Enter' })
      expect(clickSpy).toHaveBeenCalledTimes(2)
      fireEvent.keyDown(zone, { key: ' ' })
      expect(clickSpy).toHaveBeenCalledTimes(3)
    })
  })
})
