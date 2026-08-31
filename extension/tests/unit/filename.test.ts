import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatTime,
  hostFromUrl,
  renderFilename,
  sanitizeSegment,
  sanitizeSubfolder,
} from '@/shared/filename';

describe('sanitizeSegment', () => {
  it('strips filesystem-invalid characters', () => {
    expect(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j');
  });
  it('trims trailing dots and spaces', () => {
    expect(sanitizeSegment('  hello.  ')).toBe('hello');
  });
  it('escapes reserved Windows names', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('lpt1')).toBe('_lpt1');
  });
  it('falls back to "page" when empty', () => {
    expect(sanitizeSegment('   ')).toBe('page');
  });
});

describe('hostFromUrl', () => {
  it('extracts the hostname', () => {
    expect(hostFromUrl('https://www.example.com/path?q=1')).toBe('www.example.com');
  });
  it('returns "page" for invalid urls', () => {
    expect(hostFromUrl('not a url')).toBe('page');
  });
});

describe('date/time formatting', () => {
  it('formats yyyymmdd and hhmmss with padding', () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // 2026-01-05 09:03:07 local
    expect(formatDate(d)).toBe('20260105');
    expect(formatTime(d)).toBe('090307');
  });
});

describe('renderFilename', () => {
  const tokens = {
    title: 'My Page',
    host: 'example.com',
    date: new Date(2026, 7, 15, 14, 30, 5),
    width: 1280,
    height: 3400,
  };

  it('substitutes tokens and appends the extension', () => {
    expect(renderFilename('{host}-{date}-{time}', tokens, 'png')).toBe('example.com-20260815-143005.png');
  });
  it('supports width/height/title tokens', () => {
    expect(renderFilename('{title}_{width}x{height}', tokens, 'jpg')).toBe('My-Page_1280x3400.jpg');
  });
  it('falls back to a default template when empty', () => {
    const name = renderFilename('', tokens, 'png');
    expect(name.endsWith('.png')).toBe(true);
    expect(name).toContain('example.com');
  });
  it('caps the base filename length at 120 characters', () => {
    const long = 'x'.repeat(400);
    const name = renderFilename(long, tokens, 'png');
    const base = name.replace(/\.png$/, '');
    expect(base.length).toBeLessThanOrEqual(120);
  });
  it('normalises the extension casing and dots', () => {
    expect(renderFilename('{host}', tokens, '.PNG')).toBe('example.com.png');
  });
});

describe('sanitizeSubfolder', () => {
  it('removes path traversal and normalises slashes', () => {
    expect(sanitizeSubfolder('..\\a/../b/c')).toBe('a/b/c');
  });
  it('returns empty string for empty input', () => {
    expect(sanitizeSubfolder('')).toBe('');
  });
  it('sanitises each segment', () => {
    expect(sanitizeSubfolder('my:folder/sub*dir')).toBe('my folder/sub dir');
  });
});
