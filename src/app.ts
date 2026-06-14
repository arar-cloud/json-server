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

const MAX_JSON_DEPTH = 50

function validateJsonDepth(obj: unknown, currentDepth: number = 0): void {
  if (currentDepth > MAX_JSON_DEPTH) {
    throw new Error(`JSON nesting depth exceeds maximum allowed (${MAX_JSON_DEPTH})`)
  }
  if (typeof obj === 'object' && obj !== null) {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        validateJsonDepth(item, currentDepth + 1)
      }
    } else {
      for (const value of Object.values(obj)) {
        validateJsonDepth(value, currentDepth + 1)
      }
    }
  }
}

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

const MAX_PAGE = 1_000_000
const MAX_PER_PAGE = 1_000

function validatePaginationParams(page?: unknown, perPage?: unknown): { page: number; perPage: number } {
  const p = typeof page === 'string' ? Number.parseInt(page, 10) : 1
  const pp = typeof perPage === 'string' ? Number.parseInt(perPage, 10) : 10

  if (!Number.isInteger(p) || p < 1 || p > MAX_PAGE) {
    throw new Error(`Invalid _page parameter: must be a positive integer between 1 and ${MAX_PAGE}`)
  }
  if (!Number.isInteger(pp) || pp < 1 || pp > MAX_PER_PAGE) {
    throw new Error(`Invalid _per_page parameter: must be a positive integer between 1 and ${MAX_PER_PAGE}`)
  }

  return { page: p, perPage: pp }
}

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
  const page = pageRaw === null ? undefined : Number.parseInt(pageRaw, 10)
  const perPage = perPageRaw === null ? undefined : Number.parseInt(perPageRaw, 10)

  return {
    where,
    sort: params.get('_sort') ?? undefined,
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

  // Create app
  const app = new App()

  // Static files
  app.use(sirv('public', { dev: !isProduction }))
  options.static
    ?.map((path) => (isAbsolute(path) ? path : join(process.cwd(), path)))
    .forEach((dir) => app.use(sirv(dir, { dev: !isProduction })))

  // CORS
  app
    .use((req, res, next) => {
      return cors({
        allowedHeaders: req.headers['access-control-request-headers']
          ?.split(',')
          .map((h) => h.trim()),
      })(req, res, next)
    })
    .options('*', cors())

  // Body parser
  app.use(json())

  app.get('/', (_req, res) => res.send(eta.render('index.html', { data: db.data })))

  app.get('/:name', (req, res, next) => {
    const { name = '' } = req.params
    try {
      const { where, sort, page, perPage, embed } = parseListParams(req)
      // Validate pagination parameters
      if (page !== undefined || perPage !== undefined) {
        validatePaginationParams(page, perPage)
      }
      res.locals['data'] = service.find(name, {
        where,
        sort,
        page,
        perPage,
        embed,
      })
    } catch (error) {
      res.status(400)
      return res.json({ error: error instanceof Error ? error.message : 'Invalid request parameters' })
    }
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
