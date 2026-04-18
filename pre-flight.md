🧠 What went wrong in your case (pattern-level)

You hit a classic setup issue:

Node not installed or not on PATH
Dev paths not configured
No sudo access → no ability to repair system install
Agent assumes “developer-like environment” but user machine is not that

So your agent wasn’t failing at “AI” — it was failing at:

environment assumptions not validated before execution

⚡ What a good “agent pre-flight check” looks like

Not a planner. Not a reasoning phase. Just a fast environment probe (5–10 seconds max).

Think of it like:

“before I do anything, I check if I’m even allowed to run”

🧪 Minimal viable pre-flight check (example)

You can structure it like a tiny script your agent always runs first:

1. Runtime availability
node -v exists?
npm -v exists?
which node returns valid path?
2. PATH sanity
is Node coming from user-level install or system install?
is PATH writable/accessible?
3. Permissions
can user install global packages? (test write to a temp directory)
is sudo required for basic dev tasks? (flag this)
4. Project compatibility
does repo require global deps?
does repo assume nvm / fnm / asdf?
🧠 The key design principle

You are NOT asking:

“is the system correct?”

You are asking:

“is the environment compatible enough to even attempt execution?”

That distinction is everything.

⚡ Even simpler version (what I’d actually recommend for you)

Don’t overbuild it. Do this:

Pre-flight = 3 checks only
1. node available?
2. npm usable?
3. can I write/install locally without sudo?

That’s it.

If any fail:

STOP and switch to “setup mode”

🔁 Add a fallback mode (this is the real win)

Instead of trying to “fix” everything automatically:

If preflight fails → agent switches behavior:
prints exact missing requirements
gives minimal fix steps
avoids continuing execution
does NOT attempt repair loops

This prevents your 1-hour spiral.

💀 Why your current system hurt so much

Right now your agent probably did:

assume environment works
try install
hit failure
try workaround
hit permissions wall
repeat manually

That’s how you get:

“3 manual interventions + existential debugging arc”

🔥 The real insight

You don’t need a “smarter agent.”

You need a stupid-fast gatekeeper step.

Because:

80% of your pain is happening before the agent should even start thinking.

🧠 If you want a clean mental model

Split execution into:

1. Pre-flight (deterministic, boring)
environment checks only
no reasoning
2. Runtime (agent behavior)
only runs if preflight passes
3. Recovery mode (optional)
only triggers if runtime fails
⚖️ Your instinct about “planning is excessive” is correct

You don’t want:

chain-of-thought planning
multi-step orchestration before every run
heavy scaffolding

You want:

a cheap yes/no gate