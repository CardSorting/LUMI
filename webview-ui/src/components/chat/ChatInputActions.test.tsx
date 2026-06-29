import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ChatInputActions } from "./ChatInputActions"

describe("ChatInputActions keyboard ergonomics", () => {
	it("provides named, keyboard-operable composer controls in focus order", async () => {
		const user = userEvent.setup()
		const onContextClick = vi.fn()
		const onAttachClick = vi.fn()
		const onModelClick = vi.fn()

		render(
			<ChatInputActions
				attachDisabled={false}
				composerMode="ready"
				modelDisplayName="provider:model"
				onAttachClick={onAttachClick}
				onContextClick={onContextClick}
				onModelClick={onModelClick}
			/>,
		)

		await user.tab()
		expect(screen.getByRole("button", { name: "Mention workspace context" })).toHaveFocus()
		await user.keyboard("{Enter}")
		expect(onContextClick).toHaveBeenCalledOnce()

		await user.tab()
		expect(screen.getByRole("button", { name: "Attach a file or image" })).toHaveFocus()
		await user.keyboard("{Enter}")
		expect(onAttachClick).toHaveBeenCalledOnce()

		await user.tab()
		expect(screen.getByRole("button", { name: /Change model/ })).toHaveFocus()
	})

	it("exposes disabled attachment semantics", () => {
		render(
			<ChatInputActions
				attachDisabled
				composerMode="steering"
				modelDisplayName="provider:model"
				onAttachClick={() => {}}
				onContextClick={() => {}}
				onModelClick={() => {}}
			/>,
		)

		expect(screen.getByRole("button", { name: "Attach a file or image" })).toBeDisabled()
	})
})
