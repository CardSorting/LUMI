/** Gentle loading indicator — rests beside the user while thinking. */
export const MiraProgressIndicator = () => (
	<span aria-hidden className="inline-flex items-center gap-1 mr-2 h-3">
		<span className="size-1 rounded-full bg-mira/30 animate-mira-dot-pulse-slow [animation-delay:0ms]" />
		<span className="size-1 rounded-full bg-mira/30 animate-mira-dot-pulse-slow [animation-delay:320ms]" />
		<span className="size-1 rounded-full bg-mira/30 animate-mira-dot-pulse-slow [animation-delay:640ms]" />
	</span>
)
