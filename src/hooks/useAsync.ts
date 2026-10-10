import { useCallback, useEffect, useRef, useState } from 'react';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | undefined;
  error: unknown;
  reload: () => void;
}

interface Internal<T> {
  key: string | null;
  status: AsyncStatus;
  data: T | undefined;
  error: unknown;
}

/**
 * Load data for `key` and expose its state. A null key means "nothing to load".
 * Results from a previous key are never returned for the current key, and a
 * response that arrives after the key changed is ignored.
 */
export function useAsync<T>(
  key: string | null,
  load: (key: string, signal: AbortSignal) => Promise<T>
): AsyncState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;

  const [token, setToken] = useState(0);
  const [state, setState] = useState<Internal<T>>({ key: null, status: 'idle', data: undefined, error: null });

  useEffect(() => {
    if (key === null) {
      setState({ key: null, status: 'idle', data: undefined, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState((previous) => ({
      key,
      status: 'loading',
      data: previous.key === key ? previous.data : undefined,
      error: null,
    }));
    loadRef
      .current(key, controller.signal)
      .then(
        (data) => {
          if (!controller.signal.aborted) setState({ key, status: 'success', data, error: null });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ key, status: 'error', data: undefined, error });
        }
      );
    return () => controller.abort();
  }, [key, token]);

  const reload = useCallback(() => setToken((value) => value + 1), []);

  if (key === null) return { status: 'idle', data: undefined, error: null, reload };
  if (state.key !== key) return { status: 'loading', data: undefined, error: null, reload };
  return { status: state.status, data: state.data, error: state.error, reload };
}
