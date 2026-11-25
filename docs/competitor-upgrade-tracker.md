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
| B | 2/3 | Click Match score opens factor drawer | PARTIAL | profile page has it; add a quick drawer |
| C | 3 | Discovery inputs (services, seed keywords, radius, country, language) and refresh discovery | PARTIAL | none |
| D | 3 | Organic search discovery (competitor domains from SERP) | TODO | provider decision |
| E | 4 | Auto-analyze settings (keywords, backlinks, retry, periodic refresh) | TODO | none |
| F | 4/16 | Quota handling, caching, retry logic, background queue for bulk | PARTIAL | none |
| G | 16 | API usage view in the UI | TODO | none |
| H | 5 | Competitor keywords: pick several competitors, position/volume/KD ranges, ranking-page filter, ticked + all-filtered Add to My Keywords, detail drawer, Last updated, CPC | DONE | built, not clicked through in a browser yet. SERP features column shows Not available (no source). Drawer has no SERP overview (not kept) |
| I | 5/13 | Save to My Keywords without duplicates: existing keywords are named in the answer and get the new source | DONE | bulk send and filtered-send already existed; per-row Add button still TODO |
| J | 12/13 | One keyword keeps every source (Competitor Keywords / Competitor Gap / Keyword Research / Manual Entry) | DONE | stored as a list inside keyword.source, not a separate table |
| K | 6 | Keyword Gap: Missing / Weak / Strong / Shared, opportunity score with formula | PARTIAL | none |
| L | 7 | Traffic: estimated vs verified label, distribution, top keywords | PARTIAL | none |
| M | 8 | Top pages: page detail, content opportunities | PARTIAL | none |
| N | 9 | Backlinks: new/lost, follow/nofollow, anchor text | TODO | provider decision |
| O | 10 | Google Maps tab: local rank tracking separate from discovery | PARTIAL | none |
| P | 11 | Research tab: discovery, competitor research, location keywords, opportunities | PARTIAL | none |
| Q | 14 | Mapping: cannibalization, duplicate page targeting, statuses | PARTIAL | none |
| R | 17 | End-to-end test of the 15-step workflow + large datasets | TODO | |
| S | - | Schema on dev DB (already there, app creates it at start-up; alembic_version is stale, so upgrade was not run); committed | DONE | |

Pre-existing failing tests (not caused by this work): test_gbp_competitors::test_competitors_are_private, test_gbp_reports::test_reports_are_private, two in test_keyword_paragraphs.
