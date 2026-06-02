import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { App, type Request, type Response, type NextFunction } from '@tinyhttp/app'
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

// Reserved query parameters that are handled by json-server
// These should not be passed to filters
const RESERVED_QUERY_KEYS = new Set<string>([
  '_sort',      // sorting parameter
  '_order',     // sort order (asc/desc)
  '_start',     // start index for pagination
  '_end',       // end index for pagination
  '_limit',     // number of items to return
  '_page',      // page number
  '_per_page',  // items per page
  '_embed',     // embed related resources
  '_expand',    // expand nested properties
  '_where'      // complex filtering conditions
])

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
  const params = new URLSearchParams(queryString)

  const filterParams = new URLSearchParams()
  for (const [key, value] of params.entries()) {
    if (RESERVED_QUERY_KEYS.has(key)) continue
    // Skip empty filter values to avoid matching null/undefined
    if (value === '' || value === null) continue
    filterParams.append(key, value)
  }

  let where = parseWhere(filterParams.toString())
  const rawWhere = params.get('_where')
  if (typeof rawWhere === 'string') {
    try {
      if (rawWhere.length > 10000) {
        throw new Error('_where parameter exceeds maximum length')
      }
      const parsed = JSON.parse(rawWhere)
      if (typeof parsed === 'object' && parsed !== null) {
        where = parsed
      }
    } catch (e) {
      console.warn(`Invalid _where parameter: ${e instanceof Error ? e.message : 'unknown error'}`)
    }
  }

  const pageRaw = params.get('_page')
  const perPageRaw = params.get('_per_page')
  const page = pageRaw === null ? undefined : Number.parseInt(pageRaw, 10)
  const perPage = perPageRaw === null ? undefined : Number.parseInt(perPageRaw, 10)

  const embedParam = req.query['_embed']
  const embed = embedParam && typeof embedParam === 'string' ? embedParam : undefined

  return {
    where,
    sort: params.get('_sort') ?? undefined,
    page: Number.isNaN(page) ? undefined : page,
    perPage: Number.isNaN(perPage) ? undefined : perPage,
    embed,
  }
}

function withBody(action: (name: string, body: Record<string, unknown>) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { name = '' } = req.params
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' })
      return
    }
    if (!isItem(req.body)) {
      res.status(400).json({ error: 'Body validation failed' })
      return
    }
    res.locals['data'] = await action(name, req.body)
    next?.()
  }
}

function withIdAndBody(
  action: (name: string, id: string, body: Record<string, unknown>) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { name = '', id = '' } = req.params
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      res.status(400).json({ error: 'Request body must be a JSON object' })
      return
    }
    if (!isItem(req.body)) {
      res.status(400).json({ error: 'Body validation failed' })
      return
    }
    res.locals['data'] = await action(name, id, req.body)
    next?.()
  }
}

export function createApp(db: Low<Data>, options: AppOptions = {}) {
  // Create service
  let service: Service
  try {
    service = new Service(db)
  } catch (err) {
    console.error('Failed to initialize Service:', err instanceof Error ? err.message : 'unknown error')
    app.use((req: any, res: any) => {
      res.status(503).json({ error: 'Service initialization failed' })
    })
    throw err
  }

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
