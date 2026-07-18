import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDebouncedInput } from "../useDebouncedInput"

describe("useDebouncedInput", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not persist the initial value", async () => {
		const onChange = vi.fn()

		renderHook(() => useDebouncedInput("existing-key", onChange))
		await act(() => vi.advanceTimersByTimeAsync(100))

		expect(onChange).not.toHaveBeenCalled()
	})

	it("persists a user edit after the debounce delay", async () => {
		const onChange = vi.fn()
		const { result } = renderHook(() => useDebouncedInput("existing-key", onChange))

		act(() => result.current[1]("new-key"))
		await act(() => vi.advanceTimersByTimeAsync(99))
		expect(onChange).not.toHaveBeenCalled()

		await act(() => vi.advanceTimersByTimeAsync(1))
		expect(onChange).toHaveBeenCalledOnce()
		expect(onChange).toHaveBeenCalledWith("new-key")
	})

	it("does not persist an externally synchronized value", async () => {
		const onChange = vi.fn()
		const { result, rerender } = renderHook(({ initialValue }) => useDebouncedInput(initialValue, onChange), {
			initialProps: { initialValue: "openrouter-key" },
		})

		rerender({ initialValue: "xai-key" })
		expect(result.current[0]).toBe("xai-key")

		await act(() => vi.advanceTimersByTimeAsync(100))
		expect(onChange).not.toHaveBeenCalled()
	})

	it("persists immediately when debounce is disabled", () => {
		const onChange = vi.fn()
		const { result } = renderHook(() => useDebouncedInput("", onChange, 0))

		act(() => result.current[1]("csk-test"))

		expect(onChange).toHaveBeenCalledOnce()
		expect(onChange).toHaveBeenCalledWith("csk-test")
	})
})
