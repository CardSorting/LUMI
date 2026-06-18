/** Compact welcome — title only; suggestions sit above the input in the footer. */
const HomeHeader = () => {
	return (
		<div className="px-3 py-6 text-center animate-fade-slide-in">
			<h1 className="m-0 text-base font-semibold tracking-tight text-foreground leading-tight">What can I help with?</h1>
			<p className="text-muted-foreground text-xs leading-snug m-0 mt-1.5">Pick a suggestion or type below.</p>
		</div>
	)
}

export default HomeHeader
