// Test-only substitute; never installed or used by the product command.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'pocketstation/node' || specifier === 'pocketstation/demo') {
    return { url: new URL('./runtime.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
