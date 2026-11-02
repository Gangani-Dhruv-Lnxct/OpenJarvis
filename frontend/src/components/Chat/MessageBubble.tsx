import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import 'katex/dist/katex.min.css';
import { Copy, Check, FileText, FileCode, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import { ToolCallCard } from './ToolCallCard';
import { ResearchTimeline } from './ResearchTimeline';
import { rehypeCitations } from '../../lib/rehype-citations';
import { XRayFooter } from './XRayFooter';
import { SpeakMessageButton } from './SpeakMessageButton';
import type { ChatAttachment, ChatMessage } from '../../types';
import { stripThinkTags } from '../../lib/message-text';
import { formatFileSize } from '../../lib/attachments';

interface Props {
  message: ChatMessage;
  isLive?: boolean;
}

function getTextContent(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }
  if (node?.props?.children) {
    return getTextContent(node.props.children);
  }
  return '';
}

function CodeBlockPre({ children, ...props }: any) {
  const [copied, setCopied] = useState(false);
  const codeElement = Array.isArray(children) ? children[0] : children;
  const className = codeElement?.props?.className || '';
  const match = /language-([\w-]+)/.exec(className);
  const lang = match ? match[1] : '';
  const code = getTextContent(codeElement?.props?.children).replace(/\n$/, '');

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="code-block-wrapper relative my-3"
      style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden' }}
    >
      <div
        className="flex items-center justify-between px-4 py-1.5 text-xs"
        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-tertiary)' }}
      >
        <span className="font-mono">{lang || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-0.5 rounded transition-colors cursor-pointer"
          style={{ color: 'var(--color-text-tertiary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-text-secondary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre {...props} style={{ margin: 0, borderRadius: 0 }}>
        {children}
      </pre>
    </div>
  );
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
      style={{ color: 'var(--color-text-tertiary)' }}
      title="Copy message"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function AttachmentCard({ attachment }: { attachment: ChatAttachment }) {
  const [expanded, setExpanded] = useState(false);
  const isImg = attachment.type === 'image' || !!attachment.dataUrl;

  if (isImg && attachment.dataUrl) {
    return (
      <div className="flex flex-col gap-1 mb-2 items-end">
        <a
          href={attachment.dataUrl}
          target="_blank"
          rel="noreferrer"
          className="group relative block overflow-hidden rounded-xl border max-w-sm transition-transform hover:scale-[1.01]"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-secondary)' }}
          title="Click to view full image"
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            className="max-h-60 w-auto object-cover rounded-xl"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium">
            Click to view full
          </div>
        </a>
        <div className="flex items-center gap-1.5 text-[11px] opacity-75">
          <span className="truncate max-w-[200px]">{attachment.name}</span>
          <span>&middot;</span>
          <span>{formatFileSize(attachment.size)}</span>
          {attachment.trained && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
              <CheckCircle2 size={10} /> Learned
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border p-2.5 mb-2 transition-colors text-xs w-full max-w-md"
      style={{
        background: 'var(--color-bg-tertiary)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-black/10 shrink-0">
            {attachment.type === 'code' ? (
              <FileCode size={16} className="text-blue-400" />
            ) : (
              <FileText size={16} className="text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate max-w-[240px]" title={attachment.name}>
              {attachment.name}
            </div>
            <div className="text-[11px] text-[var(--color-text-tertiary)] flex items-center gap-1.5">
              <span>{formatFileSize(attachment.size)}</span>
              {attachment.content && (
                <>
                  <span>&middot;</span>
                  <span>{attachment.content.length.toLocaleString()} chars</span>
                </>
              )}
              {attachment.trained && (
                <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 font-medium ml-1">
                  <CheckCircle2 size={9} /> Learned
                </span>
              )}
            </div>
          </div>
        </div>
        {attachment.content && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-black/10 text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors shrink-0 cursor-pointer"
            title={expanded ? 'Hide content' : 'View extracted content'}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
      </div>

      {expanded && attachment.content && (
        <div className="mt-2 pt-2 border-t border-[var(--color-border)] max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap rounded bg-black/15 p-2 text-[var(--color-text-secondary)]">
          {attachment.content}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, isLive = false }: Props) {
  const isUser = message.role === 'user';

  const cleanContent = useMemo(() => stripThinkTags(message.content), [message.content]);

  // Build a ref→source lookup once per render. Memoized so the rehype plugin
  // identity stays stable until the source list actually changes.
  const sourcesMap = useMemo(() => {
    const m = new Map<number, NonNullable<ChatMessage['researchSources']>[number]>();
    for (const s of message.researchSources ?? []) {
      if (typeof s.ref === 'number') m.set(s.ref, s);
    }
    return m;
  }, [message.researchSources]);

  const rehypePlugins = useMemo(() => {
    const base: any[] = [[rehypeHighlight, { detect: true }], rehypeKatex];
    if (sourcesMap.size > 0) base.push([rehypeCitations, { sources: sourcesMap }]);
    return base;
  }, [sourcesMap]);

  if (isUser) {
    const hasAttachments =
      (message.attachments && message.attachments.length > 0) ||
      (message.images && message.images.length > 0);

    return (
      <div className="flex flex-col items-end mb-4">
        {hasAttachments && (
          <div className="max-w-[85%] w-full flex flex-col items-end mb-1">
            {message.attachments?.map((att) => (
              <AttachmentCard key={att.id} attachment={att} />
            ))}
            {!message.attachments?.length &&
              message.images?.map((img, idx) => (
                <div key={idx} className="mb-2">
                  <img
                    src={img}
                    alt={`Upload ${idx + 1}`}
                    className="max-h-60 w-auto object-cover rounded-xl border border-[var(--color-border)]"
                  />
                </div>
              ))}
          </div>
        )}
        {cleanContent && (
          <div
            className="max-w-[85%] px-4 py-2.5 text-sm leading-relaxed"
            style={{
              background: 'var(--color-user-bubble)',
              color: 'var(--color-user-bubble-text)',
              borderRadius: 'var(--radius-xl) var(--radius-xl) var(--radius-sm) var(--radius-xl)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {cleanContent}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group mb-6">
      {/* Deep Research timeline (steps + status) */}
      {(message.isResearch || (message.researchTraces && message.researchTraces.length > 0)) && (
        <ResearchTimeline
          traces={message.researchTraces ?? []}
          isLive={isLive}
          hasContent={cleanContent.length > 0}
        />
      )}

      {/* Tool calls */}
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {message.toolCalls.map((tc) => (
            <ToolCallCard key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* Audio player (e.g. morning digest) */}
      {message.audio?.url && <AudioPlayer src={message.audio.url} />}

      {/* Assistant message */}
      {cleanContent && (
        <div className="prose max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={rehypePlugins}
            components={{
              pre: CodeBlockPre,
            }}
          >
            {cleanContent}
          </ReactMarkdown>
        </div>
      )}

      {/* Footer: copy + read aloud + x-ray */}
      <div className="flex items-center gap-2 mt-1.5">
        <CopyMessageButton content={cleanContent} />
        {!isUser && !isLive && (
          <SpeakMessageButton messageId={message.id} content={cleanContent} />
        )}
      </div>
      <XRayFooter
        usage={message.usage}
        telemetry={message.telemetry}
        isResearch={message.isResearch}
      />
    </div>
  );
}
