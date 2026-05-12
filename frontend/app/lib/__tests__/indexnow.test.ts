import test from 'node:test'
import assert from 'node:assert/strict'

import { buildIndexNowKeyResponse, getIndexNowRouteConfig } from '../indexnow.ts'

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void | Promise<void>
) {
  const previous: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })
}

test('getIndexNowRouteConfig derives keyLocation from SITE_URL', async () => {
  await withEnv(
    {
      INDEXNOW_KEY: 'abc123',
      INDEXNOW_KEY_LOCATION: undefined,
      SITE_URL: 'https://pillseek.com/',
    },
    () => {
      const config = getIndexNowRouteConfig()
      assert.deepEqual(config, {
        key: 'abc123',
        keyLocation: 'https://pillseek.com/abc123.txt',
        siteUrl: 'https://pillseek.com',
        keyFileName: 'abc123.txt',
      })
    }
  )
})

test('buildIndexNowKeyResponse only serves the exact configured .txt key file', async () => {
  await withEnv(
    {
      INDEXNOW_KEY: 'abc123',
      INDEXNOW_KEY_LOCATION: 'https://pillseek.com/abc123.txt',
      SITE_URL: 'https://pillseek.com',
    },
    async () => {
      const goodResponse = buildIndexNowKeyResponse('abc123.txt')
      assert.ok(goodResponse)
      assert.equal(goodResponse.status, 200)
      assert.equal(goodResponse.headers.get('content-type'), 'text/plain; charset=utf-8')
      assert.equal(await goodResponse.text(), 'abc123')

      assert.equal(buildIndexNowKeyResponse('abc123'), null)
      assert.equal(buildIndexNowKeyResponse('other.txt'), null)
    }
  )
})

test('buildIndexNowKeyResponse returns null when INDEXNOW_KEY is not configured', async () => {
  await withEnv(
    {
      INDEXNOW_KEY: undefined,
      INDEXNOW_KEY_LOCATION: undefined,
      SITE_URL: 'https://pillseek.com',
    },
    () => {
      assert.equal(buildIndexNowKeyResponse('missing.txt'), null)
    }
  )
})
