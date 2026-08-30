# Driver Agent v6.2

State-machine fix for INTERPRETING → CLARIFICATION → NORMALIZING → USER_CHOICE → RESOLVED.

Key changes:
- LLM only interprets free text into structured JSON.
- Semantic sanity-check prevents indicator/product role swaps.
- Generic “карты” resolves to a user choice between debit and credit cards.
- Clarification returns to INTERPRETING with the current context.
- Explicit USER_CHOICE bypasses LLM and writes the selected NSI entity directly.
- Product/combination resolution completes before asking calculation parameters such as unit.
- combinationId is created/resolved before duplicate checking.
