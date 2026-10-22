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

// Pre-computed reserved key indices for O(1) lookup without Set overhead
// Maps reserved key names to their positions in the output object for direct access
const RESERVED_KEYS = {
  '_sort': 0,
  '_page': 1,
  '_per_page': 2,
  '_embed': 3,
  '_where': 4,
} as const

type ReservedKey = keyof typeof RESERVED_KEYS

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
  const params = new URLSearchParams(queryString)

  // Single-pass iteration: collect filter params and reserved values together
  // Eliminates URLSearchParams overhead and Set lookups via direct index mapping
  const filterParts: string[] = []
  const reserved = new Array<string | undefined>(5) // Pre-allocated for 5 reserved keys
  
  for (const [key, value] of params.entries()) {
    const idx = RESERVED_KEYS[key as ReservedKey]
    if (idx !== undefined) {
      reserved[idx] = value
    } else {
      filterParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value))
    }
  }

  // Parse where: first from filter params, then override with raw _where if present
  const filterStr = filterParts.join('&')
  let where = parseWhere(filterStr)
  const rawWhere = reserved[RESERVED_KEYS._where]
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

  // Parse numeric values only once, indexed directly from reserved array
  let page: number | undefined
  let perPage: number | undefined
  
  const pageRaw = reserved[RESERVED_KEYS._page]
  if (pageRaw !== undefined) {
    const parsedPage = Number.parseInt(pageRaw, 10)
    page = Number.isNaN(parsedPage) ? undefined : parsedPage
  }
  
  const perPageRaw = reserved[RESERVED_KEYS._per_page]
  if (perPageRaw !== undefined) {
    const parsedPerPage = Number.parseInt(perPageRaw, 10)
    perPage = Number.isNaN(parsedPerPage) ? undefined : parsedPerPage
  }

  return {
    where,
    sort: reserved[RESERVED_KEYS._sort],
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

  app.get('/:name', async (req, res, next) => {
    const { name = '' } = req.params
    const params = parseListParams(req)

    res.locals['data'] = await service.find(name, {
      where: params.where,
      sort: params.sort,
      page: params.page,
      perPage: params.perPage,
      embed: params.embed,
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
