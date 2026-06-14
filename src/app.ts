import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { App } from '@tinyhttp/app'
import { cors } from '@tinyhttp/cors'
import { Eta } from 'eta'
import { Low } from 'lowdb'
import { json } from 'milliparsec'
import sirv from 'sirv'

import { parseWhere } from './parse-where.ts'
import type { Data } from './service.ts'
import { isItem, Service } from './service.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isProduction = process.env['NODE_ENV'] === 'production'

export type AppOptions = {
  logger?: boolean
  static?: string[]
}

const eta = new Eta({
  views: join(__dirname, '../views'),
  cache: isProduction,
})

// Simple in-memory rate limiter (per IP)
const RATE_LIMIT_WINDOW_MS = 60000 // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 1000 // Requests per window
const requestCounts = new Map<string, { count: number; resetTime: number }>()

const RESERVED_QUERY_KEYS = new Set(['_sort', '_page', '_per_page', '_embed', '_where'])
const MAX_WHERE_JSON_SIZE = 10000 // 10KB limit
const MAX_QUERY_STRING_SIZE = 20000 // 20KB limit
const MAX_BODY_SIZE = 1000000 // 1MB limit for JSON payloads

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
  if (queryString.length > MAX_QUERY_STRING_SIZE) {
    console.warn('[security] Query string exceeds size limit')
    throw new Error('Query string too large')
  }
  const params = new URLSearchParams(queryString)

  const filterParams = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (!RESERVED_QUERY_KEYS.has(key)) {
      filterParams.append(key, value)
    }
  }

  let where = parseWhere(filterParams.toString())
  const rawWhere = params.get('_where')
  if (typeof rawWhere === 'string') {
    // Validate _where payload size
    if (rawWhere.length > MAX_WHERE_JSON_SIZE) {
      console.warn('[security] _where parameter exceeds size limit')
      return { where: {}, sort: undefined, page: undefined, perPage: undefined, embed: undefined }
    }
    try {
      const parsed = JSON.parse(rawWhere)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        where = parsed
      }
    } catch (err) {
      // Log and reject malformed JSON
      console.warn('[security] Malformed _where parameter:', rawWhere)
    }
  }

  const pageRaw = params.get('_page')
  const perPageRaw = params.get('_per_page')
  // Parse with radix 10 and validate ranges to prevent DoS via memory exhaustion
  let page = pageRaw === null ? undefined : Number.parseInt(pageRaw, 10)
  let perPage = perPageRaw === null ? undefined : Number.parseInt(perPageRaw, 10)

  // Validate bounds: min page 1, max 1M; min perPage 1, max 10k
  if (typeof page === 'number' && !Number.isNaN(page)) {
    if (page < 1 || page > 1000000) {
      page = undefined
    }
  }
  if (typeof perPage === 'number' && !Number.isNaN(perPage)) {
    if (perPage < 1 || perPage > 10000) {
      perPage = undefined
    }
  }

  // Validate embed parameter: only allow alphanumeric field names
  let embed = req.query['_embed'] as string | string[] | undefined
  if (embed) {
    const embedFields = Array.isArray(embed) ? embed : [embed]
    // Strict validation: only allow valid field names
    embed = embedFields.filter(
      (field) =>
        typeof field === 'string' &&
        /^[a-zA-Z0-9_]+$/.test(field) &&
        field.length > 0
    ) as string[] | undefined
    if (Array.isArray(embed) && embed.length === 0) {
      embed = undefined
    }
  }

  return {
    where,
    sort: params.get('_sort') ?? undefined,
    page: Number.isNaN(page) ? undefined : page,
    perPage: Number.isNaN(perPage) ? undefined : perPage,
    embed,
  }
}

function withBody(action: (name: string, body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: any, res: any, next: any) => {
    const { name = '' } = req.params
    if (!isItem(req.body)) {
      res.status(400).json({ error: 'Body must be a JSON object' })
      return
    }
    res.locals['data'] = await action(name, req.body)
    next?.()
  }
}

function withIdAndBody(
  action: (name: string, id: string, body: Record<string, unknown>) => Promise<unknown>,
) {
  return async (req: any, res: any, next: any) => {
    const { name = '', id = '' } = req.params
    if (!isItem(req.body)) {
      res.status(400).json({ error: 'Body must be a JSON object' })
      return
    }
    res.locals['data'] = await action(name, id, req.body)
    next?.()
  }
}

export function createApp(db: Low<Data>, options: AppOptions = {}) {
  // Create service
  const service = new Service(db)

  // Create app
  const app = new App()

  // Static files with path traversal protection
  function validateStaticDir(dir: string): boolean {
    try {
      // Resolve to absolute path
      const resolved = isAbsolute(dir) ? dir : join(process.cwd(), dir)
      // Reject if path attempts to traverse outside cwd
      const relative = require('path').relative(process.cwd(), resolved)
      if (relative.startsWith('..')) {
        console.warn('[security] Static dir path traversal attempt:', dir)
        return false
      }
      return true
    } catch (err) {
      console.warn('[security] Invalid static dir:', dir, err)
      return false
    }
  }

  if (validateStaticDir('public')) {
    app.use(sirv('public', { dev: !isProduction }))
  }
  options.static
    ?.map((path) => (isAbsolute(path) ? path : join(process.cwd(), path)))
    .filter((dir) => validateStaticDir(dir))
    .forEach((dir) => app.use(sirv(dir, { dev: !isProduction })))

  // Rate limiting middleware
  app.use((req, res, next) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown'
    const now = Date.now()
    
    let limiter = requestCounts.get(clientIp)
    if (!limiter || now > limiter.resetTime) {
      limiter = { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS }
      requestCounts.set(clientIp, limiter)
    }
    
    limiter.count++
    
    if (limiter.count > RATE_LIMIT_MAX_REQUESTS) {
      console.warn('[security] Rate limit exceeded for IP:', clientIp)
      res.setHeader('Retry-After', Math.ceil((limiter.resetTime - now) / 1000))
      return res.status(429).json({ error: 'Too many requests' })
    }
    
    // Cleanup old entries periodically
    if (requestCounts.size > 10000) {
      for (const [ip, data] of requestCounts.entries()) {
        if (now > data.resetTime) {
          requestCounts.delete(ip)
        }
      }
    }
    
    next && next()
  })

  // CORS
  // Strict CORS configuration: validate origin against allowlist
  const corsOriginAllowlist = process.env.CORS_ORIGIN_ALLOWLIST
    ? process.env.CORS_ORIGIN_ALLOWLIST.split(',')
    : ['http://localhost:3000', 'http://localhost:3001']

  app
    .use((req, res, next) => {
      const origin = req.headers['origin']
      const isAllowed = !origin || corsOriginAllowlist.includes(origin)
      if (!isAllowed) {
        console.warn('[security] CORS origin rejected:', origin)
        res.status(403).json({ error: 'CORS policy violation' })
        return
      }
      return cors({
        origin: isAllowed ? (origin ?? true) : false,
        credentials: true,
        allowedHeaders: req.headers['access-control-request-headers']
          ?.split(',')
          .map((h) => h.trim()),
      })(req, res, next)
    })
    .options('*', cors())

  // Security headers middleware
  app.use((req, res, next) => {
    // Content Security Policy: prevent inline scripts and restrict resource sources
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    )
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY')
    // Prevent MIME sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Enable XSS protection in older browsers
    res.setHeader('X-XSS-Protection', '1; mode=block')
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    next && next()
  })

  // Body parser with Content-Type validation and size limit
  app.use((req, res, next) => {
    // Check Content-Length before parsing
    const contentLength = req.headers['content-length']
    if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_SIZE) {
      console.warn('[security] Request body exceeds size limit')
      return res.status(413).json({ error: 'Payload too large' })
    }
    
    // Only allow JSON content type for POST/PUT/PATCH
    if (req.method && ['POST', 'PUT', 'PATCH'].includes(req.method)) {
      const contentType = req.headers['content-type'] ?? ''
      if (!contentType.includes('application/json')) {
        console.warn('[security] Invalid Content-Type for', req.method, ':', contentType)
        return res.status(415).json({ error: 'Content-Type must be application/json' })
      }
    }
    next && next()
  })
  
  // Apply JSON parser with size limit configuration
  app.use((req, res, next) => {
    // Track accumulated body size to prevent streaming bypasses
    let bodySize = 0
    const originalWrite = res.write
    const originalEnd = res.end
    
    req.on('data', (chunk: Buffer) => {
      bodySize += chunk.length
      if (bodySize > MAX_BODY_SIZE) {
        console.warn('[security] Request body streaming exceeds size limit')
        req.pause()
        res.status(413).json({ error: 'Payload too large' })
      }
    })
    
    next && next()
  })
  
  app.use(json())

  // Authentication middleware (configurable via AUTH_ENABLED env var)
  const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true'
  const VALID_API_KEYS = process.env.API_KEYS
    ? process.env.API_KEYS.split(',')
    : []

  if (AUTH_ENABLED) {
    app.use((req, res, next) => {
      // Allow public endpoints (health check, etc.)
      if (req.path === '/health' || req.path === '/') {
        return next?.()
      }

      // Check for Authorization header or x-api-key
      const authHeader = req.headers.authorization
      const apiKey = req.headers['x-api-key'] as string | undefined

      // Validate Bearer token or API key
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        if (VALID_API_KEYS.includes(token)) {
          return next?.()
        }
      } else if (apiKey && VALID_API_KEYS.includes(apiKey)) {
        return next?.()
      }

      console.warn('[security] Unauthorized request:', req.method, req.path)
      res.status(401).json({ error: 'Unauthorized' })
    })
  }

  app.get('/', (_req, res) => res.send(eta.render('index.html', { data: db.data })))

  app.get('/:name', (req, res, next) => {
    const { name = '' } = req.params
    const { where, sort, page, perPage, embed } = parseListParams(req)

    res.locals['data'] = service.find(name, {
      where,
      sort,
      page,
      perPage,
      embed,
    })
    next?.()
  })

  app.get('/:name/:id', (req, res, next) => {
    const { name = '', id = '' } = req.params
    res.locals['data'] = service.findById(name, id, req.query)
    next?.()
  })

  app.post('/:name', withBody(service.create.bind(service)))

  app.put('/:name', withBody(service.update.bind(service)))

  app.put('/:name/:id', withIdAndBody(service.updateById.bind(service)))

  app.patch('/:name', withBody(service.patch.bind(service)))

  app.patch('/:name/:id', withIdAndBody(service.patchById.bind(service)))

  app.delete('/:name/:id', async (req, res, next) => {
    const { name = '', id = '' } = req.params
    res.locals['data'] = await service.destroyById(name, id, req.query['_dependent'])
    next?.()
  })

  app.use('/:name', (req, res) => {
    const { data } = res.locals
    if (data === undefined) {
      res.status(404).json({ error: 'Not Found' })
    } else {
      if (req.method === 'POST') res.status(201)
      res.json(data)
    }
  })

  return app
}
