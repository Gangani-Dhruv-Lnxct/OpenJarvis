import { getBase, authHeaders } from './api';
import type { ChatAttachment } from '../types';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx !== -1 ? filename.slice(idx).toLowerCase() : '';
}

export function isImageFile(filename: string, mimeType?: string): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true;
  const ext = getFileExtension(filename);
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'].includes(ext);
}

export function isCodeFile(filename: string): boolean {
  const ext = getFileExtension(filename);
  return [
    '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.css',
    '.json', '.yaml', '.yml', '.xml', '.sql', '.sh', '.bash',
    '.rs', '.go', '.c', '.cpp', '.h', '.hpp', '.java', '.toml',
  ].includes(ext);
}

export async function processFileForChat(file: File): Promise<ChatAttachment> {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const ext = getFileExtension(file.name);
  const isImage = isImageFile(file.name, file.type);
  const isCode = isCodeFile(file.name);

  if (isImage) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    return {
      id,
      name: file.name,
      size: file.size,
      type: 'image',
      ext,
      dataUrl,
      preview: `Image: ${file.name} (${formatFileSize(file.size)})`,
      trained: false,
    };
  }

  // If text or code file, read text directly in browser for fast response
  const isPlainText = [
    '.txt', '.md', '.markdown', '.csv', '.tsv', '.log', '.env', '.json',
  ].includes(ext) || isCode;

  if (isPlainText) {
    try {
      let content = '';
      if (typeof file.text === 'function') {
        content = await file.text();
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
        });
      }

      const preview = content.slice(0, 300).trim() + (content.length > 300 ? '...' : '');

      return {
        id,
        name: file.name,
        size: file.size,
        type: isCode ? 'code' : 'file',
        ext,
        content,
        preview,
        trained: false,
      };
    } catch {
      // Fall through to backend extraction if client read fails
    }
  }

  // Use backend extraction for PDF, DOCX, or binary files
  try {
    const base = getBase();
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${base}/v1/connectors/upload/extract`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });

    if (res.ok) {
      const data = await res.json();
      return {
        id,
        name: data.filename || file.name,
        size: data.size || file.size,
        type: data.file_type === 'image' ? 'image' : data.file_type === 'code' ? 'code' : 'file',
        ext: data.ext || ext,
        content: data.text || '',
        preview: data.preview || '',
        dataUrl: data.base64 || undefined,
        trained: false,
      };
    }
  } catch {
    // Backend extract fallback
  }

  // Graceful fallback for non-parseable file
  return {
    id,
    name: file.name,
    size: file.size,
    type: 'file',
    ext,
    preview: `File: ${file.name} (${formatFileSize(file.size)})`,
    trained: false,
  };
}

export async function trainFilesIntoKnowledge(
  files: File[],
  title?: string,
): Promise<{ chunks_added: number }> {
  if (files.length === 0) return { chunks_added: 0 };
  const base = getBase();
  const formData = new FormData();
  for (const f of files) {
    formData.append('files', f);
  }
  if (title) {
    formData.append('title', title);
  }

  const res = await fetch(`${base}/v1/connectors/upload/ingest/files`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!res.ok) {
    let detail = `Upload failed: ${res.status}`;
    try {
      const err = await res.json();
      if (err.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return (await res.json()) as { chunks_added: number; source: string };
}

export async function trainTextIntoKnowledge(
  content: string,
  title?: string,
): Promise<{ chunks_added: number }> {
  const base = getBase();
  const res = await fetch(`${base}/v1/connectors/upload/ingest`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ content, title: title || 'Pasted document' }),
  });

  if (!res.ok) {
    let detail = `Ingest failed: ${res.status}`;
    try {
      const err = await res.json();
      if (err.detail) detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return (await res.json()) as { chunks_added: number; source: string };
}
