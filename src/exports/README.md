# DietCode API

The DietCode extension exposes an API that can be used by other extensions. To use this API in your extension:

1. Copy `src/extension-api/dietcode.d.ts` to your extension's source directory.
2. Include `dietcode.d.ts` in your extension's compilation.
3. Get access to the API with the following code:

    ```ts
    const dietcodeExtension = vscode.extensions.getExtension<DietCodeAPI>("saoudrizwan.claude-dev")

    if (!dietcodeExtension?.isActive) {
    	throw new Error("DietCode extension is not activated")
    }

    const dietcode = dietcodeExtension.exports

    if (dietcode) {
    	// Now you can use the API

    	// Start a new task with an initial message
    	await dietcode.startNewTask("Hello, DietCode! Let's make a new project...")

    	// Start a new task with an initial message and images
    	await dietcode.startNewTask("Use this design language", ["data:image/webp;base64,..."])

    	// Send a message to the current task
    	await dietcode.sendMessage("Can you fix the @problems?")

    	// Simulate pressing the primary button in the chat interface (e.g. 'Save' or 'Proceed While Running')
    	await dietcode.pressPrimaryButton()

    	// Simulate pressing the secondary button in the chat interface (e.g. 'Reject')
    	await dietcode.pressSecondaryButton()
    } else {
    	console.error("DietCode API is not available")
    }
    ```

    **Note:** To ensure that the `saoudrizwan.claude-dev` extension is activated before your extension, add it to the `extensionDependencies` in your `package.json`:

    ```json
    "extensionDependencies": [
        "saoudrizwan.claude-dev"
    ]
    ```

For detailed information on the available methods and their usage, refer to the `dietcode.d.ts` file.
