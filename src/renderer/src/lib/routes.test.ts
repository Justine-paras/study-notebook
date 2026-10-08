import { describe, expect, it } from 'vitest'
import { ROUTES } from './routes'

describe('ROUTES', () => {
  it('builds the paths from ARCHITECTURE.md', () => {
    expect(ROUTES.today).toBe('/')
    expect(ROUTES.notebook('nb1')).toBe('/notebooks/nb1')
    expect(ROUTES.topic('t1')).toBe('/topics/t1')
    expect(ROUTES.topic('t1', 'practice')).toBe('/topics/t1?step=practice')
    expect(ROUTES.session()).toBe('/session')
    expect(ROUTES.session('weak')).toBe('/session?part=weak')
    expect(ROUTES.review()).toBe('/review')
    expect(ROUTES.review('nb1')).toBe('/review?notebook=nb1')
    expect(ROUTES.reviewTopic('t1')).toBe('/review?topic=t1')
    expect(ROUTES.quiz('q1')).toBe('/quiz/q1')
  })
})
