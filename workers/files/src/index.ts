import { corsHeaders, handle, json, type Env } from './handler'

export default {
  fetch: (req: Request, env: Env) =>
    handle(req, env).catch((err) => {
      console.error('files worker error', (err as Error).message)
      return json(500, { error: 'internal error' }, corsHeaders(req, env))
    }),
}
