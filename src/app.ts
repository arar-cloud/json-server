import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { App } from '@tinyhttp/app'
import { cors } from '@tinyhttp/cors'
import { Eta } from 'eta'
import { Low } from 'lowdb'
import { json } from 'milliparsec'
import sirv from 'sirv'
import type { JsonObject } from 'type-fest'

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
const RESERVED_KEYS = Object.freeze(
  new Map<string, number>([
    ['_sort', 0],
    ['_page', 1],
    ['_per_page', 2],
    ['_embed', 3],
    ['_where', 4],
  ])
)

function parseListParams(req: any) {
  const queryString = req.url.split('?')[1] ?? ''
  
  // Single-pass parsing with direct character scanning
  // Eliminates paired indexOf calls and reduces string traversal overhead
  const filterParts: string[] = []
  const reserved = new Array<string | undefined>(5) // Pre-allocated for 5 reserved keys
  
  if (queryString) {
    let pos = 0
    const qLen = queryString.length
    
    while (pos < qLen) {
      let pairEnd = qLen
      let eqIdx = -1
      
      // Single scan finds both & (pair end) and = (key-value split)
      for (let i = pos; i < qLen; i++) {
        if (queryString[i] === '=') {
          if (eqIdx === -1) eqIdx = i
        } else if (queryString[i] === '&') {
          pairEnd = i
          break
        }
      }
      
      // Extract key and value directly without creating intermediate pair string
      let key: string
      let value: string
      
      if (eqIdx === -1) {
        key = decodeURIComponent(queryString.slice(pos, pairEnd))
        value = ''
      } else {
        key = decodeURIComponent(queryString.slice(pos, eqIdx))
        value = decodeURIComponent(queryString.slice(eqIdx + 1, pairEnd))
      }
      
      // Distribute to reserved or filter arrays
      const idx = RESERVED_KEYS.get(key)
      if (idx !== undefined) {
        reserved[idx] = value
      } else {
        filterParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value))
      }
      
      pos = pairEnd + 1
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

  // Use static dispatch: avoid dynamic property lookups on hot path
  // Direct array index access is JIT-optimizable and faster than req.query lookups
  let embed: string | undefined
  if (req.query && typeof req.query === 'object') {
    const queryObj = req.query as Record<string, any>
    if ('_embed' in queryObj) {
      embed = queryObj._embed
    }
  }

  return {
    where,
    sort: reserved[RESERVED_KEYS._sort],
    page,
    perPage,
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
