/** VS Code language model selector shape — shared without importing `vscode` types in webview builds. */

export interface LanguageModelChatSelector {
	vendor?: string
	family?: string
	version?: string
	id?: string
}
