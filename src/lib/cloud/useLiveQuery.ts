import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { storeVersion, subscribeStore } from './table'





export function useLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const version = useSyncExternalStore(subscribeStore, storeVersion, storeVersion)
  const [result, setResult] = useState<T | undefined>(undefined)
  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    let alive = true
    void Promise.resolve()
      .then(query)
      .then((r) => {
        if (alive && id === seq.current) setResult(() => r)
      })
      .catch((err) => console.warn('[liveQuery]', err))
    return () => {
      alive = false
    }
  }, [version, ...deps]) 
  return result
}
