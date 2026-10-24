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

const RESERVED_QUERY_KEYS = new Set(['_sort', '_page', '_per_page', '_embed', '_where'])

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
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
    try {
      const parsed = JSON.parse(rawWhere)
      if (typeof parsed === 'object' && parsed !== null) {
        where = parsed
      }
    } catch {
      // Ignore invalid JSON and fallback to parsed query params
    }
  }

  const pageRaw = params.get('_page')
  const perPageRaw = params.get('_per_page')
  
  // Validate pagination bounds to prevent DoS attacks
  const maxPage = 1000000
  const minPerPage = 1
  const maxPerPage = 100000
  
  let page: number | undefined = undefined
  let perPage: number | undefined = undefined
  
  if (pageRaw !== null) {
    const p = Number.parseInt(pageRaw, 10)
    if (!Number.isNaN(p) && p >= 1 && p <= maxPage) {
      page = p
    }
  }
  
  if (perPageRaw !== null) {
    const pp = Number.parseInt(perPageRaw, 10)
    if (!Number.isNaN(pp) && pp >= minPerPage && pp <= maxPerPage) {
      perPage = pp
    }
  }

  return {
    where,
    sort: params.get('_sort') ?? undefined,
    page,
    perPage,
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

  // Create app
  const app = new App()

  // Static files
  app.use(sirv('public', { dev: !isProduction }))
  options.static
    ?.map((path) => (isAbsolute(path) ? path : join(process.cwd(), path)))
    .forEach((dir) => app.use(sirv(dir, { dev: !isProduction })))

  // Security headers middleware to prevent common attacks
  app.use((req, res, next) => {
    // Content Security Policy to prevent XSS
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:"
    )
    // Prevent MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY')
    // Enable XSS filter in browsers
    res.setHeader('X-XSS-Protection', '1; mode=block')
    // Enable HSTS in production
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    }
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    next()
  })

  // CORS configuration with security controls
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001']

  app
    .use((req, res, next) => {
      return cors({
        origin: (origin: string | undefined) => {
          // Allow requests with no origin (like mobile apps or curl requests)
          if (!origin) return true
          // Check if origin is in whitelist
          if (allowedOrigins.includes(origin)) return true
          // In production, reject unknown origins
          if (process.env.NODE_ENV === 'production') return false
          // In development, allow any origin (can be overridden by ALLOWED_ORIGINS)
          return true
        },
        credentials: true,
        allowedHeaders: req.headers['access-control-request-headers']
          ?.split(',')
          .map((h) => h.trim()),
      })(req, res, next)
    })
    .options('*', cors())

  // Body parser
  // JSON parser with size limit to prevent DoS attacks (default 1MB)
const maxBodySize = process.env.MAX_BODY_SIZE || '1mb'
app.use(json({ limit: maxBodySize }))

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

  // Error handling middleware - must be last
  app.use((error: Error, req: any, res: any, next: any) => {
    console.error('Application error:', error)

    // Do not leak stack traces or internal details to clients
    const isDevelopment = process.env.NODE_ENV === 'development'
    const status = (error as any).status || 500
    const message = isDevelopment ? error.message : 'Internal server error'

    res.status(status).json({
      error: message,
      // Only include stack trace in development
      ...(isDevelopment && { stack: error.stack }),
    })
  })

  return app
}
