# 01 System Overview

## Architecture
DietCode follows a layered **Joy-Zoning** architecture to maintain strict separation of concerns and ensure high-fidelity architectural integrity.

### Layer Boundaries
- **DOMAIN** (`src/domain/`): Pure business logic. Zero side effects.
- **CORE** (`src/core/`): Application orchestration. Coordinates Domain and Infrastructure.
- **INFRASTRUCTURE** (`src/infrastructure/`): Adapters for the outside world (FS, DB, APIs).
- **UI** (`webview-ui/`): Presentation layer (React/Tailwind).
- **PLUMBING** (`src/utils/`): Stateless shared utilities.

## Sovereignty Protocol
The system is protected by proactive guards (TIA - Integrity Advisory Protocol) that monitor structural integrity and provide forensic guidance during turn execution.

## Documentation (The Knowledge Ledger)
The `.wiki/` directory serves as the static observer of the system state, documenting every technical delta with absolute factual parity.
