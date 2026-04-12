import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./main.css"
import "./index.css"
import App from "./App.tsx"
import { PLATFORM_CONFIG, PlatformType } from "./config/platform.config"

// Handle remote WebSocket connection if on the remote platform
if (PLATFORM_CONFIG.type === PlatformType.REMOTE) {
	const url = new URL(window.location.href)
	const token = url.searchParams.get("token")
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
	const wsUrl = `${protocol}//${window.location.host}${token ? `?token=${token}` : ""}`

	const socket = new WebSocket(wsUrl)
	const win = window as Window & { remoteSocket?: WebSocket }
	win.remoteSocket = socket

	socket.onmessage = (event: MessageEvent<unknown>) => {
		if (typeof event.data === "string") {
			const message = JSON.parse(event.data)
			window.postMessage(message, "*")
		}
	}

	socket.onopen = () => {
		console.log("[Remote] WebSocket connected")
		// Request initial state if needed, though server sends it on connection
		window.postMessage({ command: "init" }, "*")
	}

	socket.onclose = () => {
		console.log("[Remote] WebSocket closed")
	}

	socket.onerror = (error) => {
		console.error("[Remote] WebSocket error:", error)
	}
}

const rootElement = document.getElementById("root")
if (rootElement) {
	createRoot(rootElement).render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
}
