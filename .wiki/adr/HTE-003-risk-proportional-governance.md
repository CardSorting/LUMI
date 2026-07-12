# HTE-003: Risk-Proportional Governance

**Status:** Accepted  
**Implementation:** dependency classification, approval handlers, `completionAudit.ts`

## Context and problem

Advisory diagnostics and evidence persistence were able to behave like blocking approvals, creating false blockers.

## Decision

Fail open for advisory systems whose failure cannot alter validity; fail closed for concrete destructive, credential, publication, boundary, approval, rollback, receipt, and direct-validation risks.

## Alternatives and tradeoffs

Fail closed everywhere maximizes ceremony and latency. Fail open everywhere weakens material controls. Risk classification is more precise but must be maintained as tool effects evolve.

## Consequences and future considerations

Audit and roadmap persistence may fail after a valid result. Never downgrade a control that protects user data, credentials, external publication, or irreversible mutation without a new safety design.
