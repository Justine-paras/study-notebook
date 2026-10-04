import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { FileGrants, isInsideFolder, requireOwnPath } from './access'

describe('isInsideFolder', () => {
  it.each([
    ['/data', '/data', true],
    ['/data', '/data/library/nb/Lecture 1.pdf', true],
    ['/data/', '/data/library', true],
    ['/data', '/data/../etc/passwd', false],
    ['/data', '/data-other/file.pdf', false],
    ['/data', '/etc/passwd', false],
    ['/data', '/data/..notes/file.md', true],
    ['/data', 'library/file.pdf', false],
    ['/data', '', false]
  ])('POSIX: %j contains %j -> %s', (folder, target, expected) => {
    expect(isInsideFolder(folder, target, path.posix)).toBe(expected)
  })

  it.each([
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook\\library\\nb\\Week 1.pptx', true],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'c:\\users\\justine\\appdata\\roaming\\study notebook\\study.db', true],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook 2\\x.pdf', false],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'D:\\Study Notebook\\x.pdf', false],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', '\\\\attacker\\share\\x.pdf', false],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook\\..\\..\\x.exe', false],
    ['C:\\Users\\Justine\\AppData\\Roaming\\Study Notebook', 'C:/Users/Justine/AppData/Roaming/Study Notebook/library/a.md', true]
  ])('Windows: %j contains %j -> %s', (folder, target, expected) => {
    expect(isInsideFolder(folder, target, path.win32)).toBe(expected)
  })

  it('rejects values that are not strings', () => {
    expect(isInsideFolder('/data', null)).toBe(false)
    expect(isInsideFolder('/data', { path: '/data/x' })).toBe(false)
  })
})

describe('FileGrants', () => {
  it('only knows paths that were granted', () => {
    const grants = new FileGrants(path.posix, false)
    grants.grant('/home/justine/Course files/Lecture 1.pdf')
    expect(grants.has('/home/justine/Course files/Lecture 1.pdf')).toBe(true)
    expect(grants.has('/home/justine/Course files/./Lecture 1.pdf')).toBe(true)
    expect(grants.has('/home/justine/Course files/Lecture 2.pdf')).toBe(false)
    expect(grants.has('/home/justine/course files/lecture 1.pdf')).toBe(false)
  })

  it('compares Windows paths without regard to case or slash style', () => {
    const grants = new FileGrants(path.win32, true)
    grants.grant('C:\\Users\\Justine\\Documents\\CS 210\\Syllabus – Fall 2026.docx')
    expect(grants.has('c:\\users\\justine\\documents\\cs 210\\SYLLABUS – FALL 2026.DOCX')).toBe(true)
    expect(grants.has('C:/Users/Justine/Documents/CS 210/Syllabus – Fall 2026.docx')).toBe(true)
    expect(grants.has('\\\\attacker\\share\\Syllabus – Fall 2026.docx')).toBe(false)
  })

  it('ignores empty, relative and non-string values', () => {
    const grants = new FileGrants(path.posix, false)
    for (const value of ['', 'relative/file.pdf', null, undefined, 42, ['/a.pdf']]) grants.grant(value)
    expect(grants.has('relative/file.pdf')).toBe(false)
    expect(grants.has('')).toBe(false)
    expect(grants.has(undefined)).toBe(false)
    expect(grants.has('/a.pdf')).toBe(false)
  })
})

describe('requireOwnPath', () => {
  const dataDir = '/home/justine/.config/Study Notebook'
  const exists = (p: string) => p.endsWith('.pdf') || p === dataDir

  it('allows existing files inside the data folder and the folder itself', () => {
    expect(requireOwnPath(dataDir, `${dataDir}/library/nb/Week 1.pdf`, exists)).toBe(`${dataDir}/library/nb/Week 1.pdf`)
    expect(requireOwnPath(dataDir, dataDir, exists)).toBe(dataDir)
  })

  it.each(['/home/justine/Downloads/setup.exe', `${dataDir}/../evil.pdf`, 'library/x.pdf', '', null])('refuses %j', (target) => {
    expect(() => requireOwnPath(dataDir, target, exists)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
  })

  it('explains a stored copy that is gone', () => {
    expect(() => requireOwnPath(dataDir, `${dataDir}/library/nb/notes.md`, exists)).toThrow(/copy of this file is missing/)
  })
})
