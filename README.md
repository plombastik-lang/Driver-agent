# Driver Agent v6.5

State-machine fix for INTERPRETING → CLARIFICATION → NORMALIZING → USER_CHOICE → RESOLVED.

Key changes:
- LLM only interprets free text into structured JSON.
- Semantic sanity-check prevents indicator/product role swaps.
- Generic “карты” resolves to a user choice between debit and credit cards.
- Clarification returns to INTERPRETING with the current context.
- Explicit USER_CHOICE bypasses LLM and writes the selected NSI entity directly.
- Product/combination resolution completes before asking calculation parameters such as unit.
- combinationId is created/resolved before duplicate checking.


## v6.5 fixes
- Fixed manual cost loop: operational answers no longer go through the main LLM interpreting path.
- Added deterministic handling for manual cost, model parameters, credit term, P&L and other calculation inputs.
- Restored a 6-stage progress bar with remaining-step indication.
