# CodeMarie API

The CodeMarie extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/codemarie.d.ts` to your extension's source directory.
2. Include `codemarie.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const codemarieExtension = vscode.extensions.getExtension<CodeMarieAPI>("saoudrizwan.claude-dev")

    if (!codemarieExtension?.isActive) {
    	throw new Error("CodeMarie extension is not activated")
    }

    const codemarie = codemarieExtension.exports

    if (codemarie) {
    	// Now you can use the API

    	// Start a new task with an initial message
    	await codemarie.startNewTask("Hello, CodeMarie! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await codemarie.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await codemarie.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await codemarie.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await codemarie.pressSecondaryButton()
    } else {
    	console.error("CodeMarie API is not available")
    }
    ```

    **Note:** To ensure that the `saoudrizwan.claude-dev` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "saoudrizwan.claude-dev"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `codemarie.d.ts` file.
