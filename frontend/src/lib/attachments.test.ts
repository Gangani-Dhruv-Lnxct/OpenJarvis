import { describe, it, expect, vi } from 'vitest';
import {
  formatFileSize,
  getFileExtension,
  isImageFile,
  isCodeFile,
  processFileForChat,
  trainFilesIntoKnowledge,
} from './attachments';

describe('attachments utilities', () => {
  it('formats file sizes accurately', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('extracts file extensions in lowercase', () => {
    expect(getFileExtension('report.PDF')).toBe('.pdf');
    expect(getFileExtension('script.py')).toBe('.py');
    expect(getFileExtension('noextension')).toBe('');
  });

  it('identifies image files correctly', () => {
    expect(isImageFile('photo.jpg')).toBe(true);
    expect(isImageFile('screenshot.png')).toBe(true);
    expect(isImageFile('graphic.webp')).toBe(true);
    expect(isImageFile('document.pdf')).toBe(false);
    expect(isImageFile('file.txt')).toBe(false);
  });

  it('identifies code files correctly', () => {
    expect(isCodeFile('server.py')).toBe(true);
    expect(isCodeFile('app.tsx')).toBe(true);
    expect(isCodeFile('script.js')).toBe(true);
    expect(isCodeFile('document.pdf')).toBe(false);
  });

  it('processes text file for chat reading', async () => {
    const file = new File(['Hello OpenJarvis documentation content'], 'doc.txt', {
      type: 'text/plain',
    });
    const result = await processFileForChat(file);
    expect(result.name).toBe('doc.txt');
    expect(result.type).toBe('file');
    expect(result.content).toBe('Hello OpenJarvis documentation content');
    expect(result.trained).toBe(false);
  });

  it('calls backend to train files into knowledge', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ chunks_added: 5, source: 'upload' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['Some content to index'], 'notes.md', {
      type: 'text/markdown',
    });

    const res = await trainFilesIntoKnowledge([file]);
    expect(res.chunks_added).toBe(5);
    expect(fetchMock).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
