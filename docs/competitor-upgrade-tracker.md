# Competitor Analysis upgrade: tracker

Branch: `feature/competitor-analysis-upgrade`. Data rule: Apify = DA/PA/spam + ranked keywords. Anything no provider gives shows "Not Available".
Status: DONE = built and tested. PARTIAL = part of it works. TODO = not started.

## Done
| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Summary cards: discovered / selected / analyzed / avg DA with definitions | DONE | counts are separate, unique domains, avg DA skips missing |
| 2 | Competitor table: separate name, domain, location/distance, last analyzed columns | DONE | |
| 3 | Table filters: status, location, DA band, selection | DONE | |
| 4 | Metric tooltips naming the source | DONE | |
| 5 | Analysis history (one record per run, never overwritten) | DONE | migration 0027, not applied to real DB |
| 6 | Statuses: Pending, Queued, Analyzing, Analyzed, Partly read, Failed, Needs retry | DONE | analyzed only when DA and keywords both read |
| 7 | Per-part provider, missing metrics, error stored per run | DONE | |
| 8 | Provider usage log + endpoint | DONE | no UI view yet |
| 9 | Cleaned domain + discovery sources per competitor, no duplicate domains | DONE | Maps and manual only |
| 10 | Direct / indirect flag | DONE | |
| 11 | Already existed, kept: search, sort, paging, Columns menu, CSV, bulk select/analyze/remove with confirm, relevance score with 9 factors, auto-analyze toggle, keyword mapping, saved keywords | KEPT | |

## Left
| # | Phase | Item | Status | Needs |
|---|-------|------|--------|-------|
| A | 2 | Summary cards/table: Referring domains, Not Available/Not Connected states per metric | PARTIAL | none |
| B | 2/3 | Match score drawer: score, label, reason, every measured factor with weight and points added, factors left out, cap note | DONE | uses the existing nine factors (category, services, area, keywords, SERP, intent, page, opportunity, traffic). Built, not clicked through in a browser |
| C | 3 | Discovery inputs: business category, up to 3 primary services, seed keywords, country, language, radius; refresh from Maps; duplicates merged by domain, source kept | DONE | Maps discovery only. Organic search discovery is D. Business name as an input is not added (the project's own name is already excluded). Built, not clicked through in a browser |
| D | 3 | Organic search discovery (competitor domains from SERP) | TODO | provider decision |
| E | 4 | Auto-analyze settings: new competitors, Domain Authority, keywords, retry failed (tries in a row), refresh period, cache hours, daily limit | DONE | per project, saved at once; scheduler runs retries and refresh |
| F | 4/16 | Caching (no repeat reads within cache hours), daily limit, provider pause after quota/429, one in-run retry on temporary errors, 30-minute wait between retries, scheduler hook | DONE | queue is still one competitor at a time per project, in memory (lost on restart; the scheduler picks up what is due) |
| G | 16 | Usage view: calls, failures and cost per provider, today's reads vs limit, pauses, latest calls | DONE | in Settings and usage on the Competitors tab. Built, not clicked through in a browser |
| H | 5 | Competitor keywords: pick several competitors, position/volume/KD ranges, ranking-page filter, ticked + all-filtered Add to My Keywords, detail drawer, Last updated, CPC | DONE | built, not clicked through in a browser yet. SERP features column shows Not available (no source). Drawer has no SERP overview (not kept) |
| I | 5/13 | Save to My Keywords without duplicates: existing keywords are named in the answer and get the new source | DONE | bulk send and filtered-send already existed; per-row Add button still TODO |
| J | 12/13 | One keyword keeps every source (Competitor Keywords / Competitor Gap / Keyword Research / Manual Entry) | DONE | stored as a list inside keyword.source, not a separate table |
| K | 6 | Keyword Gap: Missing / Weak / Shared / Strong / Only you, Opportunity score with documented formula, a position column per competitor, Opportunity-type filter | DONE | formula in `opportunity()` and the column tooltip. Device type and target-location inputs still TODO (same market only). Not clicked through in a browser |
| L | 7 | Traffic: Estimated vs Verified labels, share-of-traffic bar, top traffic keywords per competitor, trend from real analysis runs only (needs 2+ runs), comparison charts | DONE | no fabricated history. Built, not clicked through in a browser |
| M | 8 | Top pages: URL, est. traffic, ranking keywords, top keyword + position, page drawer (keywords with your position, page-level opportunities, related terms, content opportunities + add to My Keywords) | DONE | page title and page-level backlinks show Not available: no connected provider reads them |
| N | 9 | Backlinks: new/lost, follow/nofollow, anchor text | TODO | provider decision |
| O | 10 | Google Maps tab: local rank tracking separate from discovery | PARTIAL | none |
| P | 11 | Research tab with four sections: Keyword Discovery (seeds, services, places; searches, KD, CPC, intent, questions), Competitor Research (multi-competitor keywords with filters), Location-Based Keywords (service x chosen places x phrase shapes, searches checked), Keyword Opportunities (missing, low KD, high volume, commercial, long-tail, question) with bulk save to My Keywords | DONE | built on existing endpoints, no backend change. Tab now shows before a research run; the old run view is a fifth section. Not clicked through in a browser. Related-keyword ideas from Keyword Planner are not shown separately |
| Q | 14 | Mapping: cannibalization, duplicate page targeting, statuses | PARTIAL | none |
| R | 17 | End-to-end test of the 15-step workflow + large datasets | TODO | |
| S | - | Schema on dev DB (already there, app creates it at start-up; alembic_version is stale, so upgrade was not run); committed | DONE | |

Pre-existing failing tests (not caused by this work): test_gbp_competitors::test_competitors_are_private, test_gbp_reports::test_reports_are_private, two in test_keyword_paragraphs.

Also failing before this work (environment, not code): two tests in test_chatgpt_business (a Cloudflare URL in the environment).
