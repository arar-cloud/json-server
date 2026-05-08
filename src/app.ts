import { dirname, isAbsolute, join, normalize, resolve } from 'node:path'
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
  apiKey?: string
}

const eta = new Eta({
  views: join(__dirname, '../views'),
  cache: isProduction,
  autoEscape: true,
  useWith: false,
  varName: 'locals',
})

const RESERVED_QUERY_KEYS = new Set(['_sort', '_page', '_per_page', '_embed', '_where'])
const MAX_QUERY_DEPTH = 3
const MAX_QUERY_PARAM_SIZE = 2000

function validateQueryParamDepth(obj: unknown, depth = 0): boolean {
  if (depth > MAX_QUERY_DEPTH) return false
  if (typeof obj !== 'object' || obj === null) return true
  if (Array.isArray(obj)) return obj.every(item => validateQueryParamDepth(item, depth + 1))
  return Object.values(obj).every(val => validateQueryParamDepth(val, depth + 1))
}

function validateQueryParamSize(str: string): boolean {
  return str.length <= MAX_QUERY_PARAM_SIZE
}

function validateSortParam(sortParam: any): string | undefined {
  if (!sortParam) return undefined
  const str = String(sortParam)
  // Allow field names with optional -prefix for descending, alphanumeric and underscore only
  if (/^-?[a-zA-Z0-9_,\s]+$/.test(str)) {
    return str
  }
  return undefined
}

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
  
  // Validate cumulative query string size to prevent DoS
  const MAX_QUERY_STRING_SIZE = 5000
  if (queryString.length > MAX_QUERY_STRING_SIZE) {
    throw new Error('Query string size limit exceeded')
  }
  
  const params = new URLSearchParams(queryString)

  const filterParams = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (!RESERVED_QUERY_KEYS.has(key)) {
      if (!validateQueryParamSize(value)) {
        throw new Error('Query parameter size limit exceeded')
      }
      filterParams.append(key, value)
    }
  }

  let where = parseWhere(filterParams.toString())
  const rawWhere = params.get('_where')
  if (typeof rawWhere === 'string') {
    // Validate JSON string size before parsing
    if (rawWhere.length > 3000) {
      throw new Error('_where parameter size limit exceeded')
    }
    try {
      const parsed = JSON.parse(rawWhere)
      if (typeof parsed === 'object' && parsed !== null) {
        // Validate depth of parsed JSON before using
        if (!validateQueryParamDepth(parsed)) {
          throw new Error('_where parameter nesting depth limit exceeded')
        }
        where = parsed
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('depth limit')) {
        throw err
      }
      // Ignore invalid JSON parse errors and fallback to parsed query params
    }
  }

  if (!validateQueryParamDepth(where)) {
    throw new Error('Query parameter nesting depth limit exceeded')
  }

  const pageRaw = params.get('_page')
  const perPageRaw = params.get('_per_page')
  const page = pageRaw === null ? undefined : Number.parseInt(pageRaw, 10)
  const perPage = perPageRaw === null ? undefined : Number.parseInt(perPageRaw, 10)
  const rawSort = params.get('_sort')
  const sort = validateSortParam(rawSort)

  return {
    where,
    sort,
    page: Number.isNaN(page) ? undefined : page,
    perPage: Number.isNaN(perPage) ? undefined : perPage,
    embed: req.query['_embed'],
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
  
  // API Key authentication middleware (if configured)
  const apiKeyMiddleware = (req: any, res: any, next: any) => {
    // Skip auth check for GET requests to list endpoint if no apiKey configured
    if (!options.apiKey) {
      return next()
    }
    
    // For protected endpoints with apiKey requirement
    const requestApiKey = req.headers['x-api-key']
    if (!requestApiKey || requestApiKey !== options.apiKey) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing API key' })
    }
    next()
  }

  // Create app
  const app = new App()

  // Static files with path traversal protection
  function validateStaticPath(basePath: string): string {
    const normalized = normalize(basePath)
    const resolved = resolve(process.cwd(), normalized)
    const base = resolve(process.cwd())
    
    if (!resolved.startsWith(base)) {
      throw new Error('Invalid static path: attempting to access outside root')
    }
    
    return resolved
  }

  // Security headers middleware for static files
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Cache-Control', 'public, max-age=3600, must-revalidate')
    res.set('X-Frame-Options', 'DENY')
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'")
    next()
  })

  app.use(sirv('public', { dev: !isProduction }))
  options.static
    ?.map((path) => (isAbsolute(path) ? path : join(process.cwd(), path)))
    .map((path) => validateStaticPath(path))
    .forEach((dir) => app.use(sirv(dir, { dev: !isProduction })))

  // CSRF Protection: SameSite cookie policy
  app.use((req, res, next) => {
    const originalSetCookie = res.setHeader
    res.setHeader = function(name: string, value: any) {
      if (name.toLowerCase() === 'set-cookie') {
        const cookieValue = typeof value === 'string' ? value : String(value)
        if (!cookieValue.includes('SameSite')) {
          value = cookieValue + '; SameSite=Strict; HttpOnly'
        }
      }
      return originalSetCookie.call(this, name, value)
    }
    next()
  })

  // CSRF Protection: Origin validation for state-modifying endpoints
  const ALLOWED_ORIGINS = (process.env['ALLOWED_ORIGINS'] || 'http://localhost:3000,http://localhost:3001').split(',')
  app.use((req, res, next) => {
    const origin = req.headers['origin']
    const method = req.method
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      if (origin && !ALLOWED_ORIGINS.includes(origin.trim())) {
        return res.status(403).json({ error: 'CSRF protection: origin not allowed' })
      }
    }
    next()
  })

  // CORS
  app
    .use((req, res, next) => {
      return cors({
        origin: ALLOWED_ORIGINS.map(o => o.trim()),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: req.headers['access-control-request-headers']
          ?.split(',')
          .map((h) => h.trim()),
      })(req, res, next)
    })
    .options('*', cors())

  // Body parser
  function validateBodyTypes(obj: any, depth = 0): { valid: boolean; error?: string } {
  if (depth > 10) return { valid: false, error: 'Body nesting too deep' }
  if (obj === null) return { valid: false, error: 'Null values not allowed in request body' }
  if (Array.isArray(obj)) return { valid: false, error: 'Arrays not allowed at top level' }
  
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof key !== 'string') {
        return { valid: false, error: 'Field names must be strings' }
      }
      if (Array.isArray(value) && typeof value !== 'string') {
        return { valid: false, error: `Field ${key}: unexpected array type` }
      }
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const nested = validateBodyTypes(value, depth + 1)
        if (!nested.valid) return nested
      }
    }
  }
  
  return { valid: true }
}

app.use((req, res, next) => {
  const method = req.method
  const contentType = req.headers['content-type'] || ''
  
  // For POST, PUT, PATCH, validate Content-Type
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    if (!contentType.includes('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' })
    }
  }
  
  next()
})

const MAX_REQUEST_SIZE = '1mb'

app.use(json({ limit: MAX_REQUEST_SIZE }))

app.use((req, res, next) => {
  const method = req.method
  
  if (['POST', 'PUT', 'PATCH'].includes(method) && req.body) {
    const validation = validateBodyTypes(req.body)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }
  }
  
  next()
})

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

  app.post('/:name', apiKeyMiddleware, withBody(service.create.bind(service)))

  app.put('/:name', apiKeyMiddleware, withBody(service.update.bind(service)))

  app.put('/:name/:id', apiKeyMiddleware, withIdAndBody(service.updateById.bind(service)))

  app.patch('/:name', apiKeyMiddleware, withBody(service.patch.bind(service)))

  app.patch('/:name/:id', apiKeyMiddleware, withIdAndBody(service.patchById.bind(service)))

  app.delete('/:name/:id', apiKeyMiddleware, async (req, res, next) => {
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
