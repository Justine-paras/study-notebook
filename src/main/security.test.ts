import { describe, expect, it } from 'vitest'
import { isAllowedPermission, isAppUrl, isExternalWebUrl, isSamePage, isTrustedSender } from './security'

const DEV = 'http://localhost:5173'

describe('isAppUrl', () => {
  it.each([
    ['file:///C:/Users/Justine/AppData/Local/Programs/Study%20Notebook/resources/app.asar/out/renderer/index.html#/notebooks', undefined, true],
    ['file:///home/justine/study-notebook/out/renderer/index.html', undefined, true],
    ['http://localhost:5173/#/settings', DEV, true],
    ['http://localhost:5173/#/settings', undefined, false],
    ['http://localhost:5174/', DEV, false],
    ['https://evil.example/', DEV, false],
    ['about:blank', DEV, false],
    ['data:text/html,<script>alert(1)</script>', DEV, false],
    ['not a url', DEV, false],
    [42, DEV, false]
  ])('%j (dev server %j) -> %s', (url, dev, expected) => {
    expect(isAppUrl(url, dev)).toBe(expected)
  })
})

describe('isExternalWebUrl', () => {
  it.each([
    ['https://console.anthropic.com/settings/keys', true],
    ['http://example.com', true],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['ms-settings:privacy', false],
    ['javascript:alert(1)', false],
    ['\\\\attacker\\share\\x', false],
    ['', false],
    [null, false]
  ])('%j -> %s', (url, expected) => {
    expect(isExternalWebUrl(url)).toBe(expected)
  })
})

describe('isTrustedSender', () => {
  it('trusts only the top-level app page', () => {
    expect(isTrustedSender({ url: 'file:///app/out/renderer/index.html#/', parent: null })).toBe(true)
    expect(isTrustedSender({ url: `${DEV}/#/`, parent: null }, DEV)).toBe(true)
    expect(isTrustedSender({ url: 'file:///app/out/renderer/index.html', parent: { url: 'file:///x' } })).toBe(false)
    expect(isTrustedSender({ url: 'https://evil.example/', parent: null }, DEV)).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
    expect(isTrustedSender(undefined)).toBe(false)
  })
})

describe('isSamePage', () => {
  it('ignores the hash route', () => {
    expect(isSamePage('file:///app/index.html#/a', 'file:///app/index.html#/b')).toBe(true)
    expect(isSamePage('file:///app/index.html', 'file:///C:/Users/Justine/Lecture.pdf')).toBe(false)
  })
})

describe('isAllowedPermission', () => {
  it('allows only writing text to the clipboard', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true)
    for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal', 'fullscreen', 'unknown', '', null]) {
      expect(isAllowedPermission(permission)).toBe(false)
    }
  })
})
