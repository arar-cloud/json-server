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

  // Sanitize sort parameter to prevent injection attacks
  const sortParam = params.get('_sort')
  if (sortParam) {
    const MAX_SORT_FIELDS = 10
    const SORT_FIELD_PATTERN = /^[a-zA-Z0-9._\-]+$/
    let sortFields = sortParam.split(',')
    
    // Limit number of sort fields
    if (sortFields.length > MAX_SORT_FIELDS) {
      throw new Error(`Maximum ${MAX_SORT_FIELDS} sort fields allowed`)
    }
    
    // Validate each sort field name
    for (const field of sortFields) {
      if (!SORT_FIELD_PATTERN.test(field.trim())) {
        throw new Error(`Invalid sort field: ${field}`)
      }
    }
  }

  let where = parseWhere(filterParams.toString())
  const rawWhere = params.get('_where')
  if (typeof rawWhere === 'string') {
    // Security: Limit _where parameter size to prevent memory exhaustion
    const MAX_WHERE_SIZE = 10000
    if (rawWhere.length > MAX_WHERE_SIZE) {
      throw new Error('_where parameter exceeds maximum size')
    }
    try {
      const parsed = JSON.parse(rawWhere)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        where = parsed
      } else {
        throw new Error('_where must be a JSON object')
      }
    } catch (e) {
      // Ignore invalid JSON and fallback to parsed query params
      console.warn('Invalid _where parameter:', e instanceof Error ? e.message : String(e))
    }
  }

  const pageRaw = params.get('_page')
  const perPageRaw = params.get('_per_page')
  const page = pageRaw === null ? undefined : Number.parseInt(pageRaw, 10)
  const perPage = perPageRaw === null ? undefined : Number.parseInt(perPageRaw, 10)

  // Pagination bounds validation to prevent memory exhaustion
  const MIN_PAGE = 1
  const MAX_PAGE = 1000000
  const MIN_PER_PAGE = 1
  const MAX_PER_PAGE = 10000
  
  if (page !== undefined && (Number.isNaN(page) || page < MIN_PAGE || page > MAX_PAGE)) {
    throw new Error(`_page must be between ${MIN_PAGE} and ${MAX_PAGE}`)
  }
  if (perPage !== undefined && (Number.isNaN(perPage) || perPage < MIN_PER_PAGE || perPage > MAX_PER_PAGE)) {
    throw new Error(`_per_page must be between ${MIN_PER_PAGE} and ${MAX_PER_PAGE}`)
  }

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

  // Body parser with security validation
  const MAX_BODY_SIZE = 1048576 // 1MB
  const MAX_NESTING_DEPTH = 20
  
  function validateBodyDepth(obj: unknown, depth: number = 0): boolean {
    if (depth > MAX_NESTING_DEPTH) return false
    if (typeof obj !== 'object' || obj === null) return true
    if (Array.isArray(obj)) {
      return obj.every(item => validateBodyDepth(item, depth + 1))
    }
    return Object.values(obj).every(value => validateBodyDepth(value, depth + 1))
  }
  
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      const bodySize = JSON.stringify(req.body).length
      if (bodySize > MAX_BODY_SIZE) {
        return res.status(413).json({ error: 'Request body exceeds maximum size' })
      }
      if (!validateBodyDepth(req.body)) {
        return res.status(400).json({ error: 'Request body has excessive nesting depth' })
      }
    }
    next?.()
  })
  
  app.use(json())

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
