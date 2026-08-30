# Driver Agent v5.9

LLM-first orchestration patch.

- LLM is now the first interpreter of user text; local detection no longer intercepts product groups before the LLM call.
- Retrieval still supplies a short candidate list to the LLM and validates against dictionaries.
- Main LLM timeout increased to 30 seconds.
- One automatic retry is made before local fallback.
- Connection check now uses the same timeout/retry path as real requests and reports latency.
- Settings include a compact diagnostic of the last LLM call (success / timeout / API/JSON error / fallback, latency, attempt).
- Session cancellation still aborts in-flight requests and stale replies are ignored.
