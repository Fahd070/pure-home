import { act } from 'react';

/**
 * Deterministic replacement for the fixed-tick `flush()` helper.
 *
 * The old pattern was `for (let i = 0; i < 10; i++) await act(() => sleep(0))`
 * -- ten macrotask ticks and then assert. That is a guess, not a wait: how many
 * ticks a mount actually needs depends on how many promise jobs react-query
 * chains, how React 18 schedules the resulting renders, and how much CPU the
 * process gets. Under the default parallel runner on a loaded machine the work
 * sometimes needed more than ten, the assertion ran against a half-rendered
 * tree, and the test failed intermittently while passing in isolation.
 *
 * This waits on the observable condition the assertion actually depends on and
 * returns the moment it holds -- so it is normally FASTER than ten fixed ticks,
 * and it only spends the full budget when something is genuinely wrong. The
 * timeout exists to fail loudly rather than hang; it is not a sleep.
 */
export async function waitFor(
  condition: () => boolean,
  { timeout = 4000, interval = 10, message = 'condition not met' }: {
    timeout?: number;
    interval?: number;
    message?: string;
  } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;

  // Let any already-queued microtasks/effects settle before the first check,
  // so a condition that is already true costs one tick rather than `interval`.
  await act(async () => { await Promise.resolve(); });
  if (condition()) return;

  while (Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, interval));
    });
    if (condition()) return;
  }

  throw new Error(
    `waitFor timed out after ${timeout}ms: ${message}. ` +
    'This means the UI never reached the expected state -- a real failure, not a slow machine.'
  );
}

/** Waits until `root` contains at least `count` `<tbody> <tr>` rows. */
export function waitForRows(root: () => ParentNode, count: number) {
  return waitFor(
    () => root().querySelectorAll('tbody tr').length >= count,
    { message: `expected at least ${count} table rows` },
  );
}

/** Waits until `root`'s rendered text contains `text`. */
export function waitForText(root: () => { textContent: string | null }, text: string) {
  return waitFor(
    () => (root().textContent || '').includes(text),
    { message: `expected rendered text to contain ${JSON.stringify(text)}` },
  );
}
