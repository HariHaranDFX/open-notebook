'use client'

import { FileText, Lightbulb } from 'lucide-react'

import {
  ResearchWorkbench,
  type WorkbenchPane,
} from '@/components/workbench/ResearchWorkbench'
import { useSourceChat } from '@/lib/hooks/use-source-chat'
import { useTranslation } from '@/lib/hooks/use-translation'
import { ChatPanel } from './ChatPanel'
import {
  SourceDetailContent,
  type SourceDetailWorkspacePanes,
} from './SourceDetailContent'

interface SourceWorkspaceProps {
  sourceId: string
  onClose?: () => void
}

export function SourceWorkspace({ sourceId, onClose }: SourceWorkspaceProps) {
  const { t } = useTranslation()
  const chat = useSourceChat(sourceId)

  const renderWorkspace = ({
    content,
    insights,
    insightCount,
  }: SourceDetailWorkspacePanes) => {
    const panes: WorkbenchPane[] = [
      {
        id: 'evidence',
        label: t('workbench.content'),
        icon: FileText,
        content: (
          <div className="absolute inset-0 min-h-0 overflow-y-auto">{content}</div>
        ),
      },
      {
        id: 'notes',
        label: t('workbench.insights'),
        count: insightCount,
        icon: Lightbulb,
        content: <div className="absolute inset-0 min-h-0 overflow-y-auto">{insights}</div>,
      },
    ]

    return (
      <ResearchWorkbench
        workspaceKey={`source:${sourceId}`}
        panes={panes}
        panelLabel={`${t('workbench.content')} & ${t('workbench.insights')}`}
        chat={(
          <ChatPanel
            messages={chat.messages}
            isStreaming={chat.isStreaming}
            contextIndicators={chat.contextIndicators}
            onSendMessage={(message, model) => chat.sendMessage(message, model)}
            modelOverride={chat.currentSession?.model_override}
            onModelChange={model => {
              if (chat.currentSessionId) {
                chat.updateSession(chat.currentSessionId, { model_override: model })
              }
            }}
            sessions={chat.sessions}
            currentSessionId={chat.currentSessionId}
            onCreateSession={title => chat.createSession({ title })}
            onSelectSession={chat.switchSession}
            onUpdateSession={(sessionId, title) => chat.updateSession(sessionId, { title })}
            onDeleteSession={chat.deleteSession}
            loadingSessions={chat.loadingSessions}
          />
        )}
      />
    )
  }

  return (
    <SourceDetailContent
      sourceId={sourceId}
      showChatButton={false}
      showBackButton
      onClose={onClose}
      renderWorkspace={renderWorkspace}
    />
  )
}
