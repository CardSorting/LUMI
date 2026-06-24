# LUMI API

The LUMI extension exposes an API that other VS Code extensions can consume.

1. Copy `src/extension-api/dietcode.d.ts` to your extension's source directory (types retain legacy filename).
2. Include the declaration file in your extension's compilation.
3. Acquire the API:

```ts
const lumiExtension = vscode.extensions.getExtension<LumiAPI>("CardSorting.lumi-vscode")

if (!lumiExtension?.isActive) {
  throw new Error("LUMI extension is not activated")
}

const lumi = lumiExtension.exports

if (lumi) {
  await lumi.startNewTask("Hello, LUMI! Let's make a new project...")
  await lumi.sendMessage("Can you fix the @problems?")
  await lumi.pressPrimaryButton()
  await lumi.pressSecondaryButton()
} else {
  console.error("LUMI API is not available")
}
```

**Note:** Add LUMI to `extensionDependencies` in your `package.json` so it activates first:

```json
"extensionDependencies": [
  "CardSorting.lumi-vscode"
]
```

For method signatures, see `src/extension-api/dietcode.d.ts`.
